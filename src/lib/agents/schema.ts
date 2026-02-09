import { z } from "zod";

// --- MCP Server Config ---
export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
});

// --- Kiro Agent Config (matches .kiro/agents/*.json format) ---
export const KiroAgentConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1),
  tools: z.array(z.string()).default(["read", "write"]),
  allowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  toolAliases: z.record(z.string(), z.string()).optional(),
  toolsSettings: z.record(z.string(), z.any()).optional(),
  resources: z.array(z.any()).optional(),
  model: z.string().default("claude-sonnet-4"),
  keyboardShortcut: z.string().optional(),
  welcomeMessage: z.string().optional(),
  hooks: z.any().optional(),
  includeMcpJson: z.boolean().optional(),
});

export type KiroAgentConfig = z.infer<typeof KiroAgentConfigSchema>;

// --- API Request/Response Types ---
export const CreateAgentRequestSchema = KiroAgentConfigSchema.extend({
  parentAgentId: z.string().uuid().nullable().optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const UpdateAgentRequestSchema = KiroAgentConfigSchema.partial();
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;

export const ChatPromptRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});
export type ChatPromptRequest = z.infer<typeof ChatPromptRequestSchema>;

export const CreateSessionRequestSchema = z.object({
  agentId: z.string().min(1),
});

// --- Agent metadata ---
export interface AgentMeta {
  id: string;
  name: string;
  description: string;
  configPath: string;
  parentAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- ACP Types ---
export interface AcpSession {
  sessionId: string;
  agentName: string;
  processId: number;
}

// --- API Error ---
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
