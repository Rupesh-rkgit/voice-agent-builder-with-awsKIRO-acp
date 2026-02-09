import { NextRequest } from "next/server";
import {
  listChatSessions,
  getSessionMessages,
  deleteChatSession,
  getRecentChats,
} from "@/lib/db/chat-history";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const agentId = searchParams.get("agentId");

  // Get messages for a specific session
  if (sessionId) {
    const messages = getSessionMessages(sessionId);
    return Response.json({ messages });
  }

  // List sessions (optionally filtered by agent)
  const sessions = agentId ? listChatSessions(agentId) : getRecentChats(30);
  return Response.json({ sessions });
}

export async function DELETE(req: NextRequest) {
  const { sessionId } = await req.json();
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  deleteChatSession(sessionId);
  return Response.json({ ok: true });
}
