/**
 * Manages a pool of ACP client sessions.
 * Each user/chat session gets its own kiro-cli acp process.
 */

import { AcpClient, type SessionUpdate } from "./client";

const WORKSPACE_DIR = process.env.KIRO_WORKSPACE_DIR || process.cwd();
const MAX_SESSIONS = parseInt(process.env.MAX_ACP_SESSIONS || "10", 10);

interface ManagedSession {
  client: AcpClient;
  sessionId: string;
  agentName: string;
  createdAt: Date;
  lastActivity: Date;
}

class AcpSessionManager {
  private sessions = new Map<string, ManagedSession>();

  async createSession(agentName: string): Promise<{
    sessionId: string;
    client: AcpClient;
  }> {
    // Enforce pool limit
    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictOldest();
    }

    const client = new AcpClient();
    await client.connect({ cwd: WORKSPACE_DIR });

    const sessionId = await client.createSession(WORKSPACE_DIR);

    // Switch to the requested agent
    if (agentName !== "kiro_default") {
      await client.switchAgent(sessionId, agentName);
    }

    this.sessions.set(sessionId, {
      client,
      sessionId,
      agentName,
      createdAt: new Date(),
      lastActivity: new Date(),
    });

    client.on("exit", () => {
      this.sessions.delete(sessionId);
    });

    return { sessionId, client };
  }

  getSession(sessionId: string): ManagedSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.client.disconnect();
      this.sessions.delete(sessionId);
    }
  }

  getActiveSessions(): Array<{
    sessionId: string;
    agentName: string;
    createdAt: Date;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      agentName: s.agentName,
      createdAt: s.createdAt,
    }));
  }

  async destroyAll(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.destroySession(id);
    }
  }

  private evictOldest(): void {
    let oldest: ManagedSession | null = null;
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastActivity < oldest.lastActivity) {
        oldest = session;
      }
    }
    if (oldest) {
      oldest.client.disconnect();
      this.sessions.delete(oldest.sessionId);
    }
  }
}

// Singleton — survives across API route invocations in dev/prod
export const sessionManager = new AcpSessionManager();
