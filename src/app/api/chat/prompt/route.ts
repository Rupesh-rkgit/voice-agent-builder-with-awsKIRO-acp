import { NextRequest } from "next/server";
import { sessionManager } from "@/lib/acp/session-manager";
import { ChatPromptRequestSchema } from "@/lib/agents/schema";
import type { SessionUpdate } from "@/lib/acp/client";
import { saveMessage, updateSessionTitle } from "@/lib/db/chat-history";

/**
 * Detects <delegate to="agent-name">task</delegate> in accumulated text.
 * Returns null if no complete tag found yet.
 */
function parseDelegation(text: string): { agent: string; task: string; before: string } | null {
  const match = text.match(/([\s\S]*?)<delegate\s+to="([^"]+)">([\s\S]*?)<\/delegate>/);
  if (!match) return null;
  return { before: match[1], agent: match[2], task: match[3].trim() };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, message } = ChatPromptRequestSchema.parse(body);

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: { code: "SESSION_NOT_FOUND", message: "Session not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = session.client;
    const orchestratorName = session.agentName;
    const isOrchestrator = orchestratorName.includes("orchestrator");

    // Save user message
    saveMessage(sessionId, "user", message);

    // Auto-generate title from first user message (only if empty)
    updateSessionTitle(sessionId, message.slice(0, 100));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        let fullText = "";
        let pendingDelegation: { agent: string; task: string } | null = null;

        function send(event: SessionUpdate) {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }

        function close() {
          if (closed) return;
          closed = true;
          send({ type: "turn_end" });
          controller.close();
        }

        let sentLength = 0; // Track how much of fullText we've already sent to UI

        function onUpdate(update: SessionUpdate) {
          if (closed) return;
          if (update.type === "text") {
            fullText += update.content;

            if (isOrchestrator && !pendingDelegation) {
              const delegation = parseDelegation(fullText);
              if (delegation) {
                pendingDelegation = { agent: delegation.agent, task: delegation.task };
                if (delegation.before.trim()) {
                  saveMessage(sessionId, "assistant", delegation.before.trim(), orchestratorName);
                }
                return;
              }

              // Check if we're in the middle of a potential <delegate tag
              const delegateStart = fullText.indexOf("<delegate");
              if (delegateStart >= 0) {
                // Send only text up to the <delegate tag start (if not already sent)
                if (delegateStart > sentLength) {
                  send({ type: "text", content: fullText.slice(sentLength, delegateStart) });
                  sentLength = delegateStart;
                }
                // Hold back the rest — it might be a delegation tag
                return;
              }
            }

            if (!pendingDelegation) {
              // Send only the new content we haven't sent yet
              const unsent = fullText.slice(sentLength);
              if (unsent) {
                send({ type: "text", content: unsent });
                sentLength = fullText.length;
              }
            }
          } else {
            send(update);
          }
        }

        async function handleDelegation(agentName: string, task: string) {
          try {
            saveMessage(sessionId, "delegation", task, agentName);
            send({ type: "delegation", agent: agentName, task, status: "start" });

            await client.switchAgent(sessionId, agentName);

            let delegatedText = "";
            const onSubUpdate = (update: SessionUpdate) => {
              if (closed) return;
              if (update.type === "text") {
                delegatedText += update.content;
              }
              send(update);
            };
            client.on("update", onSubUpdate);

            await client.prompt(sessionId, task);

            client.removeListener("update", onSubUpdate);

            if (delegatedText.trim()) {
              saveMessage(sessionId, "assistant", delegatedText, agentName);
            }

            send({ type: "delegation", agent: agentName, task, status: "end" });

            await client.switchAgent(sessionId, orchestratorName);

            close();
          } catch (err) {
            console.error(`[delegation] error:`, err);
            send({ type: "error", message: (err as Error).message });
            try { await client.switchAgent(sessionId, orchestratorName); } catch { /* best effort */ }
            close();
          }
        }

        client.on("update", onUpdate);

        // Send the user's message to the orchestrator and WAIT for it to finish
        client.prompt(sessionId, message)
          .then(() => {
            client.removeListener("update", onUpdate);
            if (pendingDelegation) {
              // Orchestrator finished — now safe to delegate
              handleDelegation(pendingDelegation.agent, pendingDelegation.task);
            } else {
              // No delegation — save full text and close
              if (fullText.trim()) {
                saveMessage(sessionId, "assistant", fullText, orchestratorName);
              }
              close();
            }
          })
          .catch((err) => {
            client.removeListener("update", onUpdate);
            if (!closed) {
              send({ type: "error", message: (err as Error).message });
              close();
            }
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message: (e as Error).message } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
