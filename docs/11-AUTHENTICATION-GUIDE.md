# Authentication & Credentials Guide

## Table of Contents

1. [Authentication Layers](#authentication-layers)
2. [Kiro CLI Authentication (Required)](#kiro-cli-authentication)
3. [AWS Bedrock — Direct Access (Optional)](#aws-bedrock-direct)
4. [AWS Polly & Transcribe (Optional, Future)](#aws-polly-transcribe)
5. [When Is Each Auth Needed?](#when-is-each-auth-needed)
6. [Troubleshooting Auth Issues](#troubleshooting)

---

## Authentication Layers

Voice Agent Studio has three independent authentication paths:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Layers                          │
│                                                                   │
│  Layer 1: Kiro CLI (REQUIRED)                                    │
│  ├── How: IAM Identity Center (SSO) via `kiro-cli login`        │
│  ├── Used by: Chat, Agent Builder, all LLM interactions          │
│  └── Credential: Managed by kiro-cli internally                  │
│                                                                   │
│  Layer 2: AWS Bedrock Direct (OPTIONAL — currently inactive)     │
│  ├── How: Bearer token OR IAM access keys                        │
│  ├── Used by: Direct Bedrock Converse API (backup path)          │
│  └── Credential: AWS_BEARER_TOKEN_BEDROCK or ACCESS_KEY_ID       │
│                                                                   │
│  Layer 3: AWS Polly/Transcribe (OPTIONAL — future)               │
│  ├── How: IAM access keys with specific permissions              │
│  ├── Used by: Voice synthesis and transcription                  │
│  └── Credential: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Kiro CLI Authentication (Required)

This is the only authentication needed for the app to work.

### Setup

```bash
# 1. Install kiro-cli
# (Already installed at /usr/bin/kiro-cli)

# 2. Login via IAM Identity Center
kiro-cli login

# 3. Verify
kiro-cli whoami
# Output: Logged in with IAM Identity Center (user: YourName)

# 4. Verify ACP works
echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | kiro-cli acp
```

### How It Works

1. `kiro-cli login` opens a browser for SSO authentication
2. Kiro CLI stores tokens internally (not in `.env.local`)
3. When our app spawns `kiro-cli acp`, the child process inherits the auth
4. Kiro CLI handles all Bedrock API calls with its own SigV4 signing
5. We never see or manage AWS credentials for this path

### Token Refresh

- SSO tokens expire (typically 8-12 hours)
- When expired, ACP calls will fail
- Fix: run `kiro-cli login` again
- The app will show "Failed to connect to Kiro agent" when tokens expire

### What Kiro CLI Auth Enables

| Feature | Needs Kiro Auth? |
|---|---|
| Agent Builder (LLM conversation) | ✅ Yes |
| Chat with agents | ✅ Yes |
| Agent CRUD (create/edit/delete) | ❌ No (filesystem only) |
| Dashboard | ❌ No (filesystem only) |
| Voice input (Web Speech API) | ❌ No (browser-side) |

---

## AWS Bedrock — Direct Access (Optional)

This is the backup path for when you want to call Bedrock directly instead of through kiro-cli. Currently inactive because the SCP on the test account blocks `bedrock:InvokeModel*`.

### Option A: Bearer Token (Bedrock API Key)

```bash
# In .env.local
AWS_BEARER_TOKEN_BEDROCK=your-bedrock-api-key
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0
```

The app injects `Authorization: Bearer <token>` into Bedrock API requests and disables SigV4 signing.

**How to get a Bedrock API key:**
1. Go to AWS Console → Amazon Bedrock → API Keys
2. Generate a new key
3. Copy the key value

**Required IAM permissions for the API key user:**
```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "arn:aws:bedrock:*::foundation-model/*"
}
```

### Option B: IAM Access Keys

```bash
# In .env.local
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0
```

Standard SigV4 signing. The IAM user/role needs the same Bedrock permissions above.

### Switching to Direct Bedrock

To use Bedrock directly instead of kiro-cli for the builder:

1. Update `src/app/api/builder/chat/route.ts`:
   ```typescript
   // Change from:
   import { streamBuilderPrompt } from "@/lib/acp/builder-provider";
   // To:
   import { streamBuilderChat } from "@/lib/bedrock/converse-bedrock";
   ```
2. Update the route handler to use `streamBuilderChat(messages)` instead of `streamBuilderPrompt()`
3. Add credentials to `.env.local`

---

## AWS Polly & Transcribe (Optional, Future)

For voice synthesis (text-to-speech) and server-side transcription.

```bash
# In .env.local
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
POLLY_VOICE_ID=Joanna
POLLY_ENGINE=neural
TRANSCRIBE_LANGUAGE_CODE=en-US
```

**Required IAM permissions:**
```json
{
  "Effect": "Allow",
  "Action": [
    "polly:SynthesizeSpeech",
    "transcribe:StartStreamTranscription"
  ],
  "Resource": "*"
}
```

Currently, voice input uses the browser's Web Speech API (Chrome only, no AWS credentials needed). Polly TTS is wired but not connected to the UI yet.

---

## When Is Each Auth Needed?

| User Action | Auth Required | Why |
|---|---|---|
| View dashboard | None | Reads local JSON files |
| Create agent via builder | Kiro CLI SSO | Builder uses ACP → kiro-cli → Bedrock |
| Create agent manually (API) | None | Writes local JSON files |
| Chat with agent | Kiro CLI SSO | Chat uses ACP → kiro-cli → Bedrock |
| Edit agent config | None | Reads/writes local JSON files |
| Delete agent | None | Deletes local JSON files |
| Voice input (mic) | None | Browser Web Speech API |
| Voice output (TTS) | AWS keys (Polly) | Calls AWS Polly API |
| Server-side transcription | AWS keys (Transcribe) | Calls AWS Transcribe API |

---

## Troubleshooting

### "Failed to connect to Kiro agent"
- Run `kiro-cli whoami` — if it fails, run `kiro-cli login`
- Check `KIRO_CLI_PATH` in `.env.local` matches `which kiro-cli`
- Check `KIRO_WORKSPACE_DIR` points to the project root

### "Connecting..." hangs forever
- This was caused by `session/set_mode` using `mode` instead of `modeId` (fixed)
- If it happens again, check the Next.js server logs for ACP errors

### "SCP explicit deny" on Bedrock
- This is an AWS Organizations policy blocking Bedrock access
- Only affects direct Bedrock calls (not kiro-cli path)
- Contact your AWS org admin to update the SCP
- Or use a different AWS account

### ACP process crashes
- Check `kiro-cli --version` — must be 1.25.0+
- Check stderr output in Next.js server logs (`[kiro-acp stderr]` prefix)
- Max 10 concurrent sessions — old ones are evicted

### Agent not appearing in ACP modes
- Agent JSON must be in `.kiro/agents/` under the `cwd` passed to `session/new`
- File must have `.json` extension (not `.json.example`)
- File must be valid JSON matching the Kiro agent config format
