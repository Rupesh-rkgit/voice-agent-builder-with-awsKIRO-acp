# EC2 Deployment Guide — Voice Agent Studio

## Prerequisites

- EC2 instance (t3.medium+ recommended)
- Node.js 20+, npm
- Kiro CLI installed and authenticated
- HTTPS (required for browser microphone access)

---

## 1. IAM Role for EC2

Attach an IAM instance profile so the app gets Transcribe + Polly access without hardcoded keys.

### Policy: `VoiceAgentStudioPolicy`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TranscribeStreaming",
      "Effect": "Allow",
      "Action": [
        "transcribe:StartStreamTranscription"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PollySynthesize",
      "Effect": "Allow",
      "Action": [
        "polly:SynthesizeSpeech",
        "polly:DescribeVoices"
      ],
      "Resource": "*"
    }
  ]
}
```

### Create and attach:

```bash
# Create the policy
aws iam create-policy \
  --policy-name VoiceAgentStudioPolicy \
  --policy-document file://voice-policy.json

# Create role for EC2
aws iam create-role \
  --role-name VoiceAgentStudioRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policy to role
aws iam attach-role-policy \
  --role-name VoiceAgentStudioRole \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/VoiceAgentStudioPolicy

# Create instance profile and add role
aws iam create-instance-profile --instance-profile-name VoiceAgentStudioProfile
aws iam add-role-to-instance-profile \
  --instance-profile-name VoiceAgentStudioProfile \
  --role-name VoiceAgentStudioRole

# Attach to running EC2 instance
aws ec2 associate-iam-instance-profile \
  --instance-id <INSTANCE_ID> \
  --iam-instance-profile Name=VoiceAgentStudioProfile
```

> With an instance profile, the AWS SDK auto-discovers credentials via IMDS. No `AWS_ACCESS_KEY_ID` needed in `.env.local`.

---

## 2. Security Group

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <SG_ID> \
  --protocol tcp --port 443 --cidr 0.0.0.0/0    # HTTPS (required for mic access)

aws ec2 authorize-security-group-ingress \
  --group-id <SG_ID> \
  --protocol tcp --port 3000 --cidr 0.0.0.0/0   # Next.js (dev/direct access)
```

**Critical:** Browsers require HTTPS for `getUserMedia()` (microphone). On EC2 you need either:
- An ALB with ACM certificate terminating TLS → forwarding to port 3000
- Nginx/Caddy reverse proxy with Let's Encrypt
- `localhost` (only works if accessing from the EC2 itself)

---

## 3. Environment Configuration

Create `.env.local` on the EC2 instance:

```bash
# No AWS keys needed — instance profile provides them
AWS_REGION=us-east-1

# Voice
VOICE_PROVIDER=auto
TRANSCRIBE_LANGUAGE_CODE=en-US
POLLY_VOICE_ID=Joanna
POLLY_ENGINE=neural

# Kiro CLI
KIRO_CLI_PATH=/usr/bin/kiro-cli
KIRO_WORKSPACE_DIR=/home/ec2-user/voice-agent-studio

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
NODE_ENV=production
MAX_ACP_SESSIONS=10
```

---

## 4. Build & Run

```bash
cd /home/ec2-user/voice-agent-studio
npm ci
npm run build
npm start          # Starts on port 3000
```

For production, use PM2:

```bash
npm install -g pm2
pm2 start npm --name voice-agent -- start
pm2 save
pm2 startup        # Auto-start on reboot
```

---

## 5. HTTPS with Caddy (simplest option)

```bash
# Install Caddy
sudo yum install -y yum-plugin-copr
sudo yum copr enable @caddy/caddy -y
sudo yum install -y caddy

# /etc/caddy/Caddyfile
echo 'your-domain.com {
  reverse_proxy localhost:3000
}' | sudo tee /etc/caddy/Caddyfile

sudo systemctl enable --now caddy
```

Caddy auto-provisions Let's Encrypt certificates. Point your domain's DNS A record to the EC2 public IP.

---

## 6. What Changes vs Local Dev

| Concern | Local | EC2 |
|---------|-------|-----|
| AWS credentials | `~/.aws/credentials` or env vars | IAM instance profile (automatic) |
| HTTPS | Not needed (localhost exempt) | Required for microphone access |
| `VOICE_PROVIDER` | `auto` or `webspeech` for testing | `auto` (will resolve to `aws`) |
| Polly/Transcribe latency | ~100-300ms (internet round-trip) | ~20-50ms (same-region VPC) |
| `AWS_ACCESS_KEY_ID` | May be set | Remove — instance profile is better |

---

## 7. Fallback Behavior

The app auto-detects at runtime:

```
Page loads → GET /api/voice/capabilities
  ├─ AWS creds valid + Transcribe + Polly reachable → provider: "aws"
  └─ Any failure → provider: "webspeech" (browser APIs)
```

- On EC2 with instance profile: always resolves to `aws`
- On local dev without AWS creds: falls back to `webspeech`
- Set `VOICE_PROVIDER=webspeech` to force browser-only mode anywhere

---

## 8. Cost Estimate (EC2 + Voice)

| Resource | Monthly Cost |
|----------|-------------|
| t3.medium (on-demand) | ~$30 |
| Transcribe Streaming (2 hrs/day) | ~$86 |
| Polly Neural (500 responses/day × 100 chars) | Free tier (1M chars/mo) |
| ALB + ACM cert | ~$18 |
| **Total** | **~$134/mo** |

Use Reserved Instances or Savings Plans for EC2 to cut costs ~40%.
