#!/bin/bash
# Start/restart the app with pm2 + Caddy
# Run after ec2-setup.sh and editing .env.local

set -euo pipefail

APP_DIR="/home/ec2-user/voice-agent-builder-with-awsKIRO-acp"
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

cd "$APP_DIR"

echo "=== Building ==="
npm run build

echo "=== Starting app with pm2 ==="
pm2 delete voice-agent-builder-with-awsKIRO-acp 2>/dev/null || true
pm2 start npm --name voice-agent-builder-with-awsKIRO-acp -- start
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user | tail -1 | sudo bash

echo "=== Configuring Caddy ==="
# If you have a domain, replace :80 with your domain for auto HTTPS
# e.g., demo.yourdomain.com
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
:80 {
    reverse_proxy localhost:3000
}
EOF

sudo systemctl enable caddy
sudo systemctl restart caddy

echo ""
echo "=== DONE ==="
echo "App running at http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo ""
echo "For HTTPS with a domain, edit /etc/caddy/Caddyfile:"
echo "  Replace ':80' with 'demo.yourdomain.com'"
echo "  Then: sudo systemctl restart caddy"
