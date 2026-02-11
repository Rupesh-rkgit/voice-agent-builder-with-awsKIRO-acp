# EC2 Deployment Guide (Amazon Linux 2023)

Single EC2 instance, no containers, no orchestration. ~15 min setup.

## Architecture

```
Internet → EC2 (t3.medium)
              ↕
           Caddy (:80 + :443)    ← reverse proxy, self-signed TLS or Let's Encrypt
              ↕
           Next.js (:3000)       ← managed by pm2
              ↕
           kiro-cli (stdio)      ← ACP child processes
              ↕
           SQLite + .kiro/agents/ (local disk)
```

## Step 1 — Launch EC2

```bash
aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.medium \
  --key-name <YOUR_KEY_PAIR> \
  --security-group-ids <SG_ID> \
  --iam-instance-profile Name=<INSTANCE_PROFILE> \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=voice-agent-studio}]' \
  --region us-east-1
```

**Security group rules:**

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | Your IP | SSH access |
| HTTP | 80 | 0.0.0.0/0 | Web traffic |
| HTTPS | 443 | 0.0.0.0/0 | Web traffic (self-signed or domain) |

**IAM instance profile permissions** (for Kiro CLI's Bedrock access):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    }
  ]
}
```

## Step 2 — Install Kiro CLI on EC2

```bash
ssh -i <key>.pem ec2-user@<PUBLIC_IP>

# Install kiro-cli (check docs for latest method)
curl -fsSL https://kiro.dev/install.sh | bash
kiro-cli --version
kiro-cli auth login
```

## Step 3 — Clone & Run Setup

```bash
git clone <YOUR_REPO_URL> ~/voice-agent-builder-with-awsKIRO-acp
cd ~/voice-agent-builder-with-awsKIRO-acp

bash deploy/ec2-setup.sh
```

This installs Node.js 20, pm2, Caddy (binary), generates a self-signed TLS cert, and runs `npm ci`.

## Step 4 — Configure Environment

```bash
nano .env.local
```

```env
KIRO_CLI_PATH=/home/ec2-user/.local/bin/kiro-cli
KIRO_WORKSPACE_DIR=/home/ec2-user/voice-agent-builder-with-awsKIRO-acp
AWS_REGION=us-east-1
MAX_ACP_SESSIONS=10
```

## Step 5 — Start

**Without a domain** (HTTP + self-signed HTTPS):

```bash
bash deploy/ec2-start.sh
```

**With a domain** (auto Let's Encrypt HTTPS):

```bash
bash deploy/ec2-start.sh demo.yourdomain.com
```

App is now live:
- `http://<EC2_PUBLIC_IP>` — plain HTTP
- `https://<EC2_PUBLIC_IP>` — self-signed (browser warning expected)
- `https://demo.yourdomain.com` — if domain provided (valid cert, no warning)

## What the Scripts Do

| Script | Purpose |
|--------|---------|
| `ec2-setup.sh` | One-time: installs system deps, Node.js, pm2, Caddy binary + systemd unit, self-signed cert, runs `npm ci` |
| `ec2-start.sh` | Repeatable: builds app, starts pm2, writes Caddyfile, enables Caddy |

**Caddy is installed as a binary** (not via dnf/copr — those don't work on Amazon Linux). The setup script creates the systemd service file, the `caddy` system user, and all required directories.

## Useful Commands

```bash
# App logs
pm2 logs voice-agent-studio

# Restart app
pm2 restart voice-agent-studio

# Rebuild after code changes
cd ~/voice-agent-studio && git pull && npm run build && pm2 restart voice-agent-studio

# Check status
pm2 status

# Caddy logs
sudo journalctl -u caddy -f
```

## Cost Breakdown (1 month)

| Resource | Cost |
|----------|------|
| t3.medium on-demand | ~$30 |
| 20GB gp3 EBS | ~$1.60 |
| Data transfer (demo) | ~$1-2 |
| **Total** | **~$33/month** |

Use a spot instance to cut to ~$12/month (fine for demo, may get interrupted rarely).

## Teardown

When the demo is done:

```bash
# Terminate the instance (stops all billing)
aws ec2 terminate-instances --instance-ids <INSTANCE_ID> --region us-east-1
```

SQLite data and agent configs live on the instance's EBS volume. If you want to keep them, snapshot the volume first:

```bash
aws ec2 create-snapshot --volume-id <VOL_ID> --description "voice-agent-studio backup" --region us-east-1
```
