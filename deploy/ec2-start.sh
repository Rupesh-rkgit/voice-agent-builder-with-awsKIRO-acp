#!/bin/bash
# =============================================================================
# Voice Agent Studio — Build & Start (Amazon Linux 2023)
# =============================================================================
# Builds the Next.js app, starts it via pm2, and configures Caddy.
# Run after ec2-setup.sh and editing .env.local:
#
#   bash deploy/ec2-start.sh          # HTTP on :80, HTTPS on :443 (self-signed)
#   bash deploy/ec2-start.sh domain   # Provide a domain for Let's Encrypt HTTPS
#
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
APP_NAME="voice-agent-studio"
APP_DIR="/home/ec2-user/voice-agent-builder-with-awsKIRO-acp"
DOMAIN="${1:-}"    # Optional: pass domain as first argument
# ─────────────────────────────────────────────────────────────────────────────

log() { echo -e "\n\033[1;36m=== $1 ===\033[0m"; }

export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
cd "$APP_DIR"

# ── Pre-flight checks ───────────────────────────────────────────────────────
if [ ! -f .env.local ]; then
  echo "ERROR: .env.local not found. Copy .env.example and edit it first."
  exit 1
fi

if ! command -v caddy &>/dev/null; then
  echo "ERROR: Caddy not installed. Run ec2-setup.sh first."
  exit 1
fi

# ── Build ────────────────────────────────────────────────────────────────────
log "Building Next.js app"
npm run build

# ── pm2 ──────────────────────────────────────────────────────────────────────
log "Starting app via pm2"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start npm --name "$APP_NAME" -- start
pm2 save

# Auto-restart on reboot
PM2_STARTUP=$(pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>/dev/null | grep "sudo" | head -1 || true)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP"
fi

# ── Caddy ────────────────────────────────────────────────────────────────────
log "Configuring Caddy"

if [ -n "$DOMAIN" ]; then
  # Real domain → Caddy auto-provisions Let's Encrypt cert
  echo "Domain: ${DOMAIN}  (Caddy will auto-provision HTTPS via Let's Encrypt)"
  sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy localhost:3000
}
EOF
else
  # No domain → HTTP on :80 + self-signed HTTPS on :443
  echo "No domain provided — using HTTP :80 + self-signed HTTPS :443"
  sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
:443 {
    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem
    reverse_proxy localhost:3000
}

:80 {
    reverse_proxy localhost:3000
}
EOF
fi

sudo systemctl enable caddy
sudo systemctl restart caddy

# ── Status ───────────────────────────────────────────────────────────────────
log "Status"
pm2 status
sudo systemctl status caddy --no-pager -l | head -10

# ── Done ─────────────────────────────────────────────────────────────────────
# Get public IP via IMDSv2
TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  PUBLIC_IP=$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "<EC2_PUBLIC_IP>")
else
  PUBLIC_IP="<EC2_PUBLIC_IP>"
fi

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  App is live!                                    │"
echo "│                                                  │"
if [ -n "$DOMAIN" ]; then
echo "│  https://${DOMAIN}                               │"
else
echo "│  http://${PUBLIC_IP}                             │"
echo "│  https://${PUBLIC_IP}  (self-signed, browser warning) │"
fi
echo "│                                                  │"
echo "│  Useful commands:                                │"
echo "│    pm2 logs ${APP_NAME}                          │"
echo "│    pm2 restart ${APP_NAME}                       │"
echo "│    sudo journalctl -u caddy -f                   │"
echo "└──────────────────────────────────────────────────┘"
