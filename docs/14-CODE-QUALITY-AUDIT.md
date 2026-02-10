# Code Quality Audit — Voice Agent Studio

> What Linus Torvalds (and any serious code reviewer) would flag.

---

## Verdict

The codebase is a solid MVP — clean structure, consistent patterns, working features. But it has the hallmarks of rapid prototyping: a 527-line god component, silent error swallowing, no graceful shutdown, race conditions in concurrent operations, and missing input sanitization on security-sensitive paths. Below is everything that needs fixing, ranked by severity.

---

## 1. Critical — Security Issues

### 1.1 No Authentication on Any API Route

Every endpoint (`/api/agents`, `/api/chat/*`, `/api/builder/*`) is completely open. Anyone on the network can:
- Create/delete agents
- Read all chat history
- Spawn kiro-cli processes (which have filesystem + shell access)

The `.env.example` references `NEXTAUTH_SECRET` and `NEXTAUTH_URL`, but no auth middleware exists anywhere.

**Files:** All `src/app/api/*/route.ts`

### 1.2 Path Traversal in Agent Config Service

`config-service.ts` constructs file paths from user-supplied agent names:
```typescript
const configPath = path.join(AGENTS_DIR, `${config.name}.json`);
```
The Zod schema restricts names to `[a-z0-9-]`, which helps — but `updateAgent` merges user input before validation. If validation is bypassed or the regex is loosened, names like `../../etc/passwd` become exploitable.

**File:** `src/lib/agents/config-service.ts` lines 68, 93

### 1.3 No Rate Limiting on Process Spawning

`POST /api/chat/session` spawns a new `kiro-cli acp` child process per request. The pool limit is 10, but there's no per-IP or per-user throttling. An attacker can exhaust the pool and evict legitimate sessions instantly.

**File:** `src/lib/acp/session-manager.ts`

### 1.4 Bearer Token Exposed in `.env.local`

The `.env.local` file contains `AWS_BEARER_TOKEN_BEDROCK` with what appears to be a real token. While `.env.local` is gitignored, this is a risk if the file is ever accidentally committed or the server is compromised. The `converse-bedrock.ts` file also injects this token via a custom middleware that disables SigV4 signing entirely — this bypasses AWS's standard auth chain.

**File:** `src/lib/bedrock/converse-bedrock.ts` lines 22-38

---

## 2. High — Architectural Problems

### 2.1 God Component: `ChatPage` (527 lines)

`src/app/chat/[agentId]/page.tsx` is a single 527-line client component containing:
- Session management logic
- Message state management
- SSE stream parsing
- Delegation handling
- Session recovery/retry
- Voice input handling
- All three column layouts (history, chat, sidebar)

This should be decomposed into:
- `useChatSession` hook (session lifecycle, reconnection)
- `useChatMessages` hook (message state, SSE parsing)
- `ChatHistory` component (left sidebar)
- `ChatMessages` component (center)
- `AgentSidebar` component (right sidebar)
- `ChatInput` component (input bar)

### 2.2 No Graceful Shutdown

When the Next.js server stops (Ctrl+C, deploy, crash), all spawned `kiro-cli acp` child processes become orphans. There's no `process.on('SIGTERM')` or `process.on('SIGINT')` handler calling `sessionManager.destroyAll()`.

On WSL specifically, orphaned processes can accumulate across dev server restarts.

**File:** `src/lib/acp/session-manager.ts`

### 2.3 Race Conditions in Agent Index

`config-service.ts` does `readIndex()` → modify → `writeIndex()` without any locking. Two concurrent `POST /api/agents` requests can both read the same index, each add their agent, and the second write overwrites the first — silently losing an agent.

**File:** `src/lib/agents/config-service.ts` (all write operations)

### 2.4 Duplicate Event Listener Removal

In `prompt/route.ts`, `handleDelegation` calls `client.removeListener("update", onSubUpdate)` twice in a row (lines ~107-109). Copy-paste bug.

```typescript
client.removeListener("update", onSubUpdate);
client.removeListener("update", onSubUpdate);  // duplicate
```

**File:** `src/app/api/chat/prompt/route.ts`

### 2.5 Singleton Builder Session — No Multi-User Support

`builder-provider.ts` uses a module-level singleton (`let activeSession`). If two users hit the builder simultaneously, they share the same ACP session and corrupt each other's conversation history.

**File:** `src/lib/acp/builder-provider.ts`

---

## 3. Medium — Error Handling & Reliability

### 3.1 Silent `catch {}` Blocks Everywhere

At least 12 instances of empty catch blocks across the codebase:
- `client.ts` line 113: `catch { /* skip malformed */ }`
- `config-service.ts` line 73: `catch (e: unknown) { ... }` (swallows non-"already exists" errors)
- `chat/[agentId]/page.tsx`: Multiple `catch { /* ignore */ }`
- `conversation-builder.tsx` line 97: `catch { /* skip malformed */ }`

Linus is famously vocal about this: silent error swallowing makes debugging impossible. At minimum, log to `console.error`.

### 3.2 No Timeout on ACP Operations

`AcpClient.send()` creates a promise that waits indefinitely for a response. If kiro-cli hangs or crashes without closing stdout, the promise never resolves and the HTTP request hangs forever.

**File:** `src/lib/acp/client.ts` `send()` method

### 3.3 SSE Stream Never Aborts on Client Disconnect

In `prompt/route.ts`, if the browser closes the connection mid-stream, the ACP prompt continues running to completion. There's no `AbortSignal` or `request.signal` check. The kiro-cli process keeps working on a response nobody will read.

**File:** `src/app/api/chat/prompt/route.ts`

### 3.4 Database Not Closed on Shutdown

The SQLite connection (`_db`) is opened lazily but never closed. While SQLite handles this gracefully in most cases, WAL mode can leave `-wal` and `-shm` files that grow unbounded if the process crashes repeatedly (common during dev on WSL).

**File:** `src/lib/db/chat-history.ts`

---

## 4. Medium — Code Quality & Maintainability

### 4.1 Type Assertions Instead of Proper Typing

`chat-history.ts` casts all query results through `as Array<Record<string, unknown>>` and then manually maps each field with `as string`. This is fragile — if a column is renamed, TypeScript won't catch it.

Use `better-sqlite3`'s generic `.all<T>()` or define row types.

**File:** `src/lib/db/chat-history.ts` lines 78-88, 130-138

### 4.2 Duplicated Interface Definitions

`ChatSession` is defined in both:
- `src/lib/db/chat-history.ts` (the canonical one)
- `src/components/recent-chats.tsx` (copy-pasted)
- `src/app/chat/[agentId]/page.tsx` as `HistorySession` (yet another copy)

These will drift apart. Export from one place and import everywhere.

### 4.3 Inline Styles and Magic Strings

Tailwind classes are fine, but there are hardcoded color values, spacing, and layout dimensions scattered across components with no design tokens or shared constants:
- `h-[calc(100vh-3.5rem)]` appears in 3 files
- `border-slate-800 bg-slate-950` repeated dozens of times
- `text-[10px]` used as a de facto design token

### 4.4 No TypeScript Strict Null Checks on API Responses

Client-side code accesses API response fields without null checks:
```typescript
const data = await res.json();
setHistory(data.sessions || []);  // what if data is undefined?
```

### 4.5 `eslint-disable` Comments

Multiple `// eslint-disable-line react-hooks/exhaustive-deps` comments in `conversation-builder.tsx` and `chat/[agentId]/page.tsx`. These usually indicate dependency arrays that are intentionally incomplete — which means stale closures and subtle bugs.

### 4.6 Dead Code

- `src/lib/bedrock/converse-bedrock.ts` — the entire file is described as "backup, inactive" in the README. It's imported nowhere.
- `src/lib/voice/` — empty directory.
- `src/components/ui/` — empty directory.
- `buildConfigPrompt()` in `parser.ts` — exported but never called.

---

## 5. Low — Polish & Best Practices

### 5.1 No `.nvmrc` Was Present

Already fixed in this session, but worth noting — the project requires Node 20 but had no `.nvmrc` to enforce it.

### 5.2 No `engines` Field in `package.json`

```json
"engines": { "node": ">=20.0.0" }
```
This would cause `npm install` to warn (or fail with `engine-strict`) on wrong Node versions.

### 5.3 No Health Check Endpoint

No `/api/health` route to verify the server is running, kiro-cli is reachable, and SQLite is accessible. Essential for any deployment (EKS, Docker, etc.) — and the project has an EKS deployment guide.

### 5.4 No Input Length Limits on Chat

`ChatPromptRequestSchema` validates `message: z.string().min(1)` but has no `.max()`. A user can send a 10MB message that gets piped directly to kiro-cli.

### 5.5 Missing `Suspense` Boundaries

The dashboard (`page.tsx`) is an async server component that calls `getRecentChats()` and `listAgents()`. If either is slow, the entire page blocks. Wrapping the `RecentChats` section in `<Suspense>` would allow progressive loading.

### 5.6 No Loading/Error States for Agent Detail Page

`agents/[id]/page.tsx` calls `notFound()` on missing agents but has no loading skeleton or error boundary for network failures.

### 5.7 Accessibility

- Voice button uses emoji `🎤` as its only label — screen readers will read "microphone" but there's no `aria-label`
- Delete buttons use `✕` with no `aria-label`
- No keyboard navigation for the agent hierarchy tree
- No `role` attributes on the chat message list
- Color contrast: `text-slate-600` on `bg-slate-950` fails WCAG AA

### 5.8 No Tests

Zero test files. No unit tests for the config service, schema validation, intent parser, ACP client, or chat history. No integration tests for API routes. No E2E tests.

---

## 6. Summary — Priority Order

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 P0 | Add authentication middleware | Medium |
| 🔴 P0 | Add path traversal protection (resolve + startsWith check) | Small |
| 🔴 P0 | Rate limit session creation | Small |
| 🟠 P1 | Break up ChatPage god component | Large |
| 🟠 P1 | Add graceful shutdown (SIGTERM handler) | Small |
| 🟠 P1 | Add file locking or mutex for agent index writes | Small |
| 🟠 P1 | Add timeouts to ACP client | Small |
| 🟠 P1 | Fix duplicate removeListener call | Trivial |
| 🟠 P1 | Per-user builder sessions | Medium |
| 🟡 P2 | Replace silent catch blocks with logging | Small |
| 🟡 P2 | Handle client disconnect in SSE streams | Small |
| 🟡 P2 | Centralize shared types (ChatSession, etc.) | Small |
| 🟡 P2 | Add proper DB row typing | Small |
| 🟡 P2 | Remove dead code (bedrock backup, empty dirs) | Trivial |
| 🟢 P3 | Add `engines` to package.json | Trivial |
| 🟢 P3 | Add health check endpoint | Small |
| 🟢 P3 | Add message length limits | Trivial |
| 🟢 P3 | Accessibility fixes | Medium |
| 🟢 P3 | Add Suspense boundaries | Small |
| 🟢 P3 | Add tests | Large |

---

*"Talk is cheap. Show me the code." — and the code shows a working product that needs hardening before it faces the real world.*
