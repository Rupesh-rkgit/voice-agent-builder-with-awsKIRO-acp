# Tech Stack & Architecture Decisions

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | Next.js 15 (App Router) | SSR, API routes, streaming support, React Server Components |
| UI library | shadcn/ui + Tailwind CSS 4 | Production-quality components, accessible, customizable |
| Language | TypeScript (full-stack) | Type safety across client/server, shared types |
| Backend runtime | Node.js (Next.js API routes) | Same runtime as frontend, simplifies deployment |
| Kiro integration | `@mcpc-tech/acp-ai-provider` + raw ACP | AI SDK for streaming, raw JSON-RPC for agent management |
| AI SDK | Vercel AI SDK v6 | `streamText`, `generateText` with ACP provider |
| Speech-to-Text | Web Speech API (MVP) → AWS Transcribe (prod) | Zero-cost MVP, upgrade path to production quality |
| Text-to-Speech | Browser SpeechSynthesis (MVP) → Amazon Polly (prod) | Same upgrade path |
| State management | Zustand (client) | Lightweight, no boilerplate |
| Database | SQLite via better-sqlite3 (WAL mode) | Zero-config, synchronous, fast. Chat history at `.kiro/chat-history.db` |
| Agent storage | Filesystem (`.kiro/agents/`) | Native Kiro format, no translation layer |
| Process management | Node.js `child_process` | Spawn `kiro-cli acp` per session |
| Real-time streaming | Server-Sent Events (SSE) | Simpler than WebSocket for unidirectional streaming |
| Auth | NextAuth.js v5 | Session management, extensible providers |
| Validation | Zod | Runtime type validation for agent configs and API payloads |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                               │
│                                                              │
│  Next.js App (React)                                         │
│  ├── Voice Capture (Web Speech API / MediaRecorder)          │
│  ├── Agent Dashboard (CRUD UI)                               │
│  ├── Chat Interface (streaming messages)                     │
│  └── Socket.io Client (real-time ACP events)                 │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP + WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    NEXT.JS SERVER                             │
│                                                              │
│  API Routes                                                  │
│  ├── POST /api/agents          → Create agent config         │
│  ├── GET  /api/agents          → List agents                 │
│  ├── GET  /api/agents/:id      → Get agent detail            │
│  ├── PUT  /api/agents/:id      → Update agent config         │
│  ├── DELETE /api/agents/:id    → Delete agent                │
│  ├── POST /api/chat/session    → Create ACP session          │
│  ├── POST /api/chat/prompt     → Send prompt (streaming)     │
│  ├── POST /api/voice/transcribe→ Transcribe audio (Transcribe│
│  └── POST /api/voice/synthesize→ TTS response (Polly)        │
│                                                              │
│  Services                                                    │
│  ├── AcpSessionManager   → Pool of kiro-cli acp processes    │
│  ├── AgentConfigService   → Read/write .kiro/agents/*.json   │
│  ├── IntentParser         → LLM-based voice→config parsing   │
│  └── TranscriptionService → AWS Transcribe integration       │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio (JSON-RPC 2.0)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    KIRO CLI (ACP)                             │
│                                                              │
│  kiro-cli acp  (one process per user session)                │
│  ├── initialize → session/new → session/prompt               │
│  ├── session/set_mode (switch agents)                        │
│  └── Streams: AgentMessageChunk, ToolCall, TurnEnd           │
│                                                              │
│  Agent Configs: ~/.kiro/agents/ or .kiro/agents/             │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
voice-agent-studio/
├── docs/                          # Project documentation
│   ├── 01-PROJECT-OVERVIEW.md
│   ├── 02-TECH-STACK.md          (this file)
│   ├── 03-API-DESIGN.md
│   ├── 04-ENV-SETUP.md
│   └── 05-DEVELOPMENT-LOG.md
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Landing / Dashboard
│   │   ├── agents/
│   │   │   ├── page.tsx           # Agent list
│   │   │   ├── new/page.tsx       # Create agent (voice/text)
│   │   │   └── [id]/page.tsx      # Agent detail / edit
│   │   ├── chat/
│   │   │   └── [agentId]/page.tsx # Chat with agent
│   │   └── api/
│   │       ├── agents/route.ts
│   │       ├── chat/
│   │       │   ├── session/route.ts
│   │       │   └── prompt/route.ts
│   │       └── voice/
│   │           ├── transcribe/route.ts
│   │           └── synthesize/route.ts
│   ├── lib/
│   │   ├── acp/                   # ACP client & session manager
│   │   │   ├── client.ts
│   │   │   ├── session-manager.ts
│   │   │   └── types.ts
│   │   ├── agents/                # Agent config CRUD
│   │   │   ├── config-service.ts
│   │   │   ├── schema.ts          # Zod schemas
│   │   │   └── templates.ts       # Pre-built agent templates
│   │   ├── voice/                 # Voice services
│   │   │   ├── transcribe.ts
│   │   │   └── polly.ts
│   │   ├── intent/                # Voice → agent config parser
│   │   │   └── parser.ts
│   │   └── db/                    # Database (session history, etc.)
│   │       ├── schema.ts
│   │       └── index.ts
│   ├── components/                # React components
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── voice-recorder.tsx
│   │   ├── agent-card.tsx
│   │   ├── agent-form.tsx
│   │   ├── chat-interface.tsx
│   │   └── agent-hierarchy.tsx
│   ├── hooks/                     # Custom React hooks
│   │   ├── use-voice.ts
│   │   ├── use-chat.ts
│   │   └── use-agents.ts
│   └── stores/                    # Zustand stores
│       ├── agent-store.ts
│       └── chat-store.ts
├── .kiro/
│   └── agents/                    # Generated agent configs live here
├── .env.local                     # Environment variables
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── drizzle.config.ts
└── next.config.ts
```

## Key Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "ai": "^6",
    "@mcpc-tech/acp-ai-provider": "latest",
    "socket.io": "^4",
    "socket.io-client": "^4",
    "zustand": "^5",
    "zod": "^3",
    "drizzle-orm": "latest",
    "better-sqlite3": "latest",
    "@aws-sdk/client-transcribe-streaming": "latest",
    "@aws-sdk/client-polly": "latest",
    "@auth/nextjs": "latest"
  },
  "devDependencies": {
    "typescript": "^5",
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "latest",
    "drizzle-kit": "latest",
    "eslint": "^9",
    "prettier": "latest"
  }
}
```
