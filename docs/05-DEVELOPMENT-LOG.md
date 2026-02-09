# Development Log

## 2026-02-09 — Project Initialization

### What was done:
- Created project structure and documentation
- Defined tech stack (Next.js 15, TypeScript, Vercel AI SDK, ACP)
- Designed REST API (agents CRUD, chat sessions, voice endpoints)
- Documented environment variables and AWS permissions
- Defined Zod schemas for agent config validation

### Key decisions:
1. Using Next.js API routes instead of separate Express server — fewer moving parts
2. Web Speech API for MVP voice input — zero cost, upgrade to Transcribe later
3. SQLite for MVP database — zero config, Drizzle ORM makes migration to Postgres trivial
4. Socket.io for real-time ACP event streaming to browser

### Next steps:
- [ ] Initialize Next.js project with dependencies ✅
- [ ] Set up Tailwind + shadcn/ui (Tailwind done, shadcn next) ✅
- [ ] Implement AgentConfigService (read/write .kiro/agents/*.json) ✅
- [ ] Implement ACP session manager (spawn kiro-cli acp, JSON-RPC) ✅
- [ ] Build agent CRUD API routes ✅
- [ ] Build voice API routes (Transcribe + Polly) ✅
- [ ] Build intent parser (voice → agent config) ✅
- [ ] Build agent dashboard UI ✅
- [ ] Build chat interface with streaming ✅
- [ ] Add voice input (Web Speech API) ✅
- [ ] Add voice → agent creation pipeline ✅
- [ ] Conversational agent builder (back-and-forth flow) ✅
- [ ] UI design doc ✅

### Remaining:
- [x] Agent delete from dashboard (client-side fetch) ✅
- [x] Multi-agent team creation flow (orchestrator + children) ✅
- [x] Agent hierarchy tree visualization ✅
- [x] Inline JSON config editor on agent detail page ✅
- [ ] AWS Transcribe integration (production voice, replacing Web Speech API)
- [ ] Amazon Polly TTS wired to UI (speak button)
- [ ] Bedrock-powered intent parsing (enhanced)
- [ ] Auth (NextAuth.js)
- [ ] E2E testing with kiro-cli
- [ ] Error boundaries + loading states
- [ ] Session cleanup (ACP process leak prevention)
- [ ] Phase 2 planning: Bedrock Agent Core export

## 2026-02-09 — Session 2: UI Completion

### What was done:
- Dashboard delete with optimistic UI update
- Multi-agent team creation (orchestrator + N specialists)
- Agent hierarchy tree component (auto-renders when hierarchy exists)
- Inline JSON config editor with save/cancel/validation
- Conversation builder handles both single and team flows
- Full status doc: docs/07-SESSION-2-STATUS.md

### Build status: ✅ Clean (0 errors, 14 routes)

### Open questions:
- How to handle Kiro auth in headless/server mode? Need to test `kiro-cli acp` with pre-existing auth session.
- Process pool sizing — how many concurrent `kiro-cli acp` processes can a single server handle?

## 2026-02-09 — Session 3: ACP Integration & LLM Builder

### What was done:
- Fixed ACP client: `prompt` field (not `content`), `session/update` notifications, `modeId` (not `mode`)
- Fixed agent creation: `parentAgentId: null` accepted via Zod `.nullable().optional()`
- LLM-powered conversation builder replacing rigid keyword step machine
- Bedrock direct code preserved at `src/lib/bedrock/converse-bedrock.ts`
- Config sanitization: `parseConfigFromResponse()` + `sanitizeConfig()`

### Build status: ✅ Clean

## 2026-02-09 — Session 4–5: Delegation, Chat History, UI Overhaul

### What was done:
- **Orchestrator delegation** — detects `<delegate>` tags, switches ACP mode, streams sub-agent response
- **Race condition fix** — orchestrator prompt must resolve before delegation starts (prevents competing RPCs)
- **Text buffering** — tracks `sentLength`, suppresses `<delegate>` XML from reaching UI
- **SQLite chat history** — `better-sqlite3`, WAL mode, auto-save at every step
- **Chat resume** — loads messages from SQLite, lazily creates ACP session on first new message
- **Session recovery** — auto-recreates session on 404 (server restart / LRU eviction)
- **Full-width UI** — 3-column chat layout (history | messages | sub-agents), dashboard with recent chats sidebar
- **Delete chats** — hover ✕ button on history entries
- **Delegation UI** — amber banner, sub-agent response border, active indicator in sidebar
- **Docs** — Session 4-5 status doc, updated architecture reference

### Bugs fixed:
- Sub-agent response not streaming (RPC race condition)
- Raw `<delegate>` XML leaking to UI (text buffering)
- Wrong message order in history (save order fix)
- Empty sessions on resume (lazy session creation)
- Title overwritten on every message (SQL guard)
- Delegation shows description not name (camelCase field fix)
- 404 on prompt after server restart (auto-retry)

### Build status: ✅ Clean (0 errors, 16 routes)

### Dependencies added:
- `better-sqlite3` + `@types/better-sqlite3`

### Open questions:
- Multi-turn delegation (orchestrator delegates multiple times in one conversation)
- Chat search/filter in history sidebar
- Export chat as markdown
