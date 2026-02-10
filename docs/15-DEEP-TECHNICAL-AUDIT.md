# Voice Agent Studio — Deep Technical Audit

> Production-readiness assessment focusing on ACP integration, session management, tool execution, and architectural patterns.

---

## Executive Summary

The codebase demonstrates a working multi-agent orchestration system built on Kiro CLI's ACP protocol. However, it has significant gaps in concurrency handling, error recovery, resource management, and separation of concerns that would cause issues at scale. This document provides a roadmap to production-grade quality.

---

## Part 1: ACP Client Architecture

### Current State

The `AcpClient` class (`src/lib/acp/client.ts`) is a JSON-RPC 2.0 client that spawns `kiro-cli acp` as a child process and communicates via stdin/stdout.

### Critical Issues

#### 1.1 No Request Timeouts

```typescript
// Current: Promise waits forever
private async send(method: string, params?: unknown): Promise<unknown> {
  const id = ++this.requestId;
  return new Promise((resolve, reject) => {
    this.pending.set(id, { resolve, reject });
    // ... no timeout
  });
}
```

**Impact:** If kiro-cli hangs or crashes without closing stdout, the promise never resolves. The HTTP request hangs indefinitely, consuming server resources.

**Fix:**
```typescript
private async send(method: string, params?: unknown, timeoutMs = 120000): Promise<unknown> {
  const id = ++this.requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    this.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    // ...
  });
}
```

#### 1.2 No Backpressure on stdin Writes

```typescript
this.process!.stdin!.write(msg);  // Fire and forget
```

**Impact:** If kiro-cli's stdin buffer fills up (large prompts, rapid requests), writes silently fail or block the event loop.

**Fix:**
```typescript
private writeToProcess(data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = this.process!.stdin!.write(data);
    if (ok) {
      resolve();
    } else {
      this.process!.stdin!.once('drain', resolve);
    }
  });
}
```

#### 1.3 Tool Execution Security

The `handleRequest` method executes filesystem and shell operations without sandboxing:

```typescript
case "terminal/execute": {
  exec(command, { cwd, timeout: 60000, maxBuffer: 5MB }, ...);
}
case "fs/writeTextFile": {
  fs.writeFileSync(filePath, content);
}
```

**Risks:**
- Path traversal: `../../etc/passwd` could be written
- Command injection: Shell metacharacters in command strings
- Resource exhaustion: No limits on file sizes or command output

**Fix:**
```typescript
// Path validation
function validatePath(filePath: string, allowedRoot: string): string {
  const resolved = path.resolve(allowedRoot, filePath);
  if (!resolved.startsWith(path.resolve(allowedRoot))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

// Command sanitization (or better: use execFile with args array)
case "terminal/execute": {
  // Reject shell metacharacters or use execFile
  if (/[;&|`$]/.test(command)) {
    respondError(-32600, "Shell metacharacters not allowed");
    return;
  }
}
```

#### 1.4 Missing Reconnection Logic

If kiro-cli crashes mid-conversation, the session is lost with no recovery:

```typescript
this.process.on("exit", (code) => {
  this.emit("exit", code);
  this.rejectAllPending(new Error(`kiro-cli exited with code ${code}`));
});
```

**Fix:** Implement exponential backoff reconnection:
```typescript
private async reconnect(maxAttempts = 3): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await this.connect(this.lastConnectOpts);
      return;
    } catch (e) {
      await sleep(Math.pow(2, i) * 1000);
    }
  }
  throw new Error('Failed to reconnect after ' + maxAttempts + ' attempts');
}
```

---

## Part 2: Session Management

### Current State

`AcpSessionManager` maintains an in-memory Map of active sessions with LRU eviction.

### Critical Issues

#### 2.1 Sessions Lost on Server Restart

```typescript
// Singleton in module scope — lost on hot reload or restart
export const sessionManager = new AcpSessionManager();
```

**Impact:** Every dev server restart or production deployment loses all active sessions. Users get "Session not found" errors.

**Fix Options:**

1. **Session Persistence:** Store session metadata in SQLite, reconnect on demand
2. **Sticky Sessions:** Use Redis for session state in multi-instance deployments
3. **Stateless Design:** Don't rely on long-lived ACP sessions; create per-request

```typescript
// Option 1: Lazy reconnection
async getOrRecreateSession(sessionId: string): Promise<ManagedSession> {
  let session = this.sessions.get(sessionId);
  if (!session) {
    const meta = await db.getSessionMeta(sessionId);
    if (meta) {
      session = await this.recreateSession(meta.agentName, sessionId);
    }
  }
  return session;
}
```

#### 2.2 No Concurrent Request Protection

Multiple simultaneous prompts to the same session cause race conditions:

```typescript
// User sends two messages quickly
await client.prompt(sessionId, "message 1");  // Still running
await client.prompt(sessionId, "message 2");  // Interleaves!
```

**Fix:** Add per-session mutex:
```typescript
interface ManagedSession {
  // ...
  promptLock: Promise<void>;
}

async prompt(sessionId: string, text: string): Promise<void> {
  const session = this.getSession(sessionId);
  await session.promptLock;  // Wait for previous prompt
  session.promptLock = this.doPrompt(sessionId, text);
  return session.promptLock;
}
```

#### 2.3 Memory Leak on Eviction

```typescript
private evictOldest(): void {
  oldest.client.disconnect();
  this.sessions.delete(oldest.sessionId);
  // But: event listeners on client are never removed
  // And: pending promises are rejected but callers may still hold references
}
```

**Fix:** Proper cleanup:
```typescript
private evictOldest(): void {
  if (oldest) {
    oldest.client.removeAllListeners();
    oldest.client.disconnect();
    this.sessions.delete(oldest.sessionId);
  }
}
```

#### 2.4 No Health Checks

No way to detect zombie sessions (kiro-cli process alive but unresponsive):

**Fix:**
```typescript
async healthCheck(sessionId: string): Promise<boolean> {
  try {
    await this.send("ping", {}, 5000);  // 5s timeout
    return true;
  } catch {
    return false;
  }
}

// Periodic cleanup
setInterval(() => {
  for (const [id, session] of this.sessions) {
    if (!await this.healthCheck(id)) {
      this.destroySession(id);
    }
  }
}, 60000);
```

---

## Part 3: Multi-Agent Delegation

### Current State

Orchestrators delegate via `<delegate to="agent-name">task</delegate>` tags parsed from streamed text.

### Critical Issues

#### 3.1 Fragile Tag Detection

```typescript
const delegateStart = fullText.indexOf("<delegate");
if (delegateStart >= 0) {
  // Hold back all text after this point
}
```

**Problems:**
- False positives: Code blocks containing `<delegate` trigger detection
- Partial matches: `<delegation>` or `<delegated>` would match
- No escape mechanism: Can't discuss delegation syntax with the agent

**Fix:** Use a more robust detection:
```typescript
// Only match complete, well-formed tags
const DELEGATE_REGEX = /<delegate\s+to="([^"]+)">([\s\S]*?)<\/delegate>/;

// Or: Use a unique delimiter unlikely to appear in content
const DELEGATE_START = "<<<DELEGATE:";
const DELEGATE_END = ">>>";
```

#### 3.2 Single Delegation Only

Current code handles exactly one delegation per turn:

```typescript
if (pendingDelegation) {
  handleDelegation(pendingDelegation.agent, pendingDelegation.task);
} else {
  close();
}
```

**Impact:** Orchestrators can't delegate to multiple sub-agents in sequence.

**Fix:**
```typescript
// Parse all delegations
const delegations = parseAllDelegations(fullText);
for (const d of delegations) {
  await handleDelegation(d.agent, d.task);
}
```

#### 3.3 No Delegation Depth Limit

An orchestrator could delegate to another orchestrator, which delegates again, etc.

**Fix:**
```typescript
async function handleDelegation(agent: string, task: string, depth = 0) {
  if (depth > 3) {
    send({ type: "error", message: "Maximum delegation depth exceeded" });
    return;
  }
  // ... pass depth + 1 to recursive calls
}
```

#### 3.4 Lost Context on Delegation

When delegating, only the task is sent — not the conversation context:

```typescript
await client.prompt(sessionId, task);  // Just the task, no history
```

**Impact:** Sub-agents lack context from the user's original request.

**Fix:** Include relevant context:
```typescript
const contextualPrompt = `
Context from orchestrator: ${orchestratorSummary}
User's original request: ${originalMessage}

Your task: ${task}
`;
await client.prompt(sessionId, contextualPrompt);
```

---

## Part 4: Tool Execution Flow

### Current Architecture

```
User → API Route → AcpClient → kiro-cli → Claude
                      ↑
                      └── fs/terminal requests ←─┘
```

### Issues

#### 4.1 Synchronous File Operations Block Event Loop

```typescript
case "fs/readTextFile": {
  const content = fs.readFileSync(filePath, "utf-8");  // BLOCKING
}
```

**Impact:** Large file reads block all other requests.

**Fix:** Use async operations:
```typescript
case "fs/readTextFile": {
  fs.readFile(filePath, "utf-8", (err, content) => {
    if (err) respondError(-32000, err.message);
    else respond({ content });
  });
  return;  // Don't fall through
}
```

#### 4.2 No Tool Call Visibility in UI

Tool calls are emitted but not persisted:

```typescript
case "tool_use": {
  event = { type: "tool_call", name, status, args };
  this.emit("update", event);  // Sent to UI
  // But NOT saved to chat_messages
}
```

**Impact:** Resumed sessions don't show what tools were used.

**Fix:** Save tool calls to a separate table or as structured JSON in messages.

#### 4.3 Terminal Commands Run as Server User

```typescript
exec(command, { cwd, timeout: 60000 }, callback);
```

**Impact:** Commands run with the Next.js server's permissions — potentially root in some deployments.

**Fix:** 
- Run in a sandboxed container
- Use a restricted user
- Whitelist allowed commands
- Implement command approval flow

---

## Part 5: Frontend Architecture

### Current State

`ChatPage` is a 527-line monolithic component handling:
- Session lifecycle
- Message state
- SSE stream parsing
- Delegation UI
- Voice input
- Three-column layout

### Refactoring Plan

```
src/
├── components/
│   └── chat/
│       ├── ChatPage.tsx           # Layout shell only
│       ├── ChatMessages.tsx       # Message list
│       ├── ChatInput.tsx          # Input bar + voice
│       ├── ChatHistory.tsx        # Left sidebar
│       ├── AgentSidebar.tsx       # Right sidebar
│       └── DelegationBanner.tsx   # Delegation indicator
├── hooks/
│   ├── useChatSession.ts          # Session lifecycle
│   ├── useChatMessages.ts         # Message state + SSE
│   └── useChatStream.ts           # SSE parsing logic
└── stores/
    └── chat-store.ts              # Zustand store for chat state
```

### Key Improvements

#### 5.1 Extract SSE Parsing

```typescript
// hooks/useChatStream.ts
export function useChatStream(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  const sendMessage = useCallback(async (text: string) => {
    const response = await fetch('/api/chat/prompt', { ... });
    const reader = response.body.getReader();
    
    for await (const event of parseSSEStream(reader)) {
      switch (event.type) {
        case 'text':
          appendToLastMessage(event.content);
          break;
        case 'delegation':
          handleDelegation(event);
          break;
        // ...
      }
    }
  }, [sessionId]);
  
  return { messages, sendMessage };
}
```

#### 5.2 Optimistic Updates with Rollback

```typescript
// Current: Wait for server
setMessages(prev => [...prev, userMsg]);
await fetch('/api/chat/prompt', ...);

// Better: Optimistic with rollback
const optimisticId = addOptimisticMessage(userMsg);
try {
  await sendToServer(userMsg);
} catch {
  rollbackMessage(optimisticId);
  showError("Failed to send message");
}
```

#### 5.3 Virtual Scrolling for Long Chats

Current implementation renders all messages, causing performance issues with long histories.

```typescript
// Use react-window or similar
import { VariableSizeList } from 'react-window';

<VariableSizeList
  height={containerHeight}
  itemCount={messages.length}
  itemSize={getMessageHeight}
>
  {({ index, style }) => (
    <ChatMessage message={messages[index]} style={style} />
  )}
</VariableSizeList>
```

---

## Part 6: Database Layer

### Current Issues

#### 6.1 No Connection Pooling

```typescript
let _db: Database.Database | null = null;
function getDb() {
  if (!_db) _db = new Database(DB_PATH);
  return _db;
}
```

Single connection shared across all requests — fine for SQLite, but no error recovery.

#### 6.2 No Migrations System

Schema changes require manual intervention:

```typescript
_db.exec(`CREATE TABLE IF NOT EXISTS ...`);
```

**Fix:** Use a migration system:
```typescript
// migrations/001_initial.sql
// migrations/002_add_tool_calls.sql

async function runMigrations() {
  const applied = db.prepare('SELECT name FROM migrations').all();
  for (const file of getMigrationFiles()) {
    if (!applied.includes(file)) {
      db.exec(readFile(file));
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    }
  }
}
```

#### 6.3 No Query Optimization

```typescript
// N+1 query pattern
const sessions = listChatSessions();
for (const s of sessions) {
  s.messages = getSessionMessages(s.id);  // Query per session!
}
```

**Fix:** Use JOINs or batch queries.

---

## Part 7: Error Handling Patterns

### Current Anti-Patterns

```typescript
// Silent swallowing
catch { /* ignore */ }

// Generic errors
catch (e) {
  return { error: { code: "INTERNAL_ERROR", message: e.message } };
}

// No error boundaries
// No retry logic
// No circuit breakers
```

### Recommended Patterns

```typescript
// 1. Typed errors
class AcpConnectionError extends Error {
  code = 'ACP_CONNECTION_FAILED';
  retryable = true;
}

// 2. Error boundaries in React
<ErrorBoundary fallback={<ChatErrorState />}>
  <ChatMessages />
</ErrorBoundary>

// 3. Retry with backoff
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!e.retryable || i === maxAttempts - 1) throw e;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}

// 4. Circuit breaker for ACP
const acpCircuit = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
});
```

---

## Part 8: Observability

### Missing Components

1. **Structured Logging**
```typescript
// Current
console.error("[kiro-acp stderr]", chunk);

// Better
logger.error({
  component: 'acp-client',
  event: 'stderr',
  sessionId,
  content: chunk,
  timestamp: Date.now(),
});
```

2. **Metrics**
```typescript
// Track key metrics
metrics.increment('acp.sessions.created');
metrics.timing('acp.prompt.duration', duration);
metrics.gauge('acp.sessions.active', sessionManager.size);
```

3. **Distributed Tracing**
```typescript
// Trace requests through the system
const span = tracer.startSpan('chat.prompt');
span.setTag('sessionId', sessionId);
span.setTag('agentName', agentName);
// ... 
span.finish();
```

---

## Part 9: Testing Strategy

### Current State

Zero tests.

### Recommended Test Structure

```
tests/
├── unit/
│   ├── acp-client.test.ts         # Mock kiro-cli process
│   ├── session-manager.test.ts    # Session lifecycle
│   ├── delegation-parser.test.ts  # Tag parsing edge cases
│   └── chat-history.test.ts       # DB operations
├── integration/
│   ├── chat-flow.test.ts          # Full chat round-trip
│   ├── delegation-flow.test.ts    # Multi-agent delegation
│   └── session-recovery.test.ts   # Reconnection scenarios
└── e2e/
    ├── chat.spec.ts               # Playwright browser tests
    └── voice-input.spec.ts        # Voice interaction tests
```

### Critical Test Cases

```typescript
// ACP Client
describe('AcpClient', () => {
  it('times out on unresponsive kiro-cli');
  it('handles partial JSON in buffer');
  it('reconnects after process crash');
  it('rejects pending promises on disconnect');
});

// Delegation
describe('Delegation', () => {
  it('parses delegation tags correctly');
  it('ignores delegation-like text in code blocks');
  it('handles multiple sequential delegations');
  it('enforces maximum delegation depth');
  it('recovers from sub-agent errors');
});

// Session Management
describe('SessionManager', () => {
  it('evicts oldest session at capacity');
  it('updates lastActivity on access');
  it('cleans up resources on eviction');
  it('handles concurrent session creation');
});
```

---

## Part 10: Priority Roadmap

### Phase 1: Stability (Week 1)
- [ ] Add request timeouts to ACP client
- [ ] Implement per-session prompt mutex
- [ ] Add path validation for file operations
- [ ] Fix memory leaks on session eviction

### Phase 2: Reliability (Week 2)
- [ ] Session persistence and recovery
- [ ] Retry logic with exponential backoff
- [ ] Circuit breaker for ACP connections
- [ ] Health check endpoint

### Phase 3: Scalability (Week 3)
- [ ] Async file operations
- [ ] Virtual scrolling for chat history
- [ ] Database migrations system
- [ ] Connection pooling (if moving to Postgres)

### Phase 4: Observability (Week 4)
- [ ] Structured logging
- [ ] Metrics collection
- [ ] Error tracking (Sentry or similar)
- [ ] Performance monitoring

### Phase 5: Quality (Ongoing)
- [ ] Unit test coverage > 80%
- [ ] Integration tests for critical paths
- [ ] E2E tests for user flows
- [ ] Load testing for concurrent users

---

*"Premature optimization is the root of all evil, but premature production deployment is worse."*
