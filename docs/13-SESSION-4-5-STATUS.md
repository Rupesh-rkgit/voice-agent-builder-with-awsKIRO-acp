# Session 4–5 Status — Delegation, Chat History, UI Overhaul

**Date:** 2026-02-09
**Build:** ✅ Clean (0 errors, 16 routes)

---

## What Was Built

### 1. Orchestrator Delegation System

Multi-agent delegation where an orchestrator agent detects `<delegate to="agent-name">task</delegate>` tags in its streamed response and hands off work to sub-agents.

**Flow:**
```
User prompt → Orchestrator streams response
  → Backend detects <delegate> tag in accumulated text
  → Waits for orchestrator prompt to finish (prevents RPC race condition)
  → Sends "delegation start" SSE event to UI
  → Switches ACP mode to sub-agent (session/set_mode)
  → Sends task to sub-agent, streams response to UI
  → Sends "delegation end" SSE event
  → Switches ACP mode back to orchestrator
```

**Key design decisions:**
- Delegation detected at app layer (ACP has no native multi-agent support)
- Text buffering: tracks `sentLength` to suppress `<delegate>` XML from reaching UI
- Orchestrator's `client.prompt()` must resolve before `handleDelegation()` runs — prevents two competing RPC requests on the same session
- Orchestrator's "before text" (explanation) saved to DB before delegation starts

**Files:**
- `src/app/api/chat/prompt/route.ts` — `parseDelegation()`, text buffering, `handleDelegation()`
- `src/lib/acp/client.ts` — `switchAgent()` calls `session/set_mode`
- `.kiro/agents/modernization-orchestrator.json` — system prompt with delegation instructions

### 2. SQLite Chat History

Persistent chat history using `better-sqlite3` with WAL mode.

**Schema:**
```sql
chat_sessions: id, agent_id, agent_name, title, created_at, updated_at
chat_messages: id, session_id, role, content, agent_name, created_at
```

**Auto-save points:**
- Session created → `chat_sessions` row
- User sends message → `chat_messages` (role=user), title set from first message only
- Orchestrator before-text → `chat_messages` (role=assistant, agent_name=orchestrator)
- Delegation detected → `chat_messages` (role=delegation, agent_name=sub-agent)
- Sub-agent response complete → `chat_messages` (role=assistant, agent_name=sub-agent)
- Non-delegated response → `chat_messages` (role=assistant, agent_name=orchestrator)

**Message order in DB (correct):**
```
user → orchestrator explanation → delegation → sub-agent response
```

**Resume flow:**
- Click history entry → `/chat/{agentId}?resume={sessionId}`
- Loads messages from SQLite (read-only view)
- Does NOT create a new ACP session (no empty sessions)
- On first new message, lazily creates ACP session via `ensureLiveSession()`

**Files:**
- `src/lib/db/chat-history.ts` — DB schema, CRUD functions
- `src/app/api/chat/history/route.ts` — GET (sessions/messages), DELETE

### 3. Full-Width UI Overhaul

**Layout:** Removed `max-w-6xl` wrapper from root layout. Each page controls its own width.

**Dashboard (/):**
```
┌─────────────────────────────────┬──────────┐
│  Agent Grid + Hierarchy Tree    │ Recent   │
│  [agent cards]                  │ Chats    │
└─────────────────────────────────┴──────────┘
         flex-1                      272px
```

**Chat page (/chat/[agentId]) — 3-column layout:**
```
┌──────────┬─────────────────────────────┬──────────┐
│  Chat    │     Chat Messages           │ Sub-     │
│  History │                             │ Agents   │
│          │  [orchestrator explanation]  │ or       │
│  + New   │  [delegation banner]        │ Agent    │
│  Session1│  [sub-agent response]       │ Info     │
│  ...     │                             │          │
│          │  [input bar + voice]        │ Tools    │
└──────────┴─────────────────────────────┴──────────┘
   264px          flex-1                    264px
```

**Chat history sidebar (left):**
- Shows all past sessions for the current agent
- "New Chat" button at top
- Delete button (✕) appears on hover
- Active session highlighted

**Sub-agent sidebar (right):**
- For orchestrators: shows child agents with active indicator (amber pulse)
- For standalone agents: shows agent info (description, model)
- Always shows tools list and session ID

**Delegation UI indicators:**
- Centered amber banner: "Delegating to {agent-name} — {task}"
- Sub-agent responses have amber border + agent name label
- Active sub-agent pulses in right sidebar

### 4. Session Recovery

Auto-retry on 404: if `POST /api/chat/prompt` returns 404 (session expired from server restart or LRU eviction), the client automatically creates a new ACP session and retries the prompt. Transparent to the user.

---

## Bugs Fixed

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Sub-agent response not streaming | `handleDelegation()` called while orchestrator's `client.prompt()` RPC still pending — two competing requests | Defer delegation: set `pendingDelegation`, wait for orchestrator prompt to resolve, then delegate |
| Raw `<delegate>` XML leaking to UI | Text chunks streamed before full tag detected | Track `sentLength`, buffer text once `<delegate` seen, send only text before tag start |
| Wrong message order in history | Orchestrator text saved in `close()` after sub-agent | Save orchestrator before-text immediately on detection, skip save in `close()` when delegation happened |
| Empty sessions on resume | `POST /api/chat/session` called every page load | Resume mode fetches agent info from `GET /api/agents/[id]`, creates ACP session only on first message |
| Title overwritten on every message | `updateSessionTitle` had no guard | SQL: `WHERE title IS NULL OR title = ''` |
| Delegation shows description not name | Client read `agent_name` (snake_case) but API returns `agentName` (camelCase) | Fixed to read `agentName` with fallback |
| 404 on prompt after server restart | In-memory session manager wiped | Auto-retry: recreate session on 404, retry prompt |

---

## Current Route Table

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Page | Dashboard — agent grid + recent chats |
| `/agents/new` | Page | Create agent (LLM conversation builder) |
| `/agents/[id]` | Page | Agent detail + JSON editor |
| `/chat/[agentId]` | Page | Chat with agent (3-column layout) |
| `/api/agents` | API | List/create agents |
| `/api/agents/[id]` | API | Get/update/delete agent |
| `/api/agents/confirm` | API | Confirm agent creation from builder |
| `/api/agents/from-voice` | API | Create agent from voice transcript |
| `/api/agents/templates` | API | Agent templates |
| `/api/builder/chat` | API | LLM conversation for agent creation (SSE) |
| `/api/chat/session` | API | Create ACP session |
| `/api/chat/prompt` | API | Stream prompt response (SSE + delegation) |
| `/api/chat/history` | API | Chat history CRUD |
| `/api/voice/synthesize` | API | TTS (future) |
| `/api/voice/transcribe` | API | STT (future) |

---

## File Reference (New/Modified)

| File | Purpose |
|------|---------|
| `src/lib/db/chat-history.ts` | SQLite schema + CRUD (WAL mode, better-sqlite3) |
| `src/app/api/chat/history/route.ts` | GET sessions/messages, DELETE session |
| `src/app/api/chat/prompt/route.ts` | SSE streaming + delegation detection + text buffering + auto-save |
| `src/app/api/chat/session/route.ts` | Create ACP session + SQLite record + return children |
| `src/app/chat/[agentId]/page.tsx` | 3-column chat UI, history sidebar, resume, session recovery |
| `src/components/recent-chats.tsx` | Recent chats component (used on dashboard) |
| `src/app/page.tsx` | Dashboard — full-width with agent grid + recent chats sidebar |
| `src/app/layout.tsx` | Full-width nav, no max-width wrapper |
| `.gitignore` | Added `.kiro/chat-history.db*` |

---

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | ^11.x | SQLite driver (native, synchronous) |
| `@types/better-sqlite3` | ^7.x | TypeScript types |

---

## What's Next

- [ ] AWS Transcribe integration (replace Web Speech API)
- [ ] Amazon Polly TTS (speak button in chat)
- [ ] Auth (NextAuth.js)
- [ ] Phase 2: Bedrock Agent Core auto-deploy
- [ ] Chat search / filter in history sidebar
- [ ] Export chat as markdown
- [ ] Multi-turn delegation (orchestrator delegates multiple times in one conversation)
