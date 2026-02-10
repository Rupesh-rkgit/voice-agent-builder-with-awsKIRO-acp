import { sessionManager } from "@/lib/acp/session-manager";
import { getRecentChats } from "@/lib/db/chat-history";

export async function GET() {
  const checks: Record<string, string> = {};

  // SQLite check
  try {
    getRecentChats(1);
    checks.database = "ok";
  } catch (e) {
    checks.database = `error: ${(e as Error).message}`;
  }

  // Session pool check
  try {
    const sessions = sessionManager.getActiveSessions();
    checks.sessions = `${sessions.length} active`;
  } catch (e) {
    checks.sessions = `error: ${(e as Error).message}`;
  }

  const healthy = checks.database === "ok";
  return Response.json(
    { status: healthy ? "healthy" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
