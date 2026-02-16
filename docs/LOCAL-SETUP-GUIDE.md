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
6. [Configure AWS Credentials](#step-6--configure-aws-credentials)
7. [Clone & Set Up the Project](#step-7--clone--set-up-the-project)
8. [Configure Environment Variables](#step-8--configure-environment-variables)
9. [Install Dependencies & Run](#step-9--install-dependencies--run)
10. [Verify Everything Works](#step-10--verify-everything-works)
11. [Daily Usage](#daily-usage)
12. [Troubleshooting](#troubleshooting)

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

Git is needed to clone the project repository.

### 2.1 Install Git

```bash
sudo apt install git -y
```

### 2.2 Verify

```bash
git --version
```

You should see something like `git version 2.43.0`.

### 2.3 Configure Git (one-time)

Replace with your actual name and email:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## Step 3 — Install Build Tools (for SQLite)

The app uses `better-sqlite3`, which is a native Node.js module. It needs to be compiled from C source code during `npm install`. Without these tools, the install will fail.

### 3.1 Install the required packages

```bash
sudo apt install build-essential python3 -y
```

This installs:
- `gcc` / `g++` — C/C++ compilers
- `make` — build automation
- `python3` — needed by `node-gyp` (the native module builder)

### 3.2 Verify

```bash
gcc --version
make --version
python3 --version
```

All three should print version numbers without errors.

---

## Step 4 — Install Node.js 20 via nvm

The project requires **exactly Node.js 20** (not 18, not 22). We use `nvm` (Node Version Manager) to install and manage Node versions.

### 4.1 Install nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

### 4.2 Activate nvm

Close and reopen your WSL terminal, OR run:

```bash
source ~/.bashrc
```

### 4.3 Verify nvm is installed

```bash
nvm --version
```

Should print something like `0.40.1`.

### 4.4 Install Node.js 20

```bash
nvm install 20
```

### 4.5 Set Node 20 as default

```bash
nvm alias default 20
```

### 4.6 Verify Node and npm

```bash
node --version
# Should print: v20.x.x

npm --version
# Should print: 10.x.x
```

> **Why not install Node from apt?** The Ubuntu apt repository often has outdated Node versions. nvm gives you exact control and lets you switch versions easily.

---

## Step 5 — Install Kiro CLI

Kiro CLI is the backend that powers all AI/LLM features in the app.

### 5.1 Install Kiro CLI

Follow the official instructions at: https://kiro.dev/cli/

Typical install (check the site for the latest):

```bash
curl -fsSL https://kiro.dev/install.sh | bash
```

### 5.2 Add to PATH (if needed)

If `kiro-cli` isn't found after install, add it to your PATH. The installer usually puts it in `~/.local/bin`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 5.3 Verify installation

```bash
kiro-cli --version
```

Should print `1.25.0` or higher.

### 5.4 Authenticate Kiro CLI

```bash
kiro-cli auth login
```

This opens a browser window for SSO login. Complete the login in your browser.

### 5.5 Verify authentication

```bash
kiro-cli auth status
```

Should show you're logged in.

> **Note:** Kiro CLI SSO tokens expire every 8-12 hours. When the app shows "Failed to connect to Kiro agent", just run `kiro-cli auth login` again.

---

## Step 6 — Configure AWS Credentials

AWS credentials are needed for voice features (Polly, Transcribe). If you only need chat/builder features, you can skip this step — Kiro CLI handles its own auth for those.

### 6.1 Install AWS CLI

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
sudo apt install unzip -y
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
```

### 6.2 Verify

```bash
aws --version
```

### 6.3 Configure credentials

```bash
aws configure
```

Enter when prompted:
- **AWS Access Key ID:** (get from your AWS admin)
- **AWS Secret Access Key:** (get from your AWS admin)
- **Default region name:** `us-east-1`
- **Default output format:** `json`

### 6.4 Verify credentials work

```bash
aws sts get-caller-identity
```

Should print your account ID and user ARN without errors.

---

## Step 7 — Clone & Set Up the Project

### 7.1 Navigate to your home directory

```bash
cd ~
```

### 7.2 Clone the repository

Replace `<repo-url>` with the actual Git URL you were given:

```bash
git clone <repo-url> voice-agent-studio
```

If using a private repo with HTTPS, you may be prompted for credentials. If using SSH, make sure your SSH key is set up.

### 7.3 Enter the project directory

```bash
cd voice-agent-studio
```

### 7.4 Verify Node version matches

The project has a `.nvmrc` file that specifies Node 20:

```bash
nvm use
```

Should print: `Now using node v20.x.x`

### 7.5 Create the agents directory

```bash
mkdir -p .kiro/agents
```

---

## Step 8 — Configure Environment Variables

### 8.1 Create the env file

```bash
cp .env.example .env.local
```

### 8.2 Find your Kiro CLI path

```bash
which kiro-cli
```

Note the output (e.g., `/home/youruser/.local/bin/kiro-cli`).

### 8.3 Edit the env file

```bash
nano .env.local
```

Update these values (the rest can stay as defaults):

```bash
# REQUIRED — update these two lines with YOUR values
KIRO_CLI_PATH=/home/youruser/.local/bin/kiro-cli    # <-- paste output of 'which kiro-cli'
KIRO_WORKSPACE_DIR=/home/youruser/voice-agent-studio # <-- paste output of 'pwd'

# REQUIRED
AWS_REGION=us-east-1

# OPTIONAL — only if you have AWS keys for voice features
AWS_ACCESS_KEY_ID=your-key-here
AWS_SECRET_ACCESS_KEY=your-secret-here
```

### 8.4 Save and exit nano

- Press `Ctrl + O` → Enter (to save)
- Press `Ctrl + X` (to exit)

### 8.5 Get your full project path

If you're not sure what to put for `KIRO_WORKSPACE_DIR`:

```bash
pwd
```

Use that exact output.

---

## Step 9 — Install Dependencies & Run

### 9.1 Install npm packages

```bash
npm install
```

This will take 1-3 minutes. It downloads all JavaScript dependencies AND compiles `better-sqlite3` (the SQLite native module). If this step fails with errors about `node-gyp`, `gcc`, or `python`, go back to [Step 3](#step-3--install-build-tools-for-sqlite).

### 9.2 Start the development server

```bash
npm run dev
```

You should see output like:

```
  ▲ Next.js 16.1.6
  - Local:   http://localhost:3000
  - Network: http://172.x.x.x:3000

 ✓ Ready in 2.3s
```

### 9.3 Open in your browser

Open your **Windows** browser (Chrome recommended for voice features) and go to:

```
http://localhost:3000
```

> WSL automatically forwards `localhost` ports to Windows, so this just works.

---

## Step 10 — Verify Everything Works

Run through this checklist:

| Check | How | Expected |
|-------|-----|----------|
| App loads | Open `http://localhost:3000` | Dashboard with agent grid |
| Agents directory exists | `ls .kiro/agents/` in WSL | Empty directory (or agent files) |
| Kiro CLI is authenticated | `kiro-cli auth status` in WSL | Shows logged-in status |
| SQLite works | Create an agent via the builder, then check chat history | Sessions persist across page reloads |
| Node is from WSL | `which node` in WSL | Path starts with `/home/.../.nvm/` |

---

## Daily Usage

Every time you want to work with the app:

### Open WSL and start the server

```bash
# Open Ubuntu from Start menu, then:
cd ~/voice-agent-studio
nvm use
npm run dev
```

### If Kiro CLI auth expired

```bash
kiro-cli auth login
# Complete browser login, then restart the dev server
```

### Stop the server

Press `Ctrl + C` in the WSL terminal.

---

## Troubleshooting

### `npm install` fails with "node-gyp" or "compilation" errors

You're missing build tools. Run:

```bash
sudo apt install build-essential python3 -y
```

Then retry `npm install`.

### `npm install` fails with "better-sqlite3" errors

Same fix as above. `better-sqlite3` is a native C module that needs `gcc` and `make` to compile.

### `node: command not found`

nvm isn't loaded. Run:

```bash
source ~/.bashrc
nvm use 20
```

### `kiro-cli: command not found`

Add it to your PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### "Failed to connect to Kiro agent" in the app

Kiro CLI auth expired. Run:

```bash
kiro-cli auth login
```

### `localhost:3000` doesn't load in Windows browser

1. Make sure the dev server is running in WSL (`npm run dev`)
2. Try `http://127.0.0.1:3000` instead
3. If still not working, check WSL networking:
   ```bash
   # In WSL, find your IP:
   hostname -I
   ```
   Then try `http://<that-ip>:3000` in your browser

### Permission denied errors

If you see "EACCES" or permission errors:

```bash
sudo chown -R $(whoami) ~/voice-agent-studio
```

### SQLite "database is locked" errors

Make sure only one instance of the dev server is running. Check with:

```bash
# Kill any existing Node processes
pkill -f "next dev"

# Then start fresh
npm run dev
```

### Windows Defender / Firewall blocking

If localhost doesn't work, you may need to allow Node.js through Windows Firewall:
1. Open **Windows Security** → **Firewall & network protection**
2. Click **Allow an app through firewall**
3. Add `node` or allow it when prompted

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
| AWS CLI | WSL (`/usr/local/bin/aws`) | AWS credential management |
| better-sqlite3 | WSL (compiled during npm install) | SQLite database for chat history |
