# Voice Agent Studio

A web application for creating, managing, and interacting with multi-level AI agents using voice and text commands. Powered by **Kiro CLI** via the Agent Client Protocol (ACP).

Orchestrator agents delegate tasks to specialized sub-agents in real-time, with streaming responses, persistent chat history, and a voice-first UX.

![Next.js](https://img.shields.io/badge/Next.js-16.1-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![SQLite](https://img.shields.io/badge/SQLite-WAL-green)
![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-1.25-purple)

---

## Features

- **LLM-Powered Agent Builder** — Create agents through natural conversation, not forms
- **Multi-Agent Orchestration** — Orchestrator agents delegate to sub-agents with real-time UI indicators
- **Streaming Chat** — SSE-based streaming with tool call indicators and delegation banners
- **Voice Input** — Web Speech API for hands-free interaction
- **Persistent Chat History** — SQLite-backed, auto-saved, resumable sessions
- **Agent Hierarchy** — Visual tree showing parent → child relationships
- **Session Recovery** — Auto-reconnects on server restart or session eviction

## Architecture

```
┌──────────────┐     HTTP/SSE      ┌──────────────────┐    stdio/JSON-RPC    ┌───────────┐
│   Browser    │ ◄──────────────► │  Next.js Server   │ ◄──────────────────► │ kiro-cli  │
│   (React)    │                   │  (API Routes)     │                      │   (ACP)   │
│              │                   │                    │                      │           │
│  - Chat UI   │                   │  - ACP Client      │                      │  - Claude │
│  - Voice     │                   │  - Session Pool    │                      │  - Tools  │
│  - Builder   │                   │  - SQLite History  │                      │  - Agents │
└──────────────┘                   └──────────────────┘                      └───────────┘
```

**Delegation flow:**
```
User → Orchestrator → detects <delegate> tag → switches ACP mode → Sub-agent responds → switches back
```

## Quick Start

### Prerequisites

- **Node.js** 20+ (`nvm use 20`)
- **Kiro CLI** 1.25+ installed and authenticated
- **AWS credentials** configured (for Kiro CLI's Bedrock access)

### Setup

```bash
# Clone and install
git clone <repo-url> voice-agent-studio
cd voice-agent-studio
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local — set KIRO_CLI_PATH and KIRO_WORKSPACE_DIR

# Verify Kiro CLI
kiro-cli --version
kiro-cli auth status

# Start dev server
npm run dev
# Open http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KIRO_CLI_PATH` | Yes | Path to kiro-cli binary |
| `KIRO_WORKSPACE_DIR` | Yes | Project root (where `.kiro/agents/` lives) |
| `AWS_REGION` | Yes | AWS region (default: `us-east-1`) |
| `MAX_ACP_SESSIONS` | No | Max concurrent kiro-cli processes (default: 10) |

See [Environment Setup](docs/04-ENV-SETUP.md) for all options.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Create agent |
| GET | `/api/agents/:id` | Get agent + children |
| PUT | `/api/agents/:id` | Update agent config |
| DELETE | `/api/agents/:id` | Delete agent |
| GET | `/api/agents/templates` | Agent templates |
| POST | `/api/agents/confirm` | Confirm agent from builder |
| POST | `/api/agents/from-voice` | Voice transcript → agent config |
| POST | `/api/builder/chat` | LLM conversation builder (SSE) |
| POST | `/api/chat/session` | Create ACP chat session |
| POST | `/api/chat/prompt` | Send prompt — streaming + delegation (SSE) |
| GET | `/api/chat/history` | List sessions or get messages |
| DELETE | `/api/chat/history` | Delete chat session |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Dashboard — agent grid + recent chats
│   ├── agents/new/page.tsx         # LLM conversation builder
│   ├── agents/[id]/page.tsx        # Agent detail + JSON editor
│   ├── chat/[agentId]/page.tsx     # 3-column chat UI
│   └── api/
│       ├── agents/                 # Agent CRUD
│       ├── builder/chat/           # Builder conversation (SSE)
│       ├── chat/
│       │   ├── session/            # ACP session creation
│       │   ├── prompt/             # Streaming + delegation
│       │   └── history/            # Chat history CRUD
│       └── voice/                  # Transcribe + Polly (future)
├── lib/
│   ├── acp/
│   │   ├── client.ts              # ACP JSON-RPC client
│   │   ├── session-manager.ts     # Session pool (max 10, LRU)
│   │   └── builder-provider.ts    # Dedicated builder session
│   ├── agents/
│   │   ├── config-service.ts      # CRUD for .kiro/agents/*.json
│   │   └── schema.ts              # Zod schemas
│   ├── db/
│   │   └── chat-history.ts        # SQLite (better-sqlite3, WAL)
│   └── bedrock/
│       └── converse-bedrock.ts    # Direct Bedrock (backup, inactive)
├── components/
│   ├── conversation-builder.tsx    # Agent creation chat
│   ├── recent-chats.tsx            # Recent sessions sidebar
│   └── agent-tree.tsx              # Hierarchy visualization
├── stores/
│   └── builder-store.ts           # Zustand — builder state
└── hooks/
    └── use-voice.ts               # Web Speech API hook

.kiro/
├── agents/                         # Agent config files (JSON)
│   ├── .agent-index.json           # UUID → name index (gitignored)
│   └── *.json                      # Agent configs (committed)
└── chat-history.db                 # SQLite database (gitignored)

docs/                               # 13 documentation files
```

## UI Layout

**Dashboard:**
```
┌─────────────────────────────────┬──────────┐
│  Agent Grid + Hierarchy Tree    │ Recent   │
│                                 │ Chats    │
└─────────────────────────────────┴──────────┘
```

**Chat (3-column):**
```
┌──────────┬─────────────────────────────┬──────────┐
│  Chat    │     Messages                │ Sub-     │
│  History │  [orchestrator explanation]  │ Agents   │
│          │  [delegation banner]        │ or       │
│  + New   │  [sub-agent response]       │ Agent    │
│  ...     │  [input + voice]            │ Info     │
└──────────┴─────────────────────────────┴──────────┘
```

## Documentation

| Doc | Description |
|-----|-------------|
| [01 — Project Overview](docs/01-PROJECT-OVERVIEW.md) | What and why |
| [02 — Tech Stack](docs/02-TECH-STACK.md) | Architecture decisions, dependencies |
| [03 — API Design](docs/03-API-DESIGN.md) | All endpoints with request/response schemas |
| [04 — Environment Setup](docs/04-ENV-SETUP.md) | Prerequisites, env vars, AWS permissions |
| [05 — Development Log](docs/05-DEVELOPMENT-LOG.md) | Progress tracking, decisions, bugs |
| [06 — UI Design](docs/06-UI-DESIGN.md) | Pages, components, layouts, conversation flows |
| [07 — Session 2 Status](docs/07-SESSION-2-STATUS.md) | Agent CRUD, hierarchy, editor |
| [08 — ACP Integration](docs/08-ACP-INTEGRATION-VERIFIED.md) | Protocol details, verified fields |
| [09 — LLM Builder](docs/09-SESSION-3-LLM-BUILDER.md) | Conversational agent creation |
| [10 — Architecture Reference](docs/10-ARCHITECTURE-REFERENCE.md) | Full system architecture (530 lines) |
| [11 — Authentication Guide](docs/11-AUTHENTICATION-GUIDE.md) | Three auth layers, troubleshooting |
| [12 — EKS Deployment](docs/12-EKS-DEPLOYMENT-GUIDE.md) | Docker, K8s, IRSA, EFS, scaling |
| [13 — Session 4-5 Status](docs/13-SESSION-4-5-STATUS.md) | Delegation, chat history, UI overhaul |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router, Turbopack) |
| Language | TypeScript 5.x |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Validation | Zod v4 |
| Database | SQLite (better-sqlite3, WAL mode) |
| LLM Backend | Kiro CLI via ACP (JSON-RPC 2.0 over stdio) |
| Voice | Web Speech API (MVP) |
| Streaming | Server-Sent Events (SSE) |

## License

Private — All rights reserved.
