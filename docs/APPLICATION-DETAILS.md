# Voice Agent Studio — Application Details

## Overview

Voice Agent Studio is a web application for creating, managing, and chatting with multi-level AI agents using voice and text. It uses Kiro CLI as the LLM backend via the Agent Client Protocol (ACP), with SQLite for persistence and SSE for real-time streaming.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, Turbopack) | 16.1.6 |
| Language | TypeScript | 5.x |
| Runtime | Node.js | 20.x (enforced) |
| UI | React | 19.2.3 |
| Styling | Tailwind CSS | 4.x |
| State Management | Zustand | 5.0.11 |
| Validation | Zod | 4.3.6 |
| Database | SQLite via better-sqlite3 (WAL mode) | 12.6.2 |
| LLM Backend | Kiro CLI via ACP (JSON-RPC 2.0 over stdio) | 1.25+ |
| Voice Input | Web Speech API (browser-native) | — |
| Voice Output | AWS Polly (neural) | — |
| Transcription | AWS Transcribe Streaming | — |
| Streaming | Server-Sent Events (SSE) | — |
| IDs | UUID v4 | 13.x |

### AWS SDK Dependencies

- `@aws-sdk/client-bedrock-runtime` — Direct Bedrock access (backup/inactive)
- `@aws-sdk/client-polly` — Text-to-speech synthesis
- `@aws-sdk/client-transcribe-streaming` — Audio transcription

---

## Environment Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KIRO_CLI_PATH` | Yes | — | Absolute path to kiro-cli binary |
| `KIRO_WORKSPACE_DIR` | Yes | — | Project root where `.kiro/agents/` lives |
| `AWS_REGION` | Yes | `us-east-1` | AWS region for Bedrock/Polly/Transcribe |
| `MAX_ACP_SESSIONS` | No | `10` | Max concurrent kiro-cli child processes |
| `POLLY_VOICE_ID` | No | `Joanna` | AWS Polly voice for TTS |
| `POLLY_ENGINE` | No | `neural` | Polly engine (`neural` or `standard`) |
| `TRANSCRIBE_LANGUAGE_CODE` | No | `en-US` | Language for Transcribe |

---

## Pages & Routes

### 1. Dashboard — `/`

Server component. The landing page.

**Layout:**
```
┌─────────────────────────────────────────────┐
│              Hero Section                    │
│  "Build AI Agents with Agents"              │
│  [View Agents]  [Create Agent]              │
├─────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ N Agents │ │ N Orch.  │ │ N Chats  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
├─────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Voice-   │ │ Multi-   │ │ Persist. │    │
│  │ First    │ │ Agent    │ │ Chat     │    │
│  │ Creation │ │ Orch.    │ │ History  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
├─────────────────────────────────────────────┤
│  Recent Conversations (top 3)               │
│  [card] [card] [card]        View all →     │
└─────────────────────────────────────────────┘
```

**Data loaded:** `listAgents()` from filesystem, `getRecentChats(5)` from SQLite.

**Stats displayed:** Total agents, orchestrator count, recent chat count.

---

### 2. Agents List — `/agents`

Server component. Grid view of all agents with hierarchy tree.

**Layout:**
```
┌─────────────────────────────────────────────┐
│  Agents                        [+ New Agent]│
├─────────────────────────────────────────────┤
│  Total: N  │  Orchestrators: N  │  Solo: N  │
├─────────────────────────────────────────────┤
│  Agent Hierarchy (tree view, if any parent  │
│  → child relationships exist)               │
├─────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌────────┐│
│  │ AgentCard   │ │ AgentCard   │ │ Agent  ││
│  │ name, desc  │ │ name, desc  │ │ Card   ││
│  │ tools, model│ │ tools, model│ │        ││
│  │ [Chat][Edit]│ │ [Chat][Edit]│ │        ││
│  └─────────────┘ └─────────────┘ └────────┘│
└─────────────────────────────────────────────┘
```

**Components used:**
- `AgentTree` — Builds a tree from flat agent list using `parentAgentId`. Only renders if hierarchy exists. Nodes are clickable links.
- `AgentGrid` — Responsive grid (1/2/3 columns). Empty state with CTA.
- `AgentCard` — Shows name, description, tools (color-coded, max 5 shown), model badge, creation date. Actions: Chat, Edit, Delete (with confirm).

**Agent card tool colors:** Tools like `read`, `write`, `shell`, `aws`, `@git`, `@fetch` each have distinct color-coded badges.

---

### 3. Create Agent — `/agents/new`

Client component. Wraps the `ConversationBuilder` component.

This is the LLM-powered agent builder — a conversational interface where users describe what agent they want, and the AI asks clarifying questions then generates a config.

**Layout:**
```
┌─────────────────────────────────────────────┐
│  Create a New Agent                         │
│  "Describe what you need..."                │
├─────────────────────────────────────────────┤
│  [user bubble]   "I need a code reviewer"   │
│  [assistant bubble] "What languages?..."    │
│  [user bubble]   "Python and TypeScript"    │
│  [assistant bubble] "Here's the config..."  │
│                                             │
│  ┌─ Config Card ──────────────────────────┐ │
│  │ name: code-reviewer                    │ │
│  │ tools: read, write                     │ │
│  │ model: claude-sonnet-4                 │ │
│  │ prompt: You are a code review agent... │ │
│  └────────────────────────────────────────┘ │
│  [✓ Create Agent]  [✎ Edit]                 │
├─────────────────────────────────────────────┤
│  🎤  [text input........................] ↑ │
└─────────────────────────────────────────────┘
```

**Voice-first UX loop:**
1. User clicks 🎤 → Web Speech API starts listening
2. Speech ends → transcript auto-sent to LLM
3. LLM responds via SSE stream
4. After response finishes → auto-restart listening (800ms delay)

**Config extraction:** The LLM wraps configs in `<agent_config>` or `<team_config>` XML tags. `parseConfigFromResponse()` extracts and sanitizes them (valid tools, valid models, slug-formatted names).

**Team creation:** For multi-agent teams, the first config is the orchestrator, rest are children. Created sequentially with `parentAgentId` linking.

**State:** Managed by Zustand (`builder-store.ts`) — messages, streaming state, pending configs, created agents.

---

### 4. Agent Detail — `/agents/[id]`

Server component. View and edit a single agent's configuration.

**Sections:**
- Header with name, description, and "Chat" button
- Tools list (badge display)
- `AgentConfigEditor` — JSON editor with Edit/Save/Cancel. Validates JSON before saving. PUT to `/api/agents/:id`.
- Child agents list (if orchestrator) — clickable links to child detail pages
- Metadata footer: ID, config path, creation date

---

### 5. Chat — `/chat/[agentId]`

Client component. The main chat interface. 3-column layout.

**Layout:**
```
┌──────────┬─────────────────────────────┬──────────┐
│  Left    │     Center                  │  Right   │
│  Sidebar │     Chat Messages           │  Sidebar │
│          │                             │          │
│  + New   │  [empty state: agent icon,  │  Sub-    │
│  Chat    │   name, description]        │  Agents  │
│          │                             │  (if     │
│  History │  [user message]             │  orch.)  │
│  - Chat1 │  [assistant message]        │          │
│  - Chat2 │  [tool call indicator]      │  OR      │
│  - Chat3 │  [delegation banner]        │          │
│          │  [sub-agent response]       │  Agent   │
│          │  [typing dots]              │  Info    │
│          │                             │  (if     │
│          │                             │  solo)   │
│          ├─────────────────────────────┤          │
│          │ 🎤 [input...............] ↑ │  Tools   │
│          │                             │  Session │
└──────────┴─────────────────────────────┴──────────┘
```

**Left sidebar (w-64):**
- "+ New Chat" button (links to `/chat/[agentId]` without `?resume=`)
- Chat history for this agent, loaded from `/api/chat/history?agentId=X`
- Active session highlighted. Each entry shows title, date, delete button on hover.

**Center (flex-1):**
- Empty state: agent icon, name, description, "Type a message or use voice"
- Messages: user (violet gradient, right-aligned), assistant (dark bg, left-aligned)
- Sub-agent messages: amber-tinted border with agent name badge
- Delegation banners: centered pill with pulsing amber dot, "Delegating to X — task"
- Tool call indicators: inline badges with running (amber pulse) or complete (green) status
- Typing indicator: 3 animated dots
- Input bar: mic button, text input, send button

**Right sidebar (w-64):**
- For orchestrators: "Sub-Agents (N)" list. Active sub-agent gets amber glow + "⚡ Active" badge during delegation.
- For standalone agents: "Agent Info" — description, model
- Tools section (always shown)
- Session ID (truncated)

**Session management:**
- New chat: POST `/api/chat/session` → spawns kiro-cli process
- Resume: loads messages from SQLite, marks as `isResumed`
- On first message after resume: creates a new ACP session transparently
- Session recovery: if prompt returns 404, auto-recreates session and retries

**Message flow:**
1. User types/speaks → `sendMessage(text)`
2. POST `/api/chat/prompt` with `{ sessionId, message }`
3. Read SSE stream → `processSSELine()` updates messages in real-time
4. On `turn_end` → finalize, refresh history sidebar

---

### 6. Chat History — `/history`

Server component. Lists all chat sessions across all agents.

**Layout:**
```
┌─────────────────────────────────────────────┐
│  Chat History                               │
│  "N conversations"                          │
├─────────────────────────────────────────────┤
│  🤖 [title]  [agent-name badge]            │
│     2h ago · 15 messages            [🗑️]   │
│  🤖 [title]  [agent-name badge]            │
│     1d ago · 8 messages             [🗑️]   │
│  ...                                        │
└─────────────────────────────────────────────┘
```

**Data:** `getRecentChats(50)` from SQLite. Each entry links to `/chat/[agentId]?resume=[sessionId]`. Delete button on hover.

**Empty state:** Icon + "No conversations yet" + "Browse Agents" CTA.

---

## Components

| Component | File | Description |
|-----------|------|-------------|
| `ConversationBuilder` | `conversation-builder.tsx` | Full agent creation chat UI with voice, streaming, config cards, team creation |
| `AgentGrid` | `agent-grid.tsx` | Responsive grid of AgentCards with delete support |
| `AgentCard` | `agent-card.tsx` | Individual agent card — name, desc, tools, model, actions |
| `AgentTree` | `agent-tree.tsx` | Hierarchy visualization from flat agent list. Builds tree, renders nested nodes |
| `AgentConfigEditor` | `agent-config-editor.tsx` | JSON editor with edit/save/cancel for agent configs |
| `RecentChats` | `recent-chats.tsx` | Compact chat session list for sidebars |
| `HistoryList` | `history-list.tsx` | Full-width chat session list for history page |

---

## API Endpoints

### Agent CRUD

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/api/agents` | — | `AgentMeta[]` |
| POST | `/api/agents` | `CreateAgentRequest` (Zod validated) | `AgentMeta` (201) |
| GET | `/api/agents/[id]` | — | `{ meta, config, children }` |
| PUT | `/api/agents/[id]` | Partial `KiroAgentConfig` | `{ ok: true }` |
| DELETE | `/api/agents/[id]` | — | `{ ok: true }` |
| GET | `/api/agents/templates` | — | Template list |
| POST | `/api/agents/confirm` | `{ config }` | `AgentMeta` (201) |
| POST | `/api/agents/from-voice` | `{ transcript }` | `{ parsedConfig, confidence, needsConfirmation }` |

### Chat

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/chat/session` | `{ agentId }` | `{ sessionId, agentName, children, tools, model }` (201) |
| POST | `/api/chat/prompt` | `{ sessionId, message }` | SSE stream (text, tool_call, delegation, error, turn_end) |
| GET | `/api/chat/history?agentId=X` | — | `{ sessions: ChatSession[] }` |
| GET | `/api/chat/history?sessionId=X` | — | `{ messages: ChatMessage[] }` |
| DELETE | `/api/chat/history` | `{ sessionId }` | `{ ok: true }` |

### Builder

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/builder/chat` | `{ messages }` | SSE stream (`{ text }` chunks, `[DONE]`) |
| POST | `/api/builder/chat` | `{ action: "reset" }` | `{ ok: true }` |

### Voice

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/voice/transcribe` | FormData with `audio` file | `{ transcript, confidence }` |
| POST | `/api/voice/synthesize` | `{ text, voiceId? }` | `audio/mpeg` binary |

### Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/health` | System health status |

---

## Data Storage

### Agent Configs (Filesystem)

```
.kiro/agents/
├── .agent-index.json          # UUID → AgentMeta mapping (gitignored)
├── code-reviewer.json         # Agent config (committed)
├── my-orchestrator.json
└── sub-agent-1.json
```

**Agent config schema** (`KiroAgentConfig`):
```
name          string    slug format (a-z, 0-9, hyphens), 1-64 chars
description   string    1-500 chars
prompt        string    system prompt
tools         string[]  default: ["read", "write"]
model         string    default: "claude-sonnet-4"
parentAgentId string?   UUID of parent (for sub-agents)
mcpServers    object?   MCP server configurations
allowedTools  string[]? tool whitelist
toolAliases   object?   tool name mappings
resources     array?    additional resources
keyboardShortcut string? keyboard shortcut binding
welcomeMessage string?  initial greeting
hooks         any?      lifecycle hooks
```

**Valid tools:** `read`, `write`, `shell`, `aws`, `@git`, `@fetch`

**Valid models:** `claude-sonnet-4`, `claude-sonnet-4.5`, `claude-haiku-4.5`, `claude-opus-4.5`, `auto`

### Chat History (SQLite)

Location: `.kiro/chat-history.db` (WAL mode, gitignored)

**Tables:**
```sql
chat_sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  agent_name  TEXT NOT NULL,
  title       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
)

chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,        -- 'user', 'assistant', 'delegation'
  content     TEXT NOT NULL,
  agent_name  TEXT,                 -- which agent produced this message
  created_at  TEXT DEFAULT (datetime('now'))
)
```

**Indexes:** `idx_messages_session` on session_id, `idx_sessions_agent` on agent_id.

---

## State Management

### Zustand Store (`builder-store.ts`)

Used by the ConversationBuilder component.

| Field | Type | Purpose |
|-------|------|---------|
| `messages` | `BuilderMessage[]` | Conversation history (role, content, timestamp) |
| `streaming` | `boolean` | Whether LLM is currently streaming |
| `streamingText` | `string` | Accumulated text during streaming |
| `pendingConfig` | `ExtractedConfig \| null` | Single agent config awaiting confirmation |
| `pendingTeam` | `ExtractedConfig[] \| null` | Team configs awaiting confirmation |
| `createdAgents` | `{ id, name }[]` | Successfully created agents |

**Actions:** `addMessage`, `setStreaming`, `setStreamingText`, `appendStreamingText`, `setPendingConfig`, `setPendingTeam`, `addCreatedAgent`, `reset`

---

## Voice Integration

### Input — `useVoice()` hook

Uses the browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).

- `continuous: false` — single utterance mode
- `interimResults: false` — only final results
- `lang: "en-US"`
- Returns: `{ isListening, transcript, startListening, stopListening, supported }`
- Feature-detected at mount time (SSR-safe)

### Output — AWS Polly

POST `/api/voice/synthesize` with `{ text, voiceId }` → returns `audio/mpeg` binary.

### Transcription — AWS Transcribe Streaming

POST `/api/voice/transcribe` with FormData audio → returns `{ transcript, confidence }`. Uses PCM encoding at 16kHz.

---

## UI Design System

**Theme:** Dark mode only. Black/slate backgrounds with violet/indigo accents.

**Color palette:**
- Primary: violet-500/600 → indigo-500/600 gradients
- Success: emerald-400/500
- Warning/Delegation: amber-300/400/500
- Error: red-400/500
- Text: white (primary), slate-300/400 (secondary), slate-500/600 (muted)
- Borders: `white/[0.06]` (subtle), `white/[0.12]` (hover)
- Backgrounds: `white/[0.02]` (cards), `white/[0.04]` (badges)

**Patterns:**
- Cards: `rounded-xl border border-white/[0.06] bg-white/[0.02]` with `card-glow` hover effect
- Buttons: `btn-primary` (violet gradient), `btn-secondary` (transparent with border)
- Badges: `rounded-full` or `rounded-md` with tinted bg + ring
- Animations: `animate-fade-in` (staggered with `animationDelay`), `typing-dot` (bounce), `voice-pulse` (mic glow)
- Typography: Inter font, `tracking-tight` for headings, `gradient-text` for hero text
- Labels: `text-[10px] font-semibold text-slate-500 uppercase tracking-widest`

**Navigation:**
- Sticky header with logo (SVG waveform icon), brand name, "Powered by Kiro" subtitle
- Nav links: Agents, History, + New Agent (primary button)
- Footer: version, "Kiro CLI + ACP", system health indicator (green dot)

**Responsive:** Grid columns adapt (1 → 2 → 3). Agent card actions hidden on desktop, visible on hover. Mobile-first input sizing.

**Accessibility:** `aria-label` on icon-only buttons, semantic HTML, keyboard navigation (Enter to send), focus ring styles on inputs.

---

## Scripts

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
```

The `predev` script enforces Node.js 20 — exits with error if wrong version detected.
