# Environment Setup & Prerequisites

## Prerequisites

Before running this project, you need:

### 1. Kiro CLI (Required)
```bash
# Install Kiro CLI
# See: https://kiro.dev/cli/

# Verify installation
kiro-cli --version

# Authenticate (one-time)
kiro-cli auth login
```

### 2. Node.js 20+ (Required)
```bash
node --version   # Must be >= 20.0.0
npm --version    # Must be >= 10.0.0
```

### 3. AWS Account & Credentials (Required for voice features)
You need an AWS account with access to:
- Amazon Transcribe (speech-to-text)
- Amazon Polly (text-to-speech)
- Amazon Bedrock (optional, for intent parsing fallback)

---

## Environment Variables

Create `.env.local` in the project root:

```bash
# ============================================
# KIRO CLI
# ============================================
# Path to kiro-cli binary (find with: which kiro-cli)
KIRO_CLI_PATH=/home/rupeshrk3/.local/bin/kiro-cli

# Workspace directory where .kiro/agents/ will be created
KIRO_WORKSPACE_DIR=/home/rupeshrk3/voice-agent-studio

# ============================================
# AWS CREDENTIALS
# ============================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>

# (Optional) If using AWS SSO / named profile instead:
# AWS_PROFILE=your-profile-name

# ============================================
# AWS TRANSCRIBE (Speech-to-Text)
# ============================================
# Language for transcription
TRANSCRIBE_LANGUAGE_CODE=en-US

# ============================================
# AWS POLLY (Text-to-Speech)
# ============================================
POLLY_VOICE_ID=Joanna
POLLY_ENGINE=neural

# ============================================
# AWS BEDROCK (Optional — for intent parsing)
# ============================================
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0
# BEDROCK_ENDPOINT=https://bedrock-runtime.us-east-1.amazonaws.com

# ============================================
# APP CONFIG
# ============================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# ============================================
# AUTH (NextAuth.js)
# ============================================
NEXTAUTH_SECRET=<generate-with: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

# ============================================
# DATABASE
# ============================================
DATABASE_URL=file:./data/voice-agent-studio.db
```

---

## What You Need to Provide

| Variable | Where to Get It | Required? |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM Console → Create access key | Yes (for voice) |
| `AWS_SECRET_ACCESS_KEY` | Same as above | Yes (for voice) |
| `AWS_REGION` | Your preferred region | Yes |
| `KIRO_CLI_PATH` | Run `which kiro-cli` | Yes |
| `BEDROCK_MODEL_ID` | Bedrock Console → Model access | Optional |
| `NEXTAUTH_SECRET` | Generate: `openssl rand -base64 32` | Yes |

---

## AWS IAM Permissions Needed

Your AWS credentials need these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TranscribeAccess",
      "Effect": "Allow",
      "Action": [
        "transcribe:StartStreamTranscription",
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PollyAccess",
      "Effect": "Allow",
      "Action": [
        "polly:SynthesizeSpeech",
        "polly:DescribeVoices"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BedrockAccess",
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

---

## Quick Start (After Setup)

```bash
cd voice-agent-studio

# Install dependencies
npm install

# Initialize database
npm run db:push

# Create .kiro/agents directory
mkdir -p .kiro/agents

# Start dev server
npm run dev

# Open http://localhost:3000
```
