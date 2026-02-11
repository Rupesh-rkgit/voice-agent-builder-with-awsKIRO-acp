#!/bin/bash
# Voice Agent Studio — EC2 Single-Instance Deployment
# Run this on a fresh Amazon Linux 2023 instance
# Usage: bash ec2-setup.sh

set -euo pipefail

APP_DIR="/home/ec2-user/voice-agent-studio"
NODE_VERSION="20"

echo "=== 1. System packages ==="
sudo dnf update -y
sudo dnf install -y git gcc-c++ make

echo "=== 2. Node.js 20 via nvm ==="
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install $NODE_VERSION
nvm use $NODE_VERSION

echo "=== 3. pm2 (process manager) ==="
npm install -g pm2

echo "=== 4. Caddy (reverse proxy + auto HTTPS) ==="
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy

echo "=== 5. Clone and build app ==="
cd /home/ec2-user
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && git pull
else
  git clone <YOUR_REPO_URL> voice-agent-studio
  cd "$APP_DIR"
fi

npm install
cp .env.example .env.local

echo ""
echo "============================================"
echo "  EDIT .env.local BEFORE CONTINUING"
echo "  Set KIRO_CLI_PATH and KIRO_WORKSPACE_DIR"
echo "============================================"
echo ""
echo "Then run: bash deploy/ec2-start.sh"
