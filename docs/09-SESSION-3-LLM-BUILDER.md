# Session 3 — LLM-Powered Agent Builder

## Date: 2026-02-09

---

## What Changed

### Bug Fix: Agent Creation "expected string, received null"
- **Root cause**: `parentAgentId: null` in the draft was sent to Zod schema that only accepted `string | undefined`
- **Fix**: Changed `CreateAgentRequestSchema.parentAgentId` to `z.string().uuid().nullable().optional()`

### LLM-Powered Conversation Builder (Major Rewrite)
Replaced the rigid keyword-based step machine with an LLM-powered conversational flow.

**Old flow**: Hardcoded steps (greeting → collect-type → collect-name → collect-tools → confirm) with keyword matching. Couldn't handle natural language, typos, or unexpected inputs.

**New flow**: User speaks/types anything → sent to LLM via ACP (kiro-cli) → LLM asks clarifying questions naturally → when it has enough context, outputs structured config in `<agent_config>` tags → frontend shows config card with Create/Edit buttons.

### LLM Backend: ACP (kiro-cli) — Primary
The builder uses kiro-cli ACP as the LLM backend. This reuses the same auth that kiro-cli already has (IAM Identity Center SSO). No separate Bedrock credentials needed.

- `src/lib/acp/builder-provider.ts` — Manages a dedicated ACP session for the builder. Injects system prompt on first turn. ACP is stateful so only the latest user message is sent on subsequent turns.
- `src/app/api/builder/chat/route.ts` — SSE streaming endpoint using ACP provider

### LLM Backend: Bedrock — Preserved for Later
Direct Bedrock Converse Stream API code preserved at `src/lib/bedrock/converse-bedrock.ts`. Supports both:
- `AWS_BEARER_TOKEN_BEDROCK` (bearer token / API key auth)
- Standard `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

Currently blocked by SCP deny on `bedrock:InvokeModel*` for the current AWS account. Can be swapped in later by changing the import in the route.

### Config Sanitization
LLM sometimes outputs invalid tool names (e.g. `ls`, `grep`, `glob`) or Bedrock model IDs. Added `sanitizeConfig()` in the builder store that:
- Filters tools to only valid Kiro tools: read, write, shell, aws, @git, @fetch
- Maps model to valid Kiro models: claude-sonnet-4, claude-sonnet-4.5, etc.
- Normalizes agent name format

### New Files
| File | Purpose |
|---|---|
| `src/lib/acp/builder-provider.ts` | ACP-based builder session manager with system prompt injection |
| `src/lib/bedrock/converse-bedrock.ts` | Bedrock Converse Stream wrapper (preserved for later) |

### Rewritten Files
| File | What Changed |
|---|---|
| `src/stores/builder-store.ts` | Simple message history + config extraction + sanitization |
| `src/components/conversation-builder.tsx` | LLM-driven chat with streaming, auto-listen, config cards |
| `src/app/api/builder/chat/route.ts` | Routes to ACP provider, supports session reset |
| `src/lib/agents/schema.ts` | `parentAgentId` now nullable |

### Voice UX Improvements
- **Auto-listen**: After each assistant message, mic automatically starts listening (800ms delay)
- **Listening indicator**: Red pulsing dot with "Listening... speak now" text
- **No more manual mic clicks**: Voice-first flow — just speak naturally

### Architecture
```
User speaks → Web Speech API → text
  → POST /api/builder/chat (SSE)
    → ACP builder-provider → kiro-cli acp process
    → Streaming text chunks back to browser
  → Parse <agent_config> tags from response
  → Sanitize tools/model to valid Kiro values
  → Show config card → User confirms
  → POST /api/agents → Create .kiro/agents/*.json
```

### Team Support
LLM can output `<team_config>` with array of configs. First entry = orchestrator, rest = members with `parentAgentId` linking.

---

## Environment Requirements
No additional credentials needed — the builder uses kiro-cli ACP which is already authenticated via IAM Identity Center.

To switch to direct Bedrock later, add to `.env.local`:
```
AWS_BEARER_TOKEN_BEDROCK=your-token
# or
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```
Then change the import in `src/app/api/builder/chat/route.ts` from `builder-provider` to `converse-bedrock`.

---

## Build Status
- `npx tsc --noEmit` → ✅ 0 errors
- `npm run build` → ✅ 15 routes, clean
- Agent creation bug → ✅ Fixed
- LLM builder via ACP → ✅ Verified end-to-end (multi-turn conversation works)
- Config sanitization → ✅ Invalid tools/models filtered

---

## Verified ACP Builder Test
```
Turn 1: "I want a fullstack developer agent"
→ "Hey! I can help you create a fullstack developer agent. What tech stack?..."

Turn 2: "React and Node.js, mainly building new features. Call it fullstack-agent."
→ <agent_config>{"name":"fullstack-agent",...}</agent_config>
→ Config card shown with Create/Edit buttons
```

---

## What's Next
1. Add AWS credentials to `.env.local` and test the LLM builder
2. Add TTS (Polly) to speak assistant responses
3. Wire up the chat page with the fixed ACP client
4. Error boundaries and loading states
5. Test team creation flow end-to-end
