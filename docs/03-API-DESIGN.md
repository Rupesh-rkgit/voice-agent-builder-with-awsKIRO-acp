# API Design

## REST API Endpoints

### Agents CRUD

#### `POST /api/agents` — Create Agent
```typescript
// Request
{
  name: string;              // "devops-agent"
  description: string;       // "Handles AWS infrastructure"
  prompt: string;            // System prompt text
  tools: string[];           // ["read", "write", "shell", "aws"]
  allowedTools?: string[];   // ["read", "@git/git_status"]
  mcpServers?: Record<string, { command: string; args: string[] }>;
  model?: string;            // "claude-sonnet-4"
  parentAgentId?: string;    // For multi-level hierarchy
}

// Response 201
{
  id: string;                // UUID
  name: string;
  configPath: string;        // ".kiro/agents/devops-agent.json"
  createdAt: string;
}
```

#### `GET /api/agents` — List Agents
```typescript
// Response 200
{
  agents: Array<{
    id: string;
    name: string;
    description: string;
    tools: string[];
    model: string;
    parentAgentId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

#### `GET /api/agents/:id` — Get Agent Detail
```typescript
// Response 200
{
  id: string;
  name: string;
  description: string;
  config: KiroAgentConfig;   // Full JSON config
  children: AgentSummary[];  // Child agents
  sessions: SessionSummary[];// Recent chat sessions
}
```

#### `PUT /api/agents/:id` — Update Agent
```typescript
// Request: Partial<CreateAgentRequest>
// Response 200: Updated agent
```

#### `DELETE /api/agents/:id` — Delete Agent
```typescript
// Response 204
```

---

### Chat / ACP Sessions

#### `POST /api/chat/session` — Create Chat Session
```typescript
// Request
{
  agentId: string;           // Which agent to use
}

// Response 201
{
  sessionId: string;         // ACP session ID
  agentName: string;
}
```

#### `POST /api/chat/prompt` — Send Prompt (Streaming)
```typescript
// Request
{
  sessionId: string;
  message: string;
}

// Response: ReadableStream (Server-Sent Events)
// data: { type: "text", content: "..." }
// data: { type: "tool_call", name: "read", status: "running" }
// data: { type: "delegation", agent: "agent-name", task: "...", status: "start" }
// data: { type: "text", content: "sub-agent chunk..." }
// data: { type: "delegation", agent: "agent-name", task: "...", status: "end" }
// data: { type: "turn_end" }
//
// Auto-saves: user message, assistant response, delegation, sub-agent response
// Title set from first user message (only if empty)
```

#### `GET /api/chat/history` — Chat History
```typescript
// Query params (one of):
//   ?sessionId=uuid  → get messages for session
//   ?agentId=uuid    → list sessions for agent
//   (none)           → recent chats across all agents

// Response (sessions)
{ sessions: [{ id, agentId, agentName, title, createdAt, updatedAt }] }

// Response (messages)
{ messages: [{ id, sessionId, role, content, agentName, createdAt }] }
```

#### `DELETE /api/chat/history` — Delete Chat Session
```typescript
// Request
{ sessionId: string }

// Response 200
{ ok: true }
```

---

### Voice

#### `POST /api/voice/transcribe` — Speech to Text
```typescript
// Request: multipart/form-data
// - audio: Blob (webm/wav)

// Response 200
{
  transcript: string;
  confidence: number;
}
```

#### `POST /api/voice/synthesize` — Text to Speech
```typescript
// Request
{
  text: string;
  voiceId?: string;          // Polly voice ID, default "Joanna"
}

// Response 200: audio/mpeg binary stream
```

---

### Voice Agent Creation (Compound Endpoint)

#### `POST /api/agents/from-voice` — Voice → Agent Config
```typescript
// Request: multipart/form-data
// - audio: Blob

// Response 200
{
  transcript: string;                // What the user said
  parsedConfig: KiroAgentConfig;     // LLM-generated config
  confidence: number;
  needsConfirmation: true;           // Always true — user must confirm
}
```

#### `POST /api/agents/confirm` — Confirm & Save Voice-Created Agent
```typescript
// Request
{
  config: KiroAgentConfig;           // Possibly user-edited
}

// Response 201: Same as POST /api/agents
```

---

## Shared Types (Zod Schemas)

```typescript
import { z } from 'zod';

export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
});

export const KiroAgentConfigSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1),
  tools: z.array(z.string()).default(["read", "write"]),
  allowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(McpServerSchema).optional(),
  toolAliases: z.record(z.string()).optional(),
  toolsSettings: z.record(z.any()).optional(),
  resources: z.array(z.string()).optional(),
  model: z.string().default("claude-sonnet-4"),
  keyboardShortcut: z.string().optional(),
  welcomeMessage: z.string().optional(),
  hooks: z.any().optional(),
  includeMcpJson: z.boolean().optional(),
});

export type KiroAgentConfig = z.infer<typeof KiroAgentConfigSchema>;

export const CreateAgentRequestSchema = KiroAgentConfigSchema.extend({
  parentAgentId: z.string().uuid().optional(),
});

export const ChatPromptRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});
```

---

## Error Response Format

All errors follow a consistent shape:

```typescript
{
  error: {
    code: string;        // "AGENT_NOT_FOUND", "ACP_CONNECTION_FAILED", etc.
    message: string;     // Human-readable
    details?: unknown;   // Optional debug info (dev only)
  }
}
```

HTTP status codes:
- `400` — Validation error (bad input)
- `404` — Resource not found
- `409` — Conflict (agent name already exists)
- `500` — Internal server error (ACP crash, etc.)
- `503` — Kiro CLI unavailable
