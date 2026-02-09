/**
 * Thin Bedrock Converse API wrapper for the agent builder.
 * Supports both:
 *   - AWS_BEARER_TOKEN_BEDROCK (Bedrock API key / SSO bearer token)
 *   - Standard AWS credentials (ACCESS_KEY_ID + SECRET_ACCESS_KEY)
 */

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-20250514-v1:0";

function createClient(): BedrockRuntimeClient {
  const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

  if (bearerToken) {
    // Use bearer token auth — inject Authorization header via middleware
    const client = new BedrockRuntimeClient({
      region: REGION,
      // Disable default SigV4 signing
      signer: { sign: async (req) => req },
    });

    client.middlewareStack.add(
      (next) => async (args) => {
        const request = (args as { request: { headers: Record<string, string> } }).request;
        if (request?.headers) {
          request.headers["Authorization"] = `Bearer ${bearerToken}`;
          // Remove any SigV4 headers that might have been added
          delete request.headers["x-amz-date"];
          delete request.headers["x-amz-security-token"];
          delete request.headers["x-amz-content-sha256"];
        }
        return next(args);
      },
      { step: "finalizeRequest", name: "bearerTokenAuth", priority: "high" }
    );

    return client;
  }

  // Fall back to standard credential chain (env vars, SSO profile, etc.)
  return new BedrockRuntimeClient({ region: REGION });
}

const client = createClient();

const BUILDER_SYSTEM_PROMPT = `You are the agent creation assistant for Voice Agent Studio. Your job is to have a natural conversation to gather everything needed to create a Kiro CLI agent config.

You need to collect:
1. **name** — lowercase, hyphens, no spaces (e.g. "fullstack-agent"). Suggest one based on their description.
2. **description** — a short summary of what the agent does (1-2 sentences)
3. **prompt** — the system prompt for the agent. YOU write this based on the conversation. Make it detailed and useful.
4. **tools** — which tools the agent should have. Available tools: read, write, shell, aws, @git, @fetch. Default is ["read", "write"]. Suggest based on the agent's purpose.
5. **model** — default "claude-sonnet-4". Options: claude-sonnet-4, claude-sonnet-4.5, claude-haiku-4.5, claude-opus-4.5, auto
6. **standalone or team** — if part of a team, you'll need to create multiple agents

Guidelines:
- Be concise. Ask 1-2 questions at a time, not a wall of text.
- Infer as much as possible. Don't ask obvious things.
- For a "fullstack developer" agent, you already know it needs read, write, shell. Just confirm.
- When you have enough info, output the final config as a JSON block wrapped in <agent_config>...</agent_config> tags and ask for confirmation.
- If the user wants a team, collect info for each member, then output ALL configs wrapped in <team_config>...</team_config> tags as a JSON array.
- Keep responses short and conversational. This is voice-first — people are speaking, not typing essays.

Example single agent output:
<agent_config>
{"name":"fullstack-agent","description":"Full-stack development agent","prompt":"You are a full-stack developer...","tools":["read","write","shell"],"model":"claude-sonnet-4"}
</agent_config>

Example team output:
<team_config>
[
  {"name":"dev-orchestrator","description":"Team orchestrator","prompt":"You coordinate...","tools":["read","write","shell"],"model":"claude-sonnet-4","role":"orchestrator"},
  {"name":"backend-agent","description":"Backend specialist","prompt":"You are a backend...","tools":["read","write","shell"],"model":"claude-sonnet-4","role":"member"}
]
</team_config>`;

export interface BuilderMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Stream a builder conversation turn. Yields text chunks.
 */
export async function* streamBuilderChat(
  history: BuilderMessage[]
): AsyncGenerator<string> {
  const messages: Message[] = history.map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  const system: SystemContentBlock[] = [{ text: BUILDER_SYSTEM_PROMPT }];

  const command = new ConverseStreamCommand({
    modelId: MODEL_ID,
    system,
    messages,
    inferenceConfig: { maxTokens: 1024, temperature: 0.7 },
  });

  const response = await client.send(command);

  if (response.stream) {
    for await (const event of response.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        yield event.contentBlockDelta.delta.text;
      }
    }
  }
}
