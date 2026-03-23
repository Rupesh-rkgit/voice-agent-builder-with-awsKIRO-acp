#!/bin/bash
# =============================================================================
# Voice Agent Studio — EC2 UserData Bootstrap
# =============================================================================
# This script runs automatically on first boot via cloud-init.
# All output is logged to /var/log/cloud-init-output.log
# =============================================================================

set -euo pipefail

APP_NAME="${app_name}"
APP_DIR="/home/ec2-user/$${APP_NAME}"
REPO_URL="${github_repo_url}"
BRANCH="${github_branch}"

log() { echo ""; echo "======================================"; echo "  $1"; echo "======================================"; }

# ── 1. System packages ──────────────────────────────────────────────────────
log "1/7  System packages"
dnf update -y -q
dnf install -y -q git gcc-c++ make openssl

# ── 2. Node.js 20 via nvm ───────────────────────────────────────────────────
log "2/7  Node.js 20 via nvm"
su - ec2-user -c '
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
  echo "Node $(node -v)  npm $(npm -v)"
'

# ── 3. pm2 (process manager) ────────────────────────────────────────────────
log "3/7  pm2"
su - ec2-user -c '
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  npm install -g pm2
  echo "pm2 $(pm2 -v)"
'

# ── 4. Caddy (reverse proxy) — binary install ───────────────────────────────
log "4/7  Caddy binary install"
curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy
chmod +x /usr/local/bin/caddy

# Create caddy system user
if ! id caddy &>/dev/null; then
  useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
fi

# Create required directories
mkdir -p /etc/caddy /etc/caddy/certs /var/lib/caddy /var/log/caddy
chown caddy:caddy /var/lib/caddy /var/log/caddy

# Install systemd service
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy reverse proxy
Documentation=https://caddyserver.com/docs/
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "Caddy $(caddy version)"

# ── 5. Self-signed TLS certificate ──────────────────────────────────────────
log "5/7  Self-signed TLS certificate"
# Get public IP via IMDSv2
TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
PUBLIC_IP=""
if [ -n "$TOKEN" ]; then
  PUBLIC_IP=$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
fi

SAN_EXT=""
if [ -n "$PUBLIC_IP" ]; then
  SAN_EXT="-addext subjectAltName=IP:$${PUBLIC_IP}"
  echo "Including SAN for IP: $${PUBLIC_IP}"
fi

# Generate cert
TMPDIR_CERT=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$${TMPDIR_CERT}/key.pem" \
  -out "$${TMPDIR_CERT}/cert.pem" \
  -days 30 \
  -subj "/CN=$${APP_NAME}" \
  $${SAN_EXT} 2>/dev/null \
|| openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$${TMPDIR_CERT}/key.pem" \
  -out "$${TMPDIR_CERT}/cert.pem" \
  -days 30 \
  -subj "/CN=$${APP_NAME}"

mv "$${TMPDIR_CERT}/key.pem" /etc/caddy/certs/key.pem
mv "$${TMPDIR_CERT}/cert.pem" /etc/caddy/certs/cert.pem
rm -rf "$${TMPDIR_CERT}"
chown caddy:caddy /etc/caddy/certs/key.pem /etc/caddy/certs/cert.pem
chmod 600 /etc/caddy/certs/key.pem
chmod 644 /etc/caddy/certs/cert.pem
echo "Self-signed certificate created"

# ── 6. Clone repo & install app ─────────────────────────────────────────────
log "6/7  Cloning repo and installing app"
su - ec2-user -c "
  git clone --branch ${github_branch} ${github_repo_url} $${APP_DIR}
  cd $${APP_DIR}

  # Create .env.local
  cat > .env.local <<'ENVEOF'
KIRO_CLI_PATH=/home/ec2-user/.local/bin/kiro-cli
KIRO_WORKSPACE_DIR=$${APP_DIR}
AWS_REGION=${aws_region}
AWS_BEARER_TOKEN_BEDROCK=${aws_bearer_token_bedrock}
VOICE_PROVIDER=auto
TRANSCRIBE_LANGUAGE_CODE=${transcribe_language_code}
POLLY_VOICE_ID=${polly_voice_id}
POLLY_ENGINE=${polly_engine}
BEDROCK_MODEL_ID=${bedrock_model_id}
NEXT_PUBLIC_APP_URL=https://$${PUBLIC_IP:-localhost}
NODE_ENV=production
MAX_ACP_SESSIONS=${max_acp_sessions}
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=https://$${PUBLIC_IP:-localhost}
ENVEOF

  # Install dependencies and build
  export NVM_DIR=\"\$HOME/.nvm\"
  source \"\$NVM_DIR/nvm.sh\"
  npm ci --prefer-offline
  npm run build
"

# ── 7. Start app & Caddy ────────────────────────────────────────────────────
log "7/7  Starting app via pm2 and Caddy"
su - ec2-user -c "
  export NVM_DIR=\"\$HOME/.nvm\"
  source \"\$NVM_DIR/nvm.sh\"
  cd $${APP_DIR}
  pm2 delete $${APP_NAME} 2>/dev/null || true
  pm2 start npm --name $${APP_NAME} -- start
  pm2 save
"

# pm2 auto-start on reboot
PM2_STARTUP=$(su - ec2-user -c 'pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>/dev/null | grep "sudo" | head -1' || true)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP"
fi

# Caddy config  — HTTP + self-signed HTTPS
cat > /etc/caddy/Caddyfile <<'EOF'
:443 {
    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem
    reverse_proxy localhost:3000
}

:80 {
    reverse_proxy localhost:3000
}
EOF

systemctl enable caddy
systemctl restart caddy

# ── Done ─────────────────────────────────────────────────────────────────────
log "DEPLOYMENT COMPLETE"
echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  Voice Agent Studio is live!                     │"
echo "│                                                  │"
echo "│  http://$${PUBLIC_IP:-<EC2_PUBLIC_IP>}           │"
echo "│  https://$${PUBLIC_IP:-<EC2_PUBLIC_IP>} (self-signed)│"
echo "│                                                  │"
echo "│  Commands:                                       │"
echo "│    pm2 logs $${APP_NAME}                         │"
echo "│    pm2 restart $${APP_NAME}                      │"
echo "│    sudo journalctl -u caddy -f                   │"
echo "└──────────────────────────────────────────────────┘"
