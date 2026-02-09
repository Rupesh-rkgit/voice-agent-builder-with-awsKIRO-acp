/**
 * Intent Parser: Takes a natural language description and produces
 * a KiroAgentConfig using an LLM (via Kiro ACP or Bedrock).
 *
 * For MVP, we use a structured prompt + simple keyword extraction.
 * In production, this would call Bedrock or use a dedicated Kiro session.
 */

import { type KiroAgentConfig, KiroAgentConfigSchema } from "@/lib/agents/schema";
import { AGENT_TEMPLATES } from "@/lib/agents/templates";

const KNOWN_TOOLS = [
  "read", "write", "shell", "aws", "code", "knowledge",
  "@git", "@fetch", "@builtin",
];

const TOOL_KEYWORDS: Record<string, string[]> = {
  aws: ["aws", "amazon", "s3", "lambda", "ec2", "dynamodb", "cloudformation", "terraform", "infrastructure", "devops"],
  shell: ["shell", "bash", "terminal", "command", "script", "deploy", "docker", "kubernetes"],
  "@git": ["git", "github", "version control", "commit", "repository"],
  "@fetch": ["fetch", "http", "api", "web", "url", "download"],
  code: ["code", "lsp", "refactor", "analyze"],
  knowledge: ["docs", "documentation", "knowledge", "search"],
};

export function parseVoiceToAgentConfig(transcript: string): KiroAgentConfig {
  const lower = transcript.toLowerCase();

  // Try to match a template first
  for (const [key, template] of Object.entries(AGENT_TEMPLATES)) {
    if (lower.includes(key) || lower.includes(template.name.replace("-agent", ""))) {
      return KiroAgentConfigSchema.parse({
        ...template,
        name: template.name,
      });
    }
  }

  // Extract agent name from transcript
  const nameMatch = lower.match(
    /(?:create|build|make|set up|setup)\s+(?:a|an)?\s*(.+?)\s+agent/
  );
  const rawName = nameMatch?.[1] || "custom";
  const name = rawName
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);

  // Extract tools based on keywords
  const tools = new Set<string>(["read", "write"]);
  for (const [tool, keywords] of Object.entries(TOOL_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      tools.add(tool);
    }
  }

  // Build a description from the transcript
  const description = transcript.length > 500
    ? transcript.slice(0, 497) + "..."
    : transcript;

  // Build a system prompt
  const prompt = `You are a specialized AI agent created from the following description: "${transcript}". Follow the user's instructions precisely and use your available tools effectively.`;

  return KiroAgentConfigSchema.parse({
    name: `${name}-agent`,
    description,
    prompt,
    tools: Array.from(tools),
    model: "claude-sonnet-4",
  });
}

/**
 * Enhanced parser that uses an LLM (via ACP) to generate the config.
 * Call this when you have an active ACP session available.
 */
export function buildConfigPrompt(transcript: string): string {
  return `Parse the following voice command into a Kiro agent JSON configuration.

Voice command: "${transcript}"

Return ONLY valid JSON matching this schema:
{
  "name": "lowercase-hyphenated-name",
  "description": "Brief description",
  "prompt": "System prompt for the agent",
  "tools": ["read", "write", ...],
  "model": "claude-sonnet-4"
}

Available tools: ${KNOWN_TOOLS.join(", ")}
Available MCP server prefixes: @git, @fetch

Respond with ONLY the JSON, no markdown fences or explanation.`;
}
