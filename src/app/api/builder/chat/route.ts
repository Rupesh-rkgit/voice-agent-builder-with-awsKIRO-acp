import { NextRequest } from "next/server";
import { streamBuilderPrompt, destroyBuilderSession } from "@/lib/acp/builder-provider";

export async function POST(req: NextRequest) {
  try {
    const { messages, action } = (await req.json()) as {
      messages: Array<{ role: string; content: string }>;
      action?: string;
    };

    // Allow resetting the builder session
    if (action === "reset") {
      await destroyBuilderSession();
      return Response.json({ ok: true });
    }

    if (!messages?.length) {
      return Response.json(
        { error: { code: "BAD_REQUEST", message: "messages required" } },
        { status: 400 }
      );
    }

    // ACP is stateful — only send the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return Response.json(
        { error: { code: "BAD_REQUEST", message: "no user message found" } },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        streamBuilderPrompt(
          lastUserMsg.content,
          (chunk) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          }
        )
          .then(() => {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : "Unknown error";
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
            );
            controller.close();
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
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: (e as Error).message } },
      { status: 500 }
    );
  }
}
