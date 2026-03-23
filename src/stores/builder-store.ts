import { create } from "zustand";

export interface BuilderMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/** Extracted agent config from LLM response */
export interface ExtractedConfig {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model: string;
  role?: string;
  // Enhanced fields
  resources?: (string | Record<string, unknown>)[];
  hooks?: Record<string, unknown>;
  allowedTools?: string[];
  welcomeMessage?: string;
}

/** Additional file to create alongside the agent config */
export interface AgentFile {
  path: string;
  content: string;
}

interface BuilderState {
  messages: BuilderMessage[];
  streaming: boolean;
  streamingText: string;
  /** Single agent config extracted from LLM */
  pendingConfig: ExtractedConfig | null;
  /** Team configs extracted from LLM */
  pendingTeam: ExtractedConfig[] | null;
  /** Additional files to create (prompt files, steering, etc.) */
  pendingFiles: AgentFile[];
  createdAgents: Array<{ id: string; name: string }>;

  addMessage: (role: "user" | "assistant", content: string) => void;
  setStreaming: (v: boolean) => void;
  setStreamingText: (v: string) => void;
  appendStreamingText: (chunk: string) => void;
  setPendingConfig: (c: ExtractedConfig | null) => void;
  setPendingTeam: (t: ExtractedConfig[] | null) => void;
  setPendingFiles: (f: AgentFile[]) => void;
  addCreatedAgent: (a: { id: string; name: string }) => void;
  reset: () => void;
}

let counter = 0;
const mkId = () => `msg-${++counter}-${Date.now()}`;

const VALID_TOOLS = new Set(["read", "write", "shell", "aws", "@git", "@fetch"]);
const VALID_MODELS = new Set(["claude-sonnet-4", "claude-sonnet-4.5", "claude-haiku-4.5", "claude-opus-4.5", "auto"]);

function sanitizeConfig(c: ExtractedConfig): ExtractedConfig {
  const sanitized: ExtractedConfig = {
    ...c,
    name: c.name?.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64) || "unnamed-agent",
    description: c.description || "AI agent",
    prompt: c.prompt || `You are ${c.name}.`,
    tools: c.tools?.length ? c.tools.filter((t) => VALID_TOOLS.has(t)) : ["read", "write"],
    model: VALID_MODELS.has(c.model) ? c.model : "claude-sonnet-4",
  };
  // Preserve enhanced fields if present
  if (c.resources?.length) sanitized.resources = c.resources;
  if (c.hooks && Object.keys(c.hooks).length) sanitized.hooks = c.hooks;
  if (c.allowedTools?.length) sanitized.allowedTools = c.allowedTools;
  if (c.welcomeMessage) sanitized.welcomeMessage = c.welcomeMessage;
  return sanitized;
}

/**
 * Parse <agent_config>, <team_config>, and <agent_files> tags from LLM text.
 * Sanitizes extracted configs to only use valid tool/model values.
 */
export function parseConfigFromResponse(text: string): {
  displayText: string;
  config: ExtractedConfig | null;
  team: ExtractedConfig[] | null;
  files: AgentFile[];
} {
  let config: ExtractedConfig | null = null;
  let team: ExtractedConfig[] | null = null;
  let files: AgentFile[] = [];
  let displayText = text;

  const singleMatch = text.match(/<agent_config>([\s\S]*?)<\/agent_config>/);
  if (singleMatch) {
    try {
      config = sanitizeConfig(JSON.parse(singleMatch[1].trim()));
      displayText = text.replace(/<agent_config>[\s\S]*?<\/agent_config>/, "").trim();
    } catch { /* ignore parse errors */ }
  }

  const teamMatch = text.match(/<team_config>([\s\S]*?)<\/team_config>/);
  if (teamMatch) {
    try {
      const raw = JSON.parse(teamMatch[1].trim()) as ExtractedConfig[];
      team = raw.map(sanitizeConfig);
      displayText = text.replace(/<team_config>[\s\S]*?<\/team_config>/, "").trim();
    } catch { /* ignore parse errors */ }
  }

  const filesMatch = text.match(/<agent_files>([\s\S]*?)<\/agent_files>/);
  if (filesMatch) {
    try {
      files = JSON.parse(filesMatch[1].trim()) as AgentFile[];
      displayText = displayText.replace(/<agent_files>[\s\S]*?<\/agent_files>/, "").trim();
    } catch { /* ignore parse errors */ }
  }

  return { displayText, config, team, files };
}

export const useBuilderStore = create<BuilderState>((set) => ({
  messages: [],
  streaming: false,
  streamingText: "",
  pendingConfig: null,
  pendingTeam: null,
  pendingFiles: [],
  createdAgents: [],

  addMessage: (role, content) =>
    set((s) => ({
      messages: [...s.messages, { id: mkId(), role, content, timestamp: Date.now() }],
    })),
  setStreaming: (v) => set({ streaming: v }),
  setStreamingText: (v) => set({ streamingText: v }),
  appendStreamingText: (chunk) => set((s) => ({ streamingText: s.streamingText + chunk })),
  setPendingConfig: (c) => set({ pendingConfig: c }),
  setPendingTeam: (t) => set({ pendingTeam: t }),
  setPendingFiles: (f) => set({ pendingFiles: f }),
  addCreatedAgent: (a) => set((s) => ({ createdAgents: [...s.createdAgents, a] })),
  reset: () =>
    set({
      messages: [],
      streaming: false,
      streamingText: "",
      pendingConfig: null,
      pendingTeam: null,
      pendingFiles: [],
      createdAgents: [],
    }),
}));
