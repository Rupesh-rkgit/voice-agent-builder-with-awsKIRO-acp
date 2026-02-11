# Voice Agent Studio — Technical Architecture & Code Flow

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (React / Next.js Client)                   │
│                                                                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │  Dashboard    │  │ ConversationBuilder│ │  ChatPage    │  │  AgentDetail  │   │
│  │  (page.tsx)   │  │ (voice + text)    │  │ (3-column)   │  │  (JSON editor)│   │
│  └──────┬───────┘  └────────┬──────────┘  └──────┬───────┘  └──────┬────────┘   │
│         │                   │                     │                  │            │
│  ┌──────┴───────────────────┴─────────────────────┴──────────────────┴────────┐  │
│  │                     Zustand Store (builder-store.ts)                       │  │
│  │                     useVoice() hook (Web Speech API)                       │  │
│  └───────────────────────────────┬───────────────────────────────────────────┘  │
└──────────────────────────────────┼──────────────────────────────────────────────┘
                                   │  HTTP / SSE
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS SERVER (API Routes)                             │
│                                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │  /api/agents/*   │  │ /api/builder/chat │  │  /api/chat/session           │   │
│  │  CRUD + templates│  │ SSE streaming     │  │  /api/chat/prompt (SSE)      │   │
│  └────────┬────────┘  └────────┬─────────┘  │  /api/chat/history            │   │
│           │                    │              └──────────┬───────────────────┘   │
│           ▼                    ▼                         ▼                       │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │ config-service   │  │ builder-provider  │  │  session-manager             │   │
│  │ (filesystem I/O) │  │ (dedicated ACP)   │  │  (ACP session pool, LRU)     │   │
│  └────────┬────────┘  └────────┬─────────┘  └──────────┬───────────────────┘   │
│           │                    │                         │                       │
│           ▼                    ▼                         ▼                       │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────────────┐   │
│  │ .kiro/agents/    │  │              AcpClient (JSON-RPC 2.0)               │   │
│  │ *.json files     │  │  spawn("kiro-cli", ["acp"]) → stdio pipes           │   │
│  │ .agent-index.json│  └──────────────────────┬──────────────────────────────┘   │
│  └─────────────────┘                          │                                  │
│                                               │                                  │
│  ┌─────────────────┐                          │                                  │
│  │ SQLite (WAL)     │                          │                                  │
│  │ chat-history.db  │                          │                                  │
│  └─────────────────┘                          │                                  │
└───────────────────────────────────────────────┼──────────────────────────────────┘
                                                │  stdio (JSON-RPC 2.0)
                                                ▼
                                   ┌──────────────────────┐
                                   │      kiro-cli acp     │
                                   │  (child process)      │
                                   │                        │
                                   │  ← initialize          │
                                   │  ← session/new         │
                                   │  ← session/set_mode    │
                                   │  ← session/prompt      │
                                   │  → session/update      │
                                   │  → fs/readTextFile     │
                                   │  → terminal/execute    │
                                   │                        │
                                   │  Claude (via Bedrock)  │
                                   └──────────────────────┘
```

---

## 2. Core Components

### 2.1 ACP Client (`src/lib/acp/client.ts`)

The central communication layer. Spawns `kiro-cli acp` as a child process and speaks JSON-RPC 2.0 over stdio.

```
AcpClient (extends EventEmitter)
├── connect()         → spawn kiro-cli, send "initialize"
├── createSession()   → "session/new" → returns sessionId
├── switchAgent()     → "session/set_mode" → switch active agent
├── prompt()          → "session/prompt" → triggers streaming updates
├── cancel()          → "session/cancel"
├── disconnect()      → SIGTERM the child process
│
├── processBuffer()   → parse newline-delimited JSON from stdout
│   ├── handleResponse()      → resolve pending request promises
│   ├── handleNotification()  → emit "update" events (text chunks, tool calls)
│   └── handleRequest()       → respond to kiro-cli's fs/terminal requests
│       ├── fs/readTextFile   → read file (path-traversal validated)
│       ├── fs/writeTextFile  → write file (mkdir -p + write)
│       ├── fs/listDirectory  → readdir with file types
│       └── terminal/execute  → exec with 60s timeout, 5MB buffer
```

Bidirectional protocol: the server sends requests TO kiro-cli (prompt, switch agent), and kiro-cli sends requests BACK (read file, execute command) when the LLM uses tools.

### 2.2 Session Manager (`src/lib/acp/session-manager.ts`)

Manages a pool of AcpClient instances (one per chat session).

```
AcpSessionManager (singleton)
├── sessions: Map<sessionId, ManagedSession>
├── createSession(agentName)
│   ├── if pool full (MAX_SESSIONS=10) → evictOldest() (LRU by lastActivity)
│   ├── new AcpClient() → connect → createSession → switchAgent
│   └── store in map, listen for "exit" to auto-cleanup
├── getSession(sessionId) → returns ManagedSession, updates lastActivity
├── destroySession(sessionId) → disconnect + remove
└── evictOldest() → find oldest lastActivity, disconnect, remove
```

### 2.3 Builder Provider (`src/lib/acp/builder-provider.ts`)

A dedicated, long-lived ACP session for the agent creation conversation. Separate from chat sessions.

```
Builder Provider (module-level singleton)
├── getOrCreateSession() → lazy-init one AcpClient for all builder conversations
├── streamBuilderPrompt(userMessage, onChunk)
│   ├── Turn 0: prepend BUILDER_SYSTEM_PROMPT to first message
│   ├── client.prompt() → listen for "update" events → call onChunk(text)
│   └── Resolves when prompt completes
└── destroyBuilderSession() → disconnect + null out
```

### 2.4 Config Service (`src/lib/agents/config-service.ts`)

Filesystem-backed agent CRUD. Agents are stored as `.kiro/agents/<name>.json` with a UUID index at `.kiro/agents/.agent-index.json`.

```
Config Service
├── createAgent(req)
│   ├── Validate with KiroAgentConfigSchema (Zod)
│   ├── Write .kiro/agents/<name>.json
│   └── withIndexLock() → read index → add UUID entry → write index
├── listAgents()      → read index → sort by updatedAt
├── getAgent(id)      → read index → read config JSON → merge
├── updateAgent(id)   → read config → merge partial → write both
├── deleteAgent(id)   → unlink config file → remove from index
└── getChildAgents(parentId) → filter index by parentAgentId
```

Index lock prevents race conditions on concurrent writes (mutex via promise chain).

### 2.5 Chat History DB (`src/lib/db/chat-history.ts`)

SQLite with WAL mode for concurrent reads during streaming writes.

```
Schema:
  chat_sessions (id, agent_id, agent_name, title, created_at, updated_at)
  chat_messages (id, session_id, role, content, agent_name, created_at)

Functions:
  createChatSession()  → INSERT session
  saveMessage()        → INSERT message + touchSession (update timestamp)
  getSessionMessages() → SELECT messages by session_id, ordered by created_at
  listChatSessions()   → SELECT sessions, ordered by updated_at DESC
  deleteChatSession()  → DELETE session (CASCADE deletes messages)
  getRecentChats()     → SELECT latest N sessions with last message preview
```

---

## 3. Code Flows

### 3.1 Agent Creation (LLM Builder)

```
User speaks/types "Create a code review agent"
         │
         ▼
ConversationBuilder (React)
  ├── useVoice() → Web Speech API → transcript
  ├── handleSend(text)
  │   └── sendToLLM(text)
  │       ├── addMessage("user", text) → Zustand store
  │       ├── POST /api/builder/chat { messages: [...history] }
  │       │         │
  │       │         ▼
  │       │   builder/chat route.ts
  │       │     ├── Extract last user message (ACP is stateful)
  │       │     ├── streamBuilderPrompt(message, onChunk)
  │       │     │   ├── getOrCreateSession() → lazy AcpClient
  │       │     │   ├── Turn 0: prepend system prompt
  │       │     │   ├── client.prompt(sessionId, prompt)
  │       │     │   └── on "update" → onChunk(text) → SSE data frame
  │       │     └── Return SSE stream
  │       │
  │       ├── Read SSE stream → appendStreamingText()
  │       └── parseConfigFromResponse(fullText)
  │           ├── Extract JSON config block from LLM response
  │           └── setPendingConfig(config) or setPendingTeam(team)
  │
  ▼
User clicks "✓ Create Agent"
  ├── handleConfirmSingle() or handleConfirmTeam()
  │   ├── POST /api/agents { name, description, prompt, tools, model, parentAgentId }
  │   │         │
  │   │         ▼
  │   │   agents/route.ts POST
  │   │     ├── Zod validate (CreateAgentRequestSchema)
  │   │     ├── configService.createAgent()
  │   │     │   ├── Write .kiro/agents/<name>.json
  │   │     │   └── Update .agent-index.json (with lock)
  │   │     └── Return { id, name, ... }
  │   │
  │   └── For teams: create orchestrator first, then children with parentAgentId
  │
  └── addCreatedAgent() → show navigation options
```

### 3.2 Chat Session Creation

```
User navigates to /chat/[agentId]
         │
         ▼
ChatPage.ensureLiveSession()
  ├── POST /api/chat/session { agentId }
  │         │
  │         ▼
  │   session/route.ts POST
  │     ├── getAgent(agentId) → read from index + config file
  │     ├── getChildAgents(agentId) → find sub-agents
  │     ├── sessionManager.createSession(agent.config.name)
  │     │   ├── Enforce pool limit (evict LRU if full)
  │     │   ├── new AcpClient() → spawn kiro-cli acp
  │     │   ├── client.connect() → send "initialize" JSON-RPC
  │     │   ├── client.createSession(cwd) → "session/new"
  │     │   ├── client.switchAgent(sessionId, agentName) → "session/set_mode"
  │     │   └── Store in sessions Map
  │     ├── createChatSession(sessionId, agentId, agentName) → SQLite INSERT
  │     └── Return { sessionId, agentName, children, tools, model }
  │
  └── Store sessionId in component state
```

### 3.3 Chat Message (No Delegation)

```
User sends "Review this code for bugs"
         │
         ▼
ChatPage.sendMessage()
  ├── POST /api/chat/prompt { sessionId, message }
  │         │
  │         ▼
  │   prompt/route.ts POST
  │     ├── Zod validate (ChatPromptRequestSchema)
  │     ├── sessionManager.getSession(sessionId) → get ManagedSession
  │     ├── saveMessage(sessionId, "user", message) → SQLite
  │     ├── updateSessionTitle(sessionId, message.slice(0,100))
  │     │
  │     ├── Create ReadableStream (SSE)
  │     │   ├── client.on("update", onUpdate)
  │     │   │   ├── update.type === "text" → accumulate fullText
  │     │   │   │   ├── Check for <delegate> tag (orchestrators only)
  │     │   │   │   └── send({ type: "text", content }) → SSE frame
  │     │   │   ├── update.type === "tool_call" → forward to client
  │     │   │   └── update.type === "tool_call_update" → forward
  │     │   │
  │     │   ├── client.prompt(sessionId, message) → JSON-RPC "session/prompt"
  │     │   │         │
  │     │   │         ▼
  │     │   │   kiro-cli processes prompt with Claude
  │     │   │     ├── Sends "session/update" notifications (text chunks)
  │     │   │     ├── May send "fs/readTextFile" requests ← server responds
  │     │   │     ├── May send "terminal/execute" requests ← server responds
  │     │   │     └── Prompt resolves when turn completes
  │     │   │
  │     │   ├── On prompt complete:
  │     │   │   ├── saveMessage(sessionId, "assistant", fullText) → SQLite
  │     │   │   └── send({ type: "turn_end" }) → close stream
  │     │   │
  │     │   └── On client abort: cancel prompt, close stream
  │     │
  │     └── Return SSE Response
  │
  ▼
ChatPage.processSSELine()
  ├── type: "text" → append to displayed message
  ├── type: "tool_call" → show tool indicator in UI
  ├── type: "delegation" → show delegation banner
  └── type: "turn_end" → finalize message
```

### 3.4 Chat Message (With Delegation)

```
User sends "Analyze the performance of my API"
         │
         ▼
prompt/route.ts (same as above, but orchestrator detects delegation)
  │
  ├── Orchestrator streams: "I'll delegate this to the performance-analyzer..."
  │   └── Streams text: <delegate to="perf-analyzer">Analyze API latency...</delegate>
  │
  ├── parseDelegation(fullText) → { agent: "perf-analyzer", task: "Analyze API latency..." }
  │   ├── Text before <delegate> tag → sent to client + saved
  │   └── Text inside tag → held back, not sent to client
  │
  ├── Orchestrator prompt resolves → pendingDelegation is set
  │
  ├── handleDelegation("perf-analyzer", task, depth=0)
  │   ├── Guard: depth < MAX_DELEGATION_DEPTH (3)
  │   ├── saveMessage(sessionId, "delegation", task, "perf-analyzer")
  │   ├── send({ type: "delegation", agent, task, status: "start" })
  │   │
  │   ├── client.switchAgent(sessionId, "perf-analyzer")
  │   │   └── JSON-RPC "session/set_mode" → kiro-cli switches active agent
  │   │
  │   ├── client.prompt(sessionId, task)
  │   │   └── Sub-agent streams response → onSubUpdate → send to client
  │   │
  │   ├── saveMessage(sessionId, "assistant", delegatedText, "perf-analyzer")
  │   ├── send({ type: "delegation", agent, task, status: "end" })
  │   │
  │   ├── client.switchAgent(sessionId, orchestratorName)
  │   │   └── Switch back to orchestrator for next turn
  │   │
  │   └── close() → send turn_end
  │
  ▼
Client UI:
  ├── Shows orchestrator's explanation text
  ├── Shows "Delegating to perf-analyzer" banner
  ├── Streams sub-agent's response
  └── Shows "Delegation complete" banner
```

### 3.5 Voice Input Flow

```
User clicks 🎤 button
         │
         ▼
useVoice() hook (src/hooks/use-voice.ts)
  ├── new SpeechRecognition() (Web Speech API)
  ├── recognition.start() → browser requests mic access
  ├── onresult → update transcript state
  ├── onend → set isListening = false
  │
  ▼
ConversationBuilder / ChatPage
  ├── useEffect watches [transcript, isListening]
  ├── When speech ends + transcript changed → handleSend(transcript)
  └── After assistant finishes → auto-restart listening (800ms delay)
      (voice-first UX loop)
```

---

## 4. Data Flow Diagram

```
                    ┌─────────────────────────────────────┐
                    │           Data Stores                │
                    │                                      │
                    │  .kiro/agents/*.json  (agent configs)│
                    │  .kiro/agents/.agent-index.json      │
                    │  .kiro/chat-history.db (SQLite WAL)  │
                    └──────────┬──────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   config-service.ts    chat-history.ts    AcpClient (stdio)
   (read/write JSON)    (read/write SQL)   (JSON-RPC ↔ kiro-cli)
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   API Route Layer    │
                    │                      │
                    │  /api/agents/*       │ ← Agent CRUD
                    │  /api/builder/chat   │ ← LLM builder (SSE)
                    │  /api/chat/session   │ ← Session lifecycle
                    │  /api/chat/prompt    │ ← Streaming chat (SSE)
                    │  /api/chat/history   │ ← History queries
                    │  /api/voice/*        │ ← Transcribe/Synthesize
                    └──────────┬──────────┘
                               │ HTTP / SSE
                               ▼
                    ┌─────────────────────┐
                    │   React Components   │
                    │                      │
                    │  Zustand (state)     │
                    │  useVoice (mic)      │
                    │  fetch + EventSource │
                    └─────────────────────┘
```

---

## 5. JSON-RPC Protocol (ACP)

All communication between the Next.js server and kiro-cli uses newline-delimited JSON-RPC 2.0 over stdio.

### Server → kiro-cli (Requests)

| Method | Params | Purpose |
|--------|--------|---------|
| `initialize` | `{ protocolVersion, clientCapabilities, clientInfo }` | Handshake on process spawn |
| `session/new` | `{ cwd, mcpServers }` | Create a new agent session |
| `session/set_mode` | `{ sessionId, modeId }` | Switch active agent |
| `session/prompt` | `{ sessionId, prompt: [{ type: "text", text }] }` | Send user message |
| `session/cancel` | `{ sessionId }` | Cancel in-progress prompt |

### kiro-cli → Server (Notifications)

| Method | Update Type | Payload |
|--------|-------------|---------|
| `session/update` | `agent_message_chunk` | `{ content: { type, text } }` |
| `session/update` | `tool_use` | `{ name, status, input }` |
| `session/update` | `tool_result` | `{ name, content }` |

### kiro-cli → Server (Requests — tool execution)

| Method | Params | Server Response |
|--------|--------|-----------------|
| `fs/readTextFile` | `{ path }` | `{ content }` |
| `fs/writeTextFile` | `{ path, content }` | `{}` |
| `fs/listDirectory` | `{ path }` | `{ entries: [{ name, isDirectory }] }` |
| `terminal/execute` | `{ command, cwd }` | `{ exitCode, stdout, stderr }` |

All filesystem requests are validated against the workspace root to prevent path traversal.

---

## 6. Session Lifecycle

```
                    CREATE                    ACTIVE                     DESTROY
                 ┌──────────┐            ┌──────────────┐           ┌──────────┐
                 │ spawn    │            │ prompt()     │           │ disconnect│
  User starts →  │ kiro-cli │  ────────► │ switchAgent()│ ────────► │ SIGTERM   │
  chat session   │ acp      │            │ on("update") │           │ cleanup   │
                 │ init     │            │ lastActivity │           │ map.delete│
                 │ session/ │            │ updated on   │           │           │
                 │ new      │            │ every access │           │           │
                 └──────────┘            └──────────────┘           └──────────┘
                                               │
                                               │ Pool full?
                                               ▼
                                         ┌──────────┐
                                         │ LRU evict │
                                         │ oldest    │
                                         │ session   │
                                         └──────────┘
```

Max 10 concurrent sessions. When limit is reached, the session with the oldest `lastActivity` timestamp is evicted (disconnected and removed).

---

## 7. SSE Event Types (Client ← Server)

Events sent over the `/api/chat/prompt` SSE stream:

| Event Type | Shape | When |
|------------|-------|------|
| `text` | `{ type: "text", content: "..." }` | LLM text chunk |
| `tool_call` | `{ type: "tool_call", name, status, args }` | Agent invokes a tool |
| `tool_call_update` | `{ type: "tool_call_update", name, content }` | Tool result |
| `delegation` | `{ type: "delegation", agent, task, status: "start"\|"end" }` | Sub-agent handoff |
| `error` | `{ type: "error", message }` | Error during processing |
| `turn_end` | `{ type: "turn_end" }` | Response complete |

---

## 8. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| stdio JSON-RPC (not HTTP) | kiro-cli's ACP protocol uses stdio; avoids network overhead for local IPC |
| One kiro-cli process per session | Each session needs isolated agent state; no shared process multiplexing |
| LRU session eviction | Bounded resource usage; 10 processes max prevents OOM |
| SQLite WAL mode | Allows concurrent reads during streaming writes without blocking |
| SSE (not WebSocket) | Simpler for unidirectional streaming; auto-reconnect built into EventSource |
| Delegation via XML tags | Orchestrator embeds `<delegate to="...">` in its response; parsed server-side |
| Separate builder session | Agent creation uses a dedicated long-lived ACP session, not the chat pool |
| Filesystem agent storage | `.kiro/agents/*.json` — compatible with kiro-cli's native agent format |
| Path traversal validation | All fs requests from kiro-cli are resolved against workspace root |
| Zustand over Context | Simpler API for builder state; persists across re-renders without provider nesting |
