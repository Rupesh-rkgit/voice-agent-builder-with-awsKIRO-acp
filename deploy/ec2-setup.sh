#!/bin/bash
# =============================================================================
# Voice Agent Studio — EC2 Setup (Amazon Linux 2023)
# =============================================================================
# Provisions a fresh AL2023 instance with Node.js, pm2, Caddy, and the app.
# Run once after launching the instance:
#
#   bash deploy/ec2-setup.sh
#
# Then edit .env.local and run:  bash deploy/ec2-start.sh
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
APP_NAME="voice-agent-studio"
APP_DIR="/home/ec2-user/voice-agent-builder-with-awsKIRO-acp"
NODE_VERSION="20"
CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=amd64"
# ─────────────────────────────────────────────────────────────────────────────

log() { echo -e "\n\033[1;36m=== $1 ===\033[0m"; }

# ── 1. System packages ──────────────────────────────────────────────────────
log "1/6  System packages"
sudo dnf update -y -q
sudo dnf install -y -q git gcc-c++ make openssl

# ── 2. Node.js via nvm ──────────────────────────────────────────────────────
log "2/6  Node.js ${NODE_VERSION} via nvm"
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"
echo "Node $(node -v)  npm $(npm -v)"

# ── 3. pm2 (process manager) ────────────────────────────────────────────────
log "3/6  pm2"
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi
echo "pm2 $(pm2 -v)"

# ── 4. Caddy (reverse proxy) — binary install ───────────────────────────────
log "4/6  Caddy (binary install)"
if ! command -v caddy &>/dev/null; then
  # Download binary
  sudo curl -fsSL "$CADDY_URL" -o /usr/local/bin/caddy
  sudo chmod +x /usr/local/bin/caddy

  # Create caddy system user
  if ! id caddy &>/dev/null; then
    sudo useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
  fi

  # Create required directories
  sudo mkdir -p /etc/caddy /etc/caddy/certs /var/lib/caddy /var/log/caddy
  sudo chown caddy:caddy /var/lib/caddy /var/log/caddy

  # Install systemd service
  sudo tee /etc/systemd/system/caddy.service > /dev/null <<'UNIT'
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
  sudo systemctl daemon-reload

  echo "Caddy $(caddy version)"
else
  echo "Caddy already installed: $(caddy version)"
fi

# ── 5. Self-signed TLS certificate ──────────────────────────────────────────
log "5/6  Self-signed TLS certificate (30 days)"
if [ ! -f /etc/caddy/certs/cert.pem ]; then
  # Get public IP via IMDSv2
  TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    PUBLIC_IP=$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
  else
    PUBLIC_IP=""
  fi

  # Build SAN extension
  SAN_EXT=""
  if [ -n "$PUBLIC_IP" ]; then
    SAN_EXT="-addext subjectAltName=IP:${PUBLIC_IP}"
    echo "Including SAN for IP: ${PUBLIC_IP}"
  else
    echo "Warning: Could not detect public IP — certificate will have CN only"
  fi

  # Generate cert
  # shellcheck disable=SC2086
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /etc/caddy/certs/key.pem \
    -out /etc/caddy/certs/cert.pem \
    -days 30 \
    -subj "/CN=${APP_NAME}" \
    $SAN_EXT 2>/dev/null \
  || openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /etc/caddy/certs/key.pem \
    -out /etc/caddy/certs/cert.pem \
    -days 30 \
    -subj "/CN=${APP_NAME}"

  sudo chown -R caddy:caddy /etc/caddy/certs
  sudo chmod 600 /etc/caddy/certs/key.pem
  sudo chmod 644 /etc/caddy/certs/cert.pem
  echo "Certificate created at /etc/caddy/certs/"
else
  echo "Certificate already exists — skipping"
fi

# ── 6. Application code ─────────────────────────────────────────────────────
log "6/6  Application"
cd /home/ec2-user
if [ -d "$APP_DIR" ]; then
  echo "App directory exists — pulling latest"
  cd "$APP_DIR" && git pull
else
  echo "Clone your repo into ${APP_DIR}, then re-run this step"
  echo "  git clone <YOUR_REPO_URL> $(basename "$APP_DIR")"
  exit 0
fi

npm ci --prefer-offline
if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  Setup complete!                                 │"
echo "│                                                  │"
echo "│  1. Edit .env.local:                             │"
echo "│     nano ${APP_DIR}/.env.local                   │"
echo "│                                                  │"
echo "│  2. Start the app:                               │"
echo "│     bash deploy/ec2-start.sh                     │"
echo "└──────────────────────────────────────────────────┘"
