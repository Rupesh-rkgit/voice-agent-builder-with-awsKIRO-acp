/**
 * ACP-based builder provider.
 *
 * Uses kiro-cli ACP as the LLM backend for the agent creation conversation.
 * We maintain a single long-lived ACP session for the builder, and prepend
 * the builder system prompt as context in the first message.
 *
 * Since ACP is stateful (it remembers conversation history), we only send
 * the latest user message — not the full history.
 */

import { AcpClient, type SessionUpdate } from "@/lib/acp/client";

const WORKSPACE_DIR = process.env.KIRO_WORKSPACE_DIR || process.cwd();

const VALID_TOOLS = ["read", "write", "shell", "aws", "@git", "@fetch"];
const VALID_MODELS = ["claude-sonnet-4", "claude-sonnet-4.5", "claude-haiku-4.5", "claude-opus-4.5", "auto"];

const BUILDER_SYSTEM_PROMPT = `You are the agent creation assistant for Voice Agent Studio. Have a natural conversation to gather what's needed for a Kiro CLI agent config.

Collect:
1. **name** — lowercase, hyphens only (e.g. "fullstack-agent")
2. **description** — 1-2 sentence summary
3. **prompt** — YOU write a detailed system prompt based on the conversation
4. **tools** — ONLY these are valid: ${VALID_TOOLS.join(", ")}. Default: ["read", "write"]. Suggest based on purpose.
5. **model** — ONLY these are valid: ${VALID_MODELS.join(", ")}. Default: "claude-sonnet-4"
6. **standalone or team**

Rules:
- Be concise. 1-2 questions at a time. Voice-first UX.
- Infer what you can. Don't ask obvious things.
- ONLY use tools from the valid list above. No others exist.
- ONLY use model IDs from the valid list above. Never use Bedrock model IDs.
- When ready, output JSON in <agent_config>...</agent_config> tags.
- For teams, output JSON array in <team_config>...</team_config> tags.

Single agent example:
<agent_config>
{"name":"fullstack-agent","description":"Full-stack development agent","prompt":"You are a full-stack developer...","tools":["read","write","shell"],"model":"claude-sonnet-4"}
</agent_config>

Team example:
<team_config>
[
  {"name":"dev-orchestrator","description":"Team orchestrator","prompt":"You coordinate...","tools":["read","write","shell"],"model":"claude-sonnet-4","role":"orchestrator"},
  {"name":"backend-agent","description":"Backend specialist","prompt":"You are a backend...","tools":["read","write","shell"],"model":"claude-sonnet-4","role":"member"}
]
</team_config>

Start by greeting the user and asking what kind of agent they want.`;

interface BuilderSession {
  client: AcpClient;
  sessionId: string;
  turnCount: number;
}

// One builder session at a time (singleton per server process)
let activeSession: BuilderSession | null = null;

async function getOrCreateSession(): Promise<BuilderSession> {
  if (activeSession) return activeSession;

  const client = new AcpClient();
  await client.connect({ cwd: WORKSPACE_DIR });
  const sessionId = await client.createSession(WORKSPACE_DIR);

  activeSession = { client, sessionId, turnCount: 0 };

  client.on("exit", () => {
    activeSession = null;
  });

  return activeSession;
}

export async function destroyBuilderSession(): Promise<void> {
  if (activeSession) {
    activeSession.client.disconnect();
    activeSession = null;
  }
}

/**
 * Send a message to the builder and stream back text chunks via callback.
 * On the first turn, prepends the system prompt as context.
 */
export async function streamBuilderPrompt(
  userMessage: string,
  onChunk: (text: string) => void
): Promise<void> {
  const session = await getOrCreateSession();

  // First turn: prepend system prompt
  let prompt = userMessage;
  if (session.turnCount === 0) {
    prompt = `${BUILDER_SYSTEM_PROMPT}\n\n---\n\nUser's first message: ${userMessage}`;
  }
  session.turnCount++;

  return new Promise<void>((resolve, reject) => {
    const onUpdate = (update: SessionUpdate) => {
      if (update.type === "text") {
        onChunk(update.content);
      }
    };

    session.client.on("update", onUpdate);

    session.client
      .prompt(session.sessionId, prompt)
      .then(() => {
        session.client.removeListener("update", onUpdate);
        resolve();
      })
      .catch((err) => {
        session.client.removeListener("update", onUpdate);
        reject(err);
      });
  });
}
