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
// event: message
// data: { type: "text", content: "..." }
//
// event: tool_call
// data: { type: "tool_call", name: "read", status: "running" }
//
// event: turn_end
// data: { type: "turn_end" }
```

#### `DELETE /api/chat/session/:id` — End Session
```typescript
// Response 204 (kills the kiro-cli acp process)
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
