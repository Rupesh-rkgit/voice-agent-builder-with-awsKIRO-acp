# Voice Agent Studio — Local Setup Guide (WSL)

This guide walks you through setting up Voice Agent Studio from scratch on a Windows machine using WSL (Windows Subsystem for Linux). Every tool is installed **inside WSL**, not on Windows.

> **Important:** All commands in this guide must be run inside the WSL terminal, never in PowerShell or CMD.

---

## Table of Contents

1. [Install WSL](#step-1--install-wsl)
2. [Install Git](#step-2--install-git)
3. [Install Build Tools (for SQLite)](#step-3--install-build-tools-for-sqlite)
4. [Install Node.js 20 via nvm](#step-4--install-nodejs-20-via-nvm)
5. [Install Kiro CLI](#step-5--install-kiro-cli)
6. [Clone & Set Up the Project](#step-6--clone--set-up-the-project)
7. [Configure Environment Variables](#step-7--configure-environment-variables)
8. [Install Dependencies & Run](#step-8--install-dependencies--run)
9. [Verify Everything Works](#step-9--verify-everything-works)
10. [Enable AWS Voice (Polly + Transcribe)](#step-10--enable-aws-voice-polly--transcribe)
11. [Daily Usage](#daily-usage)
12. [Troubleshooting](#troubleshooting)
13. [Voice Architecture](#voice-architecture)

---

## Step 1 — Install WSL

WSL lets you run a full Linux environment inside Windows.

### 1.1 Open PowerShell as Administrator

- Press `Win + X` → click **Terminal (Admin)** or **PowerShell (Admin)**

### 1.2 Install WSL with Ubuntu

```powershell
wsl --install
```

This installs WSL 2 with Ubuntu by default. If WSL is already installed but you don't have Ubuntu:

```powershell
wsl --install -d Ubuntu
```

### 1.3 Restart your computer

After the install finishes, **restart your PC**.

### 1.4 Set up your Linux user

After restart, Ubuntu will open automatically and ask you to create a username and password.

- Pick a simple username (lowercase, no spaces) — e.g., `john`
- Pick a password you'll remember (you'll need it for `sudo` commands)
- **Note:** When typing the password, nothing will appear on screen — that's normal, just type and press Enter

### 1.5 Open WSL going forward

From now on, open WSL by:
- Searching for **Ubuntu** in the Start menu, OR
- Opening **Windows Terminal** and selecting the **Ubuntu** tab, OR
- Typing `wsl` in PowerShell/CMD

### 1.6 Update the system

Run this inside WSL:

```bash
sudo apt update && sudo apt upgrade -y
```

Enter your password when prompted.

---

## Step 2 — Install Git

### 2.1 Install Git

```bash
sudo apt install git -y
```

### 2.2 Verify

```bash
git --version
# Expected: git version 2.43.0 or higher
```

### 2.3 Configure Git (one-time)

Replace with your actual name and email:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## Step 3 — Install Build Tools (for SQLite)

The app uses `better-sqlite3`, a native Node.js module that compiles from C source during `npm install`. Without these tools, the install will fail.

```bash
sudo apt install build-essential python3 -y
```

Verify all three work:

```bash
gcc --version && make --version && python3 --version
```

---

## Step 4 — Install Node.js 20 via nvm

The project requires **exactly Node.js 20** (not 18, not 22).

### 4.1 Install nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

### 4.2 Activate nvm

Close and reopen your WSL terminal, OR run:

```bash
source ~/.bashrc
```

### 4.3 Install Node 20 and set as default

```bash
nvm install 20
nvm alias default 20
```

### 4.4 Verify

```bash
node --version   # Should print: v20.x.x
npm --version    # Should print: 10.x.x
```

---

## Step 5 — Install Kiro CLI

Kiro CLI is the backend that powers all AI/LLM features in the app.

### 5.1 Install

```bash
curl -fsSL https://kiro.dev/install.sh | bash
```

### 5.2 Add to PATH (if needed)

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 5.3 Verify and authenticate

```bash
kiro-cli --version    # Should print 1.25.0 or higher
kiro-cli auth login   # Opens browser for SSO login — complete it
kiro-cli auth status  # Should show logged-in
```

> **Note:** Kiro CLI tokens expire every 8-12 hours. When the app shows "Failed to connect to Kiro agent", run `kiro-cli auth login` again.

---

## Step 6 — Clone & Set Up the Project

```bash
cd ~
git clone <repo-url> voice-agent-studio
cd voice-agent-studio
nvm use    # Switches to Node 20 (reads .nvmrc)
mkdir -p .kiro/agents
```

Replace `<repo-url>` with the actual Git URL you were given.

---

## Step 7 — Configure Environment Variables

### 7.1 Create the env file

```bash
cp .env.example .env.local
```

### 7.2 Edit the env file

```bash
nano .env.local
```

Update these two lines with YOUR values:

```bash
KIRO_CLI_PATH=/home/youruser/.local/bin/kiro-cli    # paste output of: which kiro-cli
KIRO_WORKSPACE_DIR=/home/youruser/voice-agent-studio # paste output of: pwd
```

Everything else can stay as defaults. The key defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AWS_REGION` | `us-east-1` | AWS region for all services |
| `VOICE_PROVIDER` | `auto` | Auto-detects AWS, falls back to browser Web Speech API |
| `POLLY_VOICE_ID` | `Joanna` | AWS Polly neural voice |
| `POLLY_ENGINE` | `neural` | Higher quality Polly engine |

### 7.3 Save and exit

- Press `Ctrl + O` → Enter (save)
- Press `Ctrl + X` (exit)

---

## Step 8 — Install Dependencies & Run

### 8.1 Install packages

```bash
npm install
```

Takes 1-3 minutes. If it fails with `node-gyp` / `gcc` / `python` errors → go back to [Step 3](#step-3--install-build-tools-for-sqlite).

### 8.2 Start the dev server

```bash
npm run dev
```

Expected output:

```
▲ Next.js 16.1.6
- Local:   http://localhost:3000

✓ Ready in 2.3s
```

### 8.3 Open in browser

Open **Google Chrome** on Windows and go to:

```
http://localhost:3000
```

> WSL automatically forwards localhost ports to Windows.

---

## Step 9 — Verify Everything Works

| Check | How | Expected |
|-------|-----|----------|
| App loads | Open `http://localhost:3000` | Dashboard with agent grid |
| Kiro CLI auth | `kiro-cli auth status` in WSL | Shows logged-in |
| Create agent | Use the conversation builder | Agent appears in grid |
| Chat works | Click an agent → send a message | Streaming response |
| Voice input | Click 🎤 in chat (Chrome only) | "Listening..." appears, transcript fills in |
| Voice output | Use conversation builder | Agent speaks responses aloud |
| Voice provider | Open `http://localhost:3000/api/voice/capabilities` | See provider status (see below) |

### Voice capabilities response

**Without AWS credentials (default):**
```json
{"provider":"webspeech","transcribe":false,"polly":false}
```
Voice still works — uses Chrome's built-in speech recognition and synthesis.

**With AWS credentials configured ([Step 10](#step-10--enable-aws-voice-polly--transcribe)):**
```json
{"provider":"aws","transcribe":true,"polly":true}
```
Higher quality — uses AWS Polly (TTS) and AWS Transcribe (STT).

### Browser requirements

- **Google Chrome required** — Firefox/Safari don't support Web Speech API
- **Microphone access** — allow when Chrome prompts
- Voice works in WSL because it runs entirely in the browser, not in Linux

---

## Step 10 — Enable AWS Voice (Polly + Transcribe)

> **This step is optional.** Without it, voice uses Chrome's built-in Web Speech API. With it, you get higher-quality AWS Polly neural voices (TTS) and AWS Transcribe (STT).

### 10.1 Install AWS CLI

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
sudo apt install unzip -y
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
aws --version
```

### 10.2 Authenticate — pick your method

#### Method A: Corporate SSO / IAM Identity Center (recommended for Accenture, enterprise)

```bash
aws login
```

This opens a browser for SSO login. Complete it, then add `credential_process` to your AWS config so the Node.js SDK can resolve credentials:

```bash
# Check your current config
cat ~/.aws/config

# Add credential_process line — run this once:
echo 'credential_process = aws configure export-credentials --format process' >> ~/.aws/config
```

Your `~/.aws/config` should look like:

```ini
[default]
login_session = arn:aws:sts::ACCOUNT_ID:assumed-role/ROLE/your.email@company.com
region = us-east-1
credential_process = aws configure export-credentials --format process
```

Verify it works:

```bash
aws sts get-caller-identity
```

> **Why `credential_process`?** The `aws login` command stores tokens in a format the AWS CLI understands, but the Node.js AWS SDK doesn't pick up natively. The `credential_process` line tells the SDK to ask the CLI for temporary credentials, bridging the gap.

#### Method B: IAM Access Keys (simpler, for personal AWS accounts)

```bash
aws configure
```

Enter when prompted:
- **AWS Access Key ID:** (from your AWS admin or IAM console)
- **AWS Secret Access Key:** (from your AWS admin or IAM console)
- **Default region:** `us-east-1`
- **Output format:** `json`

### 10.3 Verify AWS services

```bash
# Test Polly
aws polly describe-voices --language-code en-US --engine neural --query 'Voices[0].Name' --output text
# Expected: Joanna (or another voice name)

# Test Transcribe
aws transcribe list-vocabularies --max-results 1
# Expected: {"Vocabularies": []}
```

If you get "access denied", your IAM role/user needs these permissions:

```
polly:SynthesizeSpeech
polly:DescribeVoices
transcribe:StartStreamTranscription
```

Ask your AWS admin to attach `AmazonPollyReadOnlyAccess` and `AmazonTranscribeFullAccess` policies.

### 10.4 Restart the dev server

```bash
# Stop with Ctrl+C, then:
npm run dev
```

### 10.5 Verify AWS voice is active

Open in browser:

```
http://localhost:3000/api/voice/capabilities
```

Expected:

```json
{"provider":"aws","transcribe":true,"polly":true}
```

You should also see in the WSL terminal:

```
[voice/capabilities] Result: {"provider":"aws","transcribe":true,"polly":true}
[voice/synthesize] ✅ POLLY REQUEST — text="Hello...", voice=Joanna
[voice/transcribe] ✅ TRANSCRIBE REQUEST received
```

---

## Daily Usage

### Start the app

```bash
cd ~/voice-agent-studio
nvm use
npm run dev
# Open http://localhost:3000 in Chrome
```

### If Kiro CLI auth expired

```bash
kiro-cli auth login
# Complete browser login, restart dev server
```

### If AWS SSO session expired (Method A users)

```bash
aws login
# Complete browser login, restart dev server
```

### Stop the server

Press `Ctrl + C` in the WSL terminal.

---

## Troubleshooting

### `npm install` fails with "node-gyp" or "better-sqlite3" errors

```bash
sudo apt install build-essential python3 -y
npm install
```

### `node: command not found`

```bash
source ~/.bashrc
nvm use 20
```

### `kiro-cli: command not found`

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### "Failed to connect to Kiro agent" in the app

Kiro CLI auth expired:

```bash
kiro-cli auth login
```

### `localhost:3000` doesn't load in Windows browser

1. Make sure `npm run dev` is running in WSL
2. Try `http://127.0.0.1:3000`
3. If still broken, find your WSL IP:
   ```bash
   hostname -I
   ```
   Then try `http://<that-ip>:3000`

### Voice capabilities shows `webspeech` even after AWS setup

1. Check credentials work: `aws sts get-caller-identity`
2. If expired: `aws login` (SSO) or check `aws configure` (IAM keys)
3. Make sure `credential_process` line is in `~/.aws/config` (SSO users)
4. Restart the dev server — capabilities are cached for 60 seconds

### Permission denied errors

```bash
sudo chown -R $(whoami) ~/voice-agent-studio
```

### SQLite "database is locked"

Only one dev server instance can run at a time:

```bash
pkill -f "next dev"
npm run dev
```

### Port 3000 already in use

```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

### Windows Defender / Firewall blocking

1. Open **Windows Security** → **Firewall & network protection**
2. Click **Allow an app through firewall**
3. Add `node` when prompted

---

## Voice Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  With AWS credentials (VOICE_PROVIDER=auto, AWS detected)           │
│                                                                      │
│  Voice INPUT:  🎤 → Mic → AudioContext PCM → /api/voice/transcribe  │
│                     → AWS Transcribe Streaming → transcript          │
│                                                                      │
│  Voice OUTPUT: 📢 → /api/voice/synthesize → AWS Polly (neural)     │
│                     → mp3 audio → browser playback                   │
├──────────────────────────────────────────────────────────────────────┤
│  Without AWS credentials (fallback)                                  │
│                                                                      │
│  Voice INPUT:  🎤 → Chrome SpeechRecognition API → Google STT      │
│  Voice OUTPUT: 📢 → Chrome SpeechSynthesis API → OS voices         │
└──────────────────────────────────────────────────────────────────────┘
```

The `VOICE_PROVIDER` env var controls behavior:

| Value | Behavior |
|-------|----------|
| `auto` (default) | Probes AWS on startup. If Polly + Transcribe respond → uses AWS. Otherwise → falls back to browser Web Speech API. |
| `aws` | Forces AWS only. Fails if no credentials. |
| `webspeech` | Skips AWS entirely. Uses browser APIs only. |

---

## Summary of What Gets Installed

| Tool | Installed Where | Purpose |
|------|----------------|---------|
| WSL + Ubuntu | Windows (system-level) | Linux environment |
| Git | WSL (`/usr/bin/git`) | Clone the repository |
| build-essential | WSL (apt) | Compile native modules (SQLite) |
| python3 | WSL (apt) | Required by node-gyp |
| nvm | WSL (`~/.nvm/`) | Manage Node.js versions |
| Node.js 20 | WSL (`~/.nvm/versions/node/`) | JavaScript runtime |
| npm 10 | WSL (bundled with Node) | Package manager |
| Kiro CLI | WSL (`~/.local/bin/kiro-cli`) | AI/LLM backend (ACP) |
| AWS CLI | WSL (`/usr/local/bin/aws`) | AWS credential management (optional) |
| better-sqlite3 | WSL (compiled during npm install) | SQLite database for chat history |
