# ACP Integration — Verified Protocol Details

## Date: 2026-02-09
## Kiro CLI Version: 1.25.0
## Auth: IAM Identity Center (SSO)

---

## Status: ✅ ACP is fully functional on this system

```
$ kiro-cli --version
kiro-cli 1.25.0

$ which kiro-cli
/usr/bin/kiro-cli

$ kiro-cli whoami
Logged in with IAM Identity Center
```

---

## Verified ACP Protocol (differs from docs in some places)

### 1. Initialize — ✅ Works as documented

```json
// Request
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{
  "protocolVersion":1,
  "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
  "clientInfo":{"name":"voice-agent-studio","version":"1.0.0"}
}}

// Response
{"jsonrpc":"2.0","id":0,"result":{
  "protocolVersion":1,
  "agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true}},
  "agentInfo":{"name":"Kiro Agent","version":"1.25.0"}
}}
```

### 2. Create Session — ✅ Works, returns modes + models

```json
// Request
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{
  "cwd":"/home/rupeshrk3/voice-agent-studio",
  "mcpServers":[]
}}

// Response
{"jsonrpc":"2.0","id":1,"result":{
  "sessionId":"uuid-here",
  "modes":{"currentModeId":"kiro_default","availableModes":[...]},
  "models":{"currentModelId":"auto","availableModels":[
    {"modelId":"auto"},
    {"modelId":"claude-opus-4.6"},
    {"modelId":"claude-opus-4.5"},
    {"modelId":"claude-sonnet-4.5"},
    {"modelId":"claude-sonnet-4"},
    {"modelId":"claude-haiku-4.5"}
  ]}
}}
```

### 3. Send Prompt — ⚠️ FIELD IS "prompt" NOT "content"

The ACP docs show `content` but kiro-cli 1.25.0 expects `prompt`:

```json
// ❌ WRONG (what the docs say)
{"method":"session/prompt","params":{"sessionId":"...","content":[...]}}

// ✅ CORRECT (what actually works)
{"method":"session/prompt","params":{"sessionId":"...","prompt":[{"type":"text","text":"hello"}]}}
```

Error if you use `content`: `missing field 'prompt'`

### 4. Streaming Notifications — Method is "session/update"

```json
// Text chunk
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"...",
  "update":{
    "sessionUpdate":"agent_message_chunk",
    "content":{"type":"text","text":"hello"}
  }
}}

// Prompt result (returned as RPC response, not notification)
{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}
```

### 5. Available Models

| Model ID | Description |
|---|---|
| auto | Models chosen by task for optimal usage |
| claude-opus-4.6 | Experimental preview |
| claude-opus-4.5 | Claude Opus 4.5 |
| claude-sonnet-4.5 | Latest Claude Sonnet |
| claude-sonnet-4 | Hybrid reasoning and coding |
| claude-haiku-4.5 | Latest Claude Haiku |

---

## What Was Fixed in Our Code

1. **`src/lib/acp/client.ts`** — Changed `prompt()` to send `prompt` field instead of `content`
2. **`src/lib/acp/client.ts`** — Changed notification handler to listen for `session/update` method with `sessionUpdate` field
3. **`src/lib/acp/client.ts`** — Handle `agent_message_chunk`, `tool_use`, `tool_result` update types
4. **`src/app/api/chat/prompt/route.ts`** — `prompt()` now resolves when turn ends (returns `{ stopReason }`), so we close the SSE stream on resolution
5. **`.env.local`** — Set `KIRO_CLI_PATH=/usr/bin/kiro-cli`

---

## How to Test Chat End-to-End

```bash
# 1. Start dev server
cd /home/rupeshrk3/voice-agent-studio
npm run dev

# 2. Create an agent via the UI (http://localhost:3000/agents/new)

# 3. Click "Chat" on the agent card

# 4. The chat page will:
#    - POST /api/chat/session → spawns kiro-cli acp, creates session
#    - POST /api/chat/prompt → sends prompt, streams SSE back
#    - Browser renders streaming text chunks
```

---

## Known Limitations

- `session/set_mode` (switching agents) hasn't been tested yet — need to create a custom agent first, then switch to it
- Tool call notifications (`tool_use`, `tool_result`) format is assumed — needs verification with a prompt that triggers tool use
- No heartbeat/keepalive — long-idle sessions may timeout
