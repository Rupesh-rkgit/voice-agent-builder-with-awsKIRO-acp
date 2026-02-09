# Session 2 — What Was Done, What's Next, What to Watch Out For

## Date: 2026-02-09

---

## What Was Done This Session

### 1. Dashboard Delete Functionality
- Created `AgentGrid` client component that wraps `AgentCard` with delete capability
- Delete calls `DELETE /api/agents/:id` with confirmation dialog
- Agents are removed from the UI immediately (optimistic update)
- The server deletes both the `.kiro/agents/<name>.json` file and the index entry

### 2. Multi-Agent Team Creation Flow
- Completely rewrote `builder-store.ts` to support a branching conversation:
  - **Single agent path**: greeting → type → name → tools → hierarchy → confirm → create
  - **Team path**: greeting → "team" → domain → add members (loop) → finalize → create all
- The team flow creates an **orchestrator agent** (parent) + N **specialist agents** (children)
- Each child agent gets `parentAgentId` set to the orchestrator's UUID
- The orchestrator's prompt auto-includes the names of all child agents

**Example team conversation:**
```
User: "A team of agents"
System: "What domain?"
User: "Full-stack development"
System: "First team member's role?"
User: "Backend developer"
System: "Name?"
User: "api-builder"
System: "Tools? Suggested: read, write, shell"
User: "Keep these"
System: "Added! Add another or finalize?"
User: "Add frontend developer"
... (repeats)
User: "Finalize"
System: "Creating 3 agents..."
```

### 3. Agent Hierarchy Tree Visualization
- Created `AgentTree` component that builds a tree from flat agent list
- Uses `parentAgentId` to construct parent → children relationships
- Only renders when hierarchy exists (doesn't clutter single-agent dashboards)
- Tree nodes are clickable links to agent detail pages
- Orchestrators get a 🎯 icon, specialists get 🤖

### 4. Inline JSON Config Editor
- Created `AgentConfigEditor` component on the agent detail page
- View mode: read-only JSON with syntax highlighting
- Edit mode: full textarea with save/cancel
- Validates JSON before saving, shows errors inline
- Calls `PUT /api/agents/:id` on save
- Success/error feedback with auto-dismiss

### 5. Conversation Builder Improvements
- Updated to handle both single and team creation flows
- Team creation creates all agents sequentially (orchestrator first, then members)
- Progress messages shown during multi-agent creation
- Code blocks in messages rendered with monospace + green text
- Bold text rendering for **emphasis**

### 6. Voice Input (Web Speech API)
- Works in Chrome on Windows (your WSL setup)
- Mic button with red pulse animation when recording
- Transcript auto-sent when speech recognition ends
- Fallback: text input always available

---

## Current File Inventory

```
src/
├── app/
│   ├── layout.tsx              — Dark theme nav, global layout
│   ├── page.tsx                — Dashboard (server component, lists agents + tree)
│   ├── globals.css             — Dark theme vars, animations
│   ├── agents/
│   │   ├── new/page.tsx        — Conversational agent builder page
│   │   └── [id]/page.tsx       — Agent detail with editor
│   ├── chat/
│   │   └── [agentId]/page.tsx  — Chat interface with ACP streaming
│   └── api/
│       ├── agents/
│       │   ├── route.ts        — GET (list) + POST (create)
│       │   ├── [id]/route.ts   — GET + PUT + DELETE
│       │   ├── templates/      — GET pre-built templates
│       │   ├── from-voice/     — POST voice→config parsing
│       │   └── confirm/        — POST confirm voice-created agent
│       ├── chat/
│       │   ├── session/        — POST create ACP session
│       │   └── prompt/         — POST send prompt (SSE streaming)
│       └── voice/
│           ├── transcribe/     — POST audio→text (AWS Transcribe)
│           └── synthesize/     — POST text→audio (AWS Polly)
├── components/
│   ├── conversation-builder.tsx — Main agent creation chat UI
│   ├── agent-card.tsx           — Agent summary card
│   ├── agent-grid.tsx           — Client-side grid with delete
│   ├── agent-tree.tsx           — Hierarchy tree visualization
│   └── agent-config-editor.tsx  — Inline JSON editor
├── hooks/
│   └── use-voice.ts            — Web Speech API hook
├── stores/
│   └── builder-store.ts        — Zustand store for creation flow
├── lib/
│   ├── acp/
│   │   ├── client.ts           — ACP JSON-RPC client
│   │   └── session-manager.ts  — Process pool manager
│   ├── agents/
│   │   ├── schema.ts           — Zod schemas + types
│   │   ├── config-service.ts   — CRUD for .kiro/agents/*.json
│   │   └── templates.ts        — Pre-built agent templates
│   ├── intent/
│   │   └── parser.ts           — Voice transcript → agent config
│   └── voice/                  — (placeholder for Transcribe/Polly utils)
└── types/
    └── speech.d.ts             — Web Speech API type declarations
```

---

## What Can Be Improved

### High Priority

1. **ACP Connection Testing**
   - The ACP client (`src/lib/acp/client.ts`) hasn't been tested with a live `kiro-cli acp` process yet
   - Need to verify: Does `kiro-cli acp` work headlessly on WSL? Does it need a TTY?
   - **Action**: Run `kiro-cli acp` manually and send JSON-RPC via stdin to test

2. **Error Boundaries**
   - No React error boundaries yet — a crash in any component takes down the page
   - Add error boundaries around `ConversationBuilder` and `ChatPage`

3. **Session Cleanup**
   - ACP sessions (child processes) are never cleaned up on page navigation
   - Need: `beforeunload` handler or periodic cleanup in `session-manager.ts`
   - Risk: Process leak if users open many chat sessions

4. **Voice on WSL**
   - Web Speech API runs in the browser (Chrome on Windows), not in WSL
   - This works fine — the browser connects to `localhost:3000` served by WSL
   - But: Chrome must be the browser (Firefox/Safari have limited Speech API support)

### Medium Priority

5. **Bedrock-Powered Intent Parsing**
   - Current `parser.ts` uses keyword matching — works for templates but misses nuance
   - Enhancement: Send transcript to Bedrock Claude via `InvokeModel` for structured extraction
   - This would let users say things like "I need an agent that can deploy to ECS and manage RDS databases" and get accurate tool selection

6. **AWS Transcribe Production Integration**
   - Current: Web Speech API (free, browser-only, Chrome-only)
   - Production: AWS Transcribe Streaming via WebSocket
   - The API route exists (`/api/voice/transcribe`) but needs a WebSocket upgrade for real-time streaming
   - For file-based transcription (upload audio), the current implementation works

7. **Amazon Polly TTS**
   - The API route exists (`/api/voice/synthesize`) and is functional
   - Not yet wired to the UI — need a "speak" button on system messages
   - Consider: Auto-speak confirmations and errors

8. **Auth (NextAuth.js)**
   - No auth yet — anyone with access to the URL can create/delete agents
   - For single-user dev: not critical
   - For multi-user: add NextAuth with GitHub/Google provider

### Low Priority

9. **Agent Versioning**
   - No version history for agent configs
   - Could use git (the project is already a git repo) or store snapshots in the index

10. **Drag-and-Drop Hierarchy**
    - Current tree is read-only
    - Enhancement: drag agents to reparent them

11. **Agent Testing**
    - No way to test an agent config before saving
    - Could add a "dry run" that creates a temporary ACP session

12. **Export/Import**
    - No way to export agent configs or import from another project
    - Simple: download/upload JSON files

---

## Things to Watch Out For

### WSL-Specific Issues

| Issue | Mitigation |
|---|---|
| `kiro-cli` path differs between WSL and Windows | Use `KIRO_CLI_PATH` env var, run `which kiro-cli` in WSL |
| File permissions on `.kiro/agents/` | Ensure WSL user owns the directory |
| Port forwarding | `localhost:3000` in Windows browser should reach WSL dev server automatically |
| Node.js version | Use `nvm use 20` before running — the project was built with v20.14.0 |

### Kiro CLI Gotchas

| Issue | Mitigation |
|---|---|
| Auth session expiry | `kiro-cli auth login` before starting dev server |
| ACP process hangs | Session manager has no timeout yet — add one |
| Multiple ACP processes | `MAX_ACP_SESSIONS=10` env var limits the pool |
| Agent name collisions | Validated at creation time, returns 409 |

### Production Considerations

| Concern | Status |
|---|---|
| Rate limiting | Not implemented — add for public deployment |
| CORS | Next.js handles same-origin by default |
| Input sanitization | Zod validates all API inputs |
| Process isolation | Each ACP session is a separate child process |
| Memory usage | Each `kiro-cli acp` process uses ~50-100MB — monitor with `MAX_ACP_SESSIONS` |

---

## How to Test Right Now

```bash
cd /home/rupeshrk3/voice-agent-studio

# 1. Set up env
cp .env.example .env.local
# Edit: set KIRO_CLI_PATH, AWS creds

# 2. Start dev server
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20
npm run dev

# 3. Open Chrome on Windows: http://localhost:3000

# 4. Test agent creation:
#    - Click "+ New Agent"
#    - Type "DevOps Agent" or click the quick reply
#    - Follow the conversation
#    - Agent JSON will be written to .kiro/agents/

# 5. Test team creation:
#    - Click "+ New Agent"
#    - Type "A team of agents"
#    - Follow the multi-step flow

# 6. Verify agent files:
ls -la .kiro/agents/
cat .kiro/agents/<agent-name>.json

# 7. Test chat (requires kiro-cli to be working):
#    - Click "Chat" on any agent card
#    - This spawns kiro-cli acp — will fail if kiro-cli isn't set up
```

---

## Next Session Priorities

1. Test ACP connection end-to-end with live `kiro-cli`
2. Wire Polly TTS to UI (speak button on system messages)
3. Add Bedrock intent parsing as upgrade to keyword parser
4. Error boundaries + loading states
5. Start planning Phase 2: Bedrock Agent Core export
