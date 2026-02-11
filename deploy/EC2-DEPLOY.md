# EC2 Deployment Guide (Demo/MVP)

Single EC2 instance, no containers, no orchestration. ~15 min setup.

## Architecture

```
Internet → EC2 (t3.medium) → Caddy (:80/:443) → Next.js (:3000) → kiro-cli (stdio)
                                                       ↓
                                                  SQLite (local disk)
                                                  .kiro/agents/ (local disk)
```

## Step 1 — Launch EC2

**Console or CLI:**

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
| HTTPS | 443 | 0.0.0.0/0 | Web traffic (if using domain) |

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

> Polly and Transcribe are not needed — the app uses the browser's Web Speech API for voice input.

## Step 2 — Install Kiro CLI on EC2

SSH in and install kiro-cli:

```bash
ssh -i <key>.pem ec2-user@<PUBLIC_IP>

# Install kiro-cli (check docs for latest method)
curl -fsSL https://kiro.dev/install.sh | bash
# OR download the binary directly
kiro-cli --version
kiro-cli auth login   # authenticate
```

## Step 3 — Run Setup Script

```bash
# Clone your repo (or scp the code)
git clone <YOUR_REPO_URL> ~/voice-agent-studio
cd ~/voice-agent-studio

# Run setup
bash deploy/ec2-setup.sh
```

## Step 4 — Configure Environment

```bash
cd ~/voice-agent-studio
nano .env.local
```

```env
KIRO_CLI_PATH=/home/ec2-user/.local/bin/kiro-cli
KIRO_WORKSPACE_DIR=/home/ec2-user/voice-agent-studio
AWS_REGION=us-east-1
MAX_ACP_SESSIONS=10
```

## Step 5 — Start

```bash
bash deploy/ec2-start.sh
```

App is now live at `http://<EC2_PUBLIC_IP>`.

## Optional: Custom Domain + HTTPS

1. Point your domain's DNS (A record) to the EC2 public IP
2. Edit Caddy config:

```bash
sudo nano /etc/caddy/Caddyfile
```

Change `:80` to your domain:

```
demo.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy auto-provisions a Let's Encrypt certificate. Zero config.

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
