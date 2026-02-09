# Voice Agent Studio — Complete Architecture & Backend Reference

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Request Lifecycle — Every Interaction](#request-lifecycle)
4. [Backend Components Deep Dive](#backend-components)
5. [ACP Protocol Reference](#acp-protocol-reference)
6. [Data Flow Diagrams](#data-flow-diagrams)
7. [File-by-File Reference](#file-reference)
8. [Error Handling](#error-handling)

---

## System Overview

Voice Agent Studio is a web application that lets users create, manage, and chat with AI agents powered by Kiro CLI. The app runs as a Next.js server that spawns `kiro-cli acp` child processes to communicate with Claude models via AWS Bedrock.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                              │
│                                                                       │
│  Next.js App Router (React 19)                                       │
│  ├── Dashboard (/) — list agents, hierarchy tree                     │
│  ├── Create Agent (/agents/new) — LLM-powered conversation builder  │
│  ├── Agent Detail (/agents/[id]) — view/edit config                  │
│  └── Chat (/chat/[agentId]) — real-time streaming chat               │
│                                                                       │
│  Client-side: Zustand stores, Web Speech API, SSE streaming          │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTP (fetch)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     NEXT.JS SERVER (Node.js)                         │
│                                                                       │
│  API Routes (src/app/api/*)                                          │
│  ├── /api/agents — CRUD for agent configs                            │
│  ├── /api/builder/chat — LLM conversation for agent creation         │
│  ├── /api/chat/session — create ACP session                          │
│  ├── /api/chat/prompt — stream prompt response via SSE               │
│  ├── /api/chat/history — chat history CRUD (SQLite)                  │
│  └── /api/voice/* — Transcribe & Polly (future)                      │
│                                                                       │
│  Services                                                             │
│  ├── AgentConfigService — reads/writes .kiro/agents/*.json           │
│  ├── AcpSessionManager — pool of kiro-cli processes                  │
│  ├── AcpClient — JSON-RPC 2.0 over stdio                            │
│  ├── BuilderProvider — dedicated ACP session for agent creation      │
│  └── ChatHistoryDB — SQLite (better-sqlite3, WAL mode)              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ stdin/stdout (JSON-RPC 2.0)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     KIRO-CLI ACP (Child Process)                     │
│                                                                       │
│  - Authenticated via IAM Identity Center (SSO)                       │
│  - Reads .kiro/agents/*.json for available agent modes               │
│  - Routes prompts to Claude models via AWS Bedrock                   │
│  - Streams response chunks back via stdout                           │
│  - Stateful: maintains full conversation history per session         │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS (SigV4)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AWS BEDROCK (Cloud)                               │
│                                                                       │
│  Foundation Models: Claude Sonnet 4, Opus 4.5, Haiku 4.5, etc.      │
│  - Handles inference                                                  │
│  - Streaming response via Bedrock Runtime API                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle

### 1. Dashboard Load (`GET /`)

```
Browser → GET / (Server Component)
  → listAgents() reads .kiro/agents/.agent-index.json
  → For each agent, getAgent(id) reads .kiro/agents/{name}.json
  → Renders AgentGrid (cards) + AgentTree (hierarchy)
  → Returns HTML to browser
```

No ACP process is spawned. This is pure filesystem reads.

### 2. Create Agent (`/agents/new`)

```
Browser loads /agents/new (static page with ConversationBuilder component)

User speaks/types → "I want a fullstack developer agent"
  │
  ▼
ConversationBuilder (React)
  → Adds user message to Zustand store
  → POST /api/builder/chat { messages: [{role:"user", content:"..."}] }
  │
  ▼
/api/builder/chat (API Route)
  → Extracts last user message
  → Calls streamBuilderPrompt(userMessage, onChunk)
  │
  ▼
BuilderProvider (src/lib/acp/builder-provider.ts)
  → First call: creates ACP session (spawns kiro-cli acp)
  → First turn: prepends system prompt to user message
  → Subsequent turns: sends only the user message (ACP is stateful)
  → client.prompt(sessionId, text)
  │
  ▼
AcpClient → kiro-cli acp (stdin)
  {"jsonrpc":"2.0","id":N,"method":"session/prompt",
   "params":{"sessionId":"...","prompt":[{"type":"text","text":"..."}]}}
  │
  ▼
kiro-cli → Bedrock → Claude responds
  │
  ▼
kiro-cli acp (stdout) → streaming notifications
  {"method":"session/update","params":{
    "update":{"sessionUpdate":"agent_message_chunk",
              "content":{"type":"text","text":"chunk"}}}}
  │
  ▼
AcpClient emits "update" event → onChunk callback
  │
  ▼
/api/builder/chat writes SSE
  data: {"text":"chunk"}
  │
  ▼
Browser reads SSE stream → updates streamingText in Zustand
  │
  ▼
When kiro-cli returns {"result":{"stopReason":"end_turn"}}
  → prompt() resolves → SSE sends "data: [DONE]"
  → Browser parses full response for <agent_config> tags
  → If found: sanitizes config (valid tools/models only)
  → Shows config card with Create/Edit buttons
  │
  ▼
User clicks "Create Agent"
  → POST /api/agents { name, description, prompt, tools, model }
  │
  ▼
/api/agents (API Route)
  → Zod validates with CreateAgentRequestSchema
  → configService.createAgent(parsed)
    → Writes .kiro/agents/{name}.json
    → Generates UUID, writes to .agent-index.json
  → Returns { id, name, ... }
```

### 3. Chat with Agent (`/chat/[agentId]`)

```
Browser loads /chat/{agentId}

Step 1: Initialize
  IF ?resume={sessionId} in URL:
    → GET /api/agents/{agentId} — fetch agent info (name, description, tools, model, children)
    → GET /api/chat/history?sessionId={sessionId} — load previous messages
    → Sets isResumed=true (no ACP session yet)
    → On first new message: lazily creates ACP session via ensureLiveSession()
  ELSE (new chat):
    → POST /api/chat/session { agentId }
    → Creates ACP session + SQLite chat_sessions record
    → Returns { sessionId, agentName, children, ... }

Step 2: Send Message
  → POST /api/chat/prompt { sessionId, message }
  │
  ▼
/api/chat/prompt (API Route)
  → saveMessage(sessionId, "user", message)
  → updateSessionTitle(sessionId, message) — only if title is empty
  → client.prompt(sessionId, message)
  → Listens for "update" events, streams as SSE
  │
  ▼
  IF orchestrator AND response contains <delegate to="X">task</delegate>:
    → Text buffering: tracks sentLength, sends text up to <delegate tag
    → Saves orchestrator before-text to DB
    → Waits for orchestrator prompt() to resolve (prevents RPC race)
    → Saves delegation message to DB
    → Sends SSE: {"type":"delegation","agent":"X","task":"...","status":"start"}
    → client.switchAgent(sessionId, "X") — calls session/set_mode
    → client.prompt(sessionId, task) — sends task to sub-agent
    → Streams sub-agent response chunks via SSE
    → Saves sub-agent response to DB
    → Sends SSE: {"type":"delegation",...,"status":"end"}
    → client.switchAgent(sessionId, orchestratorName) — switch back
  ELSE:
    → Streams text/tool_call events via SSE
    → Saves assistant response to DB on close
  │
  ▼
Browser reads SSE
  → Appends text chunks to assistant message
  → On delegation start: shows amber banner, creates sub-agent message bubble
  → On delegation end: clears active child indicator
  → On turn_end: marks loading=false, refreshes history sidebar

Step 3: Session Recovery
  → If prompt returns 404 (session expired/evicted):
    → Auto-creates new ACP session
    → Retries the prompt transparently
```

### 3b. Chat History

```
Data stored in .kiro/chat-history.db (SQLite, WAL mode)

Tables:
  chat_sessions: id, agent_id, agent_name, title, created_at, updated_at
  chat_messages: id, session_id, role, content, agent_name, created_at

Message roles: "user" | "assistant" | "delegation"

Save order for delegated responses:
  1. user message (role=user)
  2. orchestrator explanation (role=assistant, agent_name=orchestrator)
  3. delegation task (role=delegation, agent_name=sub-agent)
  4. sub-agent response (role=assistant, agent_name=sub-agent)

APIs:
  GET /api/chat/history?agentId=X  → list sessions for agent
  GET /api/chat/history?sessionId=X → get messages for session
  GET /api/chat/history             → recent chats (all agents)
  DELETE /api/chat/history          → delete session + messages
```

### 4. Edit Agent (`/agents/[id]`)

```
Browser → GET /agents/{id} (Server Component)
  → getAgent(id) reads config
  → Renders AgentConfigEditor (client component)

User edits JSON → clicks Save
  → PUT /api/agents/{id} { ...updates }
  → Zod validates partial update
  → configService.updateAgent(id, updates)
    → Merges with existing config
    → Writes updated .kiro/agents/{name}.json
    → Updates .agent-index.json
```

### 5. Delete Agent

```
User clicks 🗑️ on agent card → confirms
  → DELETE /api/agents/{id}
  → configService.deleteAgent(id)
    → Removes .kiro/agents/{name}.json
    → Removes from .agent-index.json
  → UI removes card from grid
```

---

## Backend Components

### AcpClient (`src/lib/acp/client.ts`)

The core communication layer. Spawns `kiro-cli acp` as a child process and speaks JSON-RPC 2.0 over stdin/stdout.

**Key methods:**
| Method | What it does |
|---|---|
| `connect(opts)` | Spawns kiro-cli, sends `initialize` |
| `createSession(cwd)` | Sends `session/new`, returns sessionId |
| `prompt(sessionId, text)` | Sends `session/prompt`, resolves on `end_turn` |
| `switchAgent(sessionId, name)` | Sends `session/set_mode` with `modeId` |
| `cancel(sessionId)` | Sends `session/cancel` |
| `disconnect()` | Kills the child process |

**Events emitted:**
| Event | Payload | When |
|---|---|---|
| `update` | `SessionUpdate` | Each streaming chunk from kiro-cli |
| `exit` | `code: number` | kiro-cli process exits |

**SessionUpdate types:**
```typescript
| { type: "text"; content: string }           // Text chunk
| { type: "tool_call"; name: string; ... }    // Agent using a tool
| { type: "tool_call_update"; name: string; } // Tool result
| { type: "turn_end"; stopReason?: string }   // Turn complete
| { type: "error"; message: string }          // Error
```

### AcpSessionManager (`src/lib/acp/session-manager.ts`)

Manages a pool of ACP sessions. Singleton that persists across API route invocations.

- Max 10 concurrent sessions (configurable via `MAX_ACP_SESSIONS`)
- LRU eviction when pool is full
- Auto-cleanup when kiro-cli process exits
- Each session = one kiro-cli child process

### BuilderProvider (`src/lib/acp/builder-provider.ts`)

Dedicated ACP session for the agent creation conversation. Separate from the chat session pool.

- Singleton session (one builder conversation at a time)
- Injects system prompt on first turn (tells the LLM how to be an agent creation assistant)
- Subsequent turns: only sends user message (ACP remembers history)
- Can be reset via `destroyBuilderSession()`

### AgentConfigService (`src/lib/agents/config-service.ts`)

CRUD operations for agent configs stored as JSON files.

**Storage layout:**
```
.kiro/agents/
├── .agent-index.json          # UUID → metadata mapping
├── backend-agent.json         # Agent config (Kiro format)
├── frontend-agent.json
└── orchestrator.json
```

**Agent config format** (what kiro-cli reads):
```json
{
  "name": "backend-agent",
  "description": "Backend development specialist",
  "prompt": "You are a backend developer...",
  "tools": ["read", "write", "shell"],
  "model": "claude-sonnet-4"
}
```

**Index format** (our metadata layer):
```json
{
  "uuid-here": {
    "id": "uuid-here",
    "name": "backend-agent",
    "description": "...",
    "configPath": ".kiro/agents/backend-agent.json",
    "parentAgentId": "parent-uuid-or-null",
    "createdAt": "2026-02-09T...",
    "updatedAt": "2026-02-09T..."
  }
}
```

---

## ACP Protocol Reference

Verified against kiro-cli 1.25.0. This is the actual wire format.

### Initialize
```json
→ {"jsonrpc":"2.0","id":0,"method":"initialize","params":{
    "protocolVersion":1,
    "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
    "clientInfo":{"name":"voice-agent-studio","version":"1.0.0"}
  }}

← {"jsonrpc":"2.0","id":0,"result":{
    "protocolVersion":1,
    "agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true}},
    "agentInfo":{"name":"Kiro Agent","version":"1.25.0"}
  }}
```

### Create Session
```json
→ {"jsonrpc":"2.0","id":1,"method":"session/new","params":{
    "cwd":"/path/to/project",
    "mcpServers":[]
  }}

← {"jsonrpc":"2.0","id":1,"result":{
    "sessionId":"uuid",
    "modes":{"currentModeId":"kiro_default","availableModes":[...]},
    "models":{"currentModelId":"auto","availableModels":[...]}
  }}
```

The `availableModes` includes all `.json` files in `.kiro/agents/` under the `cwd`.

### Switch Agent Mode
```json
→ {"jsonrpc":"2.0","id":2,"method":"session/set_mode","params":{
    "sessionId":"uuid",
    "modeId":"backend-agent"
  }}

← {"jsonrpc":"2.0","id":2,"result":{}}
```

**CRITICAL**: The field is `modeId`, NOT `mode`. Using `mode` causes the call to hang indefinitely with no response.

### Send Prompt
```json
→ {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
    "sessionId":"uuid",
    "prompt":[{"type":"text","text":"user message"}]
  }}
```

**CRITICAL**: The field is `prompt`, NOT `content`. Using `content` returns error: `missing field 'prompt'`.

### Streaming Response (Notifications)
```json
← {"jsonrpc":"2.0","method":"session/update","params":{
    "sessionId":"uuid",
    "update":{
      "sessionUpdate":"agent_message_chunk",
      "content":{"type":"text","text":"chunk of text"}
    }
  }}
```

### Tool Use Notification
```json
← {"jsonrpc":"2.0","method":"session/update","params":{
    "sessionId":"uuid",
    "update":{
      "sessionUpdate":"tool_call",
      "toolCallId":"tooluse_xxx",
      "title":"Reading file",
      "kind":"read",
      "rawInput":{...}
    }
  }}
```

### Turn Complete (RPC Response)
```json
← {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

This is the response to the `session/prompt` request. It arrives after all `session/update` notifications.

### Available Models
| Model ID | Description |
|---|---|
| auto | Kiro picks optimal model per task |
| claude-sonnet-4 | Default, good balance |
| claude-sonnet-4.5 | Latest Sonnet |
| claude-haiku-4.5 | Fast, lightweight |
| claude-opus-4.5 | Most capable |
| claude-opus-4.6 | Experimental |

---

## File Reference

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/agents` | GET | List all agents |
| `/api/agents` | POST | Create agent (Zod validated) |
| `/api/agents/[id]` | GET | Get single agent + config + children |
| `/api/agents/[id]` | PUT | Update agent config |
| `/api/agents/[id]` | DELETE | Delete agent |
| `/api/agents/confirm` | POST | Create agent (alternate endpoint) |
| `/api/agents/templates` | GET | List agent templates |
| `/api/agents/from-voice` | POST | Parse voice input to config (keyword-based) |
| `/api/builder/chat` | POST | LLM conversation for agent creation (SSE) |
| `/api/chat/session` | POST | Create ACP chat session + SQLite record |
| `/api/chat/prompt` | POST | Send prompt, stream response (SSE), delegation, auto-save |
| `/api/chat/history` | GET | List sessions (by agent) or messages (by session) |
| `/api/chat/history` | DELETE | Delete chat session + messages |
| `/api/voice/transcribe` | POST | AWS Transcribe (future) |
| `/api/voice/synthesize` | POST | AWS Polly TTS (future) |

### Frontend Pages

| Route | Type | Purpose |
|---|---|---|
| `/` | Server Component | Dashboard — agent grid + hierarchy tree + recent chats sidebar |
| `/agents/new` | Static + Client | Agent creation with LLM conversation builder |
| `/agents/[id]` | Server Component | Agent detail view + JSON config editor |
| `/chat/[agentId]` | Client Component | 3-column chat: history sidebar, messages, sub-agents/info |

### Core Libraries

| File | Purpose |
|---|---|
| `src/lib/acp/client.ts` | ACP JSON-RPC client over stdio |
| `src/lib/acp/session-manager.ts` | Session pool management (max 10, LRU eviction) |
| `src/lib/acp/builder-provider.ts` | Dedicated builder ACP session |
| `src/lib/agents/config-service.ts` | Agent CRUD on filesystem |
| `src/lib/agents/schema.ts` | Zod schemas for all data types |
| `src/lib/agents/templates.ts` | Predefined agent templates |
| `src/lib/db/chat-history.ts` | SQLite chat history (better-sqlite3, WAL mode) |
| `src/lib/bedrock/converse-bedrock.ts` | Direct Bedrock API (preserved, not active) |
| `src/lib/intent/parser.ts` | Keyword-based voice→config parser (legacy) |

### Key Components

| File | Purpose |
|---|---|
| `src/components/conversation-builder.tsx` | LLM-driven agent creation with voice |
| `src/components/recent-chats.tsx` | Recent chat sessions list (dashboard sidebar) |
| `src/components/agent-tree.tsx` | Agent hierarchy tree visualization |
| `src/stores/builder-store.ts` | Zustand store for builder (config parsing, sanitization) |
| `src/hooks/use-voice.ts` | Web Speech API hook (listen/transcript) |

---

## Error Handling

| Scenario | What Happens |
|---|---|
| kiro-cli not installed | `/api/chat/session` returns 503 with `ACP_CONNECTION_FAILED` |
| kiro-cli not authenticated | ACP `initialize` fails, session creation errors |
| Invalid agent config | Zod validation returns 400 with field-level errors |
| Agent name collision | `createAgent` returns 409 `AGENT_EXISTS` |
| ACP process crashes | `exit` event fires, session removed from pool, pending promises rejected |
| SSE stream error | Error event sent, stream closed, UI shows error message |
| Session pool full | Oldest session evicted (LRU) |
| Session expired (404) | Client auto-recreates ACP session and retries prompt |
| Delegation RPC race | Orchestrator prompt must resolve before delegation starts |
| set_mode with wrong field | Hangs forever (use `modeId` not `mode`) |
| prompt with wrong field | Returns error `missing field 'prompt'` (use `prompt` not `content`) |
