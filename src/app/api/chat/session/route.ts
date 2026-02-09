import { NextRequest, NextResponse } from "next/server";
import { sessionManager } from "@/lib/acp/session-manager";
import { getAgent, getChildAgents } from "@/lib/agents/config-service";
import { CreateSessionRequestSchema } from "@/lib/agents/schema";
import { createChatSession } from "@/lib/db/chat-history";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agentId } = CreateSessionRequestSchema.parse(body);

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } },
        { status: 404 }
      );
    }

    // Fetch child agents if this is an orchestrator
    const children = await getChildAgents(agentId);

    const { sessionId } = await sessionManager.createSession(agent.config.name);

    // Persist chat session to SQLite
    createChatSession(sessionId, agentId, agent.config.name);

    return NextResponse.json(
      {
        sessionId,
        agentName: agent.config.name,
        description: agent.config.description,
        tools: agent.config.tools,
        model: agent.config.model,
        children: children.map((c) => ({ id: c.id, name: c.name, description: c.description })),
      },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create session";
    const code = msg.includes("kiro-cli") ? "ACP_CONNECTION_FAILED" : "INTERNAL_ERROR";
    return NextResponse.json(
      { error: { code, message: msg } },
      { status: code === "ACP_CONNECTION_FAILED" ? 503 : 500 }
    );
  }
}
