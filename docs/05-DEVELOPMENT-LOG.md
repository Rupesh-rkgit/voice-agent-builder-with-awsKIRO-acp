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
- [ ] Initialize Next.js project with dependencies
- [ ] Set up Tailwind + shadcn/ui
- [ ] Implement AgentConfigService (read/write .kiro/agents/*.json)
- [ ] Implement ACP session manager (spawn kiro-cli acp, JSON-RPC)
- [ ] Build agent CRUD API routes
- [ ] Build agent dashboard UI
- [ ] Build chat interface with streaming
- [ ] Add voice input (Web Speech API)
- [ ] Add voice → agent creation pipeline

### Open questions:
- How to handle Kiro auth in headless/server mode? Need to test `kiro-cli acp` with pre-existing auth session.
- Process pool sizing — how many concurrent `kiro-cli acp` processes can a single server handle?
