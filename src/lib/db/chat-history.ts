/**
 * SQLite database for chat history persistence.
 * Auto-creates tables on first use. Zero config.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(
  process.env.KIRO_WORKSPACE_DIR || process.cwd(),
  ".kiro",
  "chat-history.db"
);

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        title TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON chat_sessions(agent_id);
    `);
  }
  return _db;
}

// --- Sessions ---

export interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

export function createChatSession(id: string, agentId: string, agentName: string): ChatSession {
  const db = getDb();
  db.prepare(
    "INSERT INTO chat_sessions (id, agent_id, agent_name) VALUES (?, ?, ?)"
  ).run(id, agentId, agentName);
  return { id, agentId, agentName, title: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function listChatSessions(agentId?: string, limit = 50): ChatSession[] {
  const db = getDb();
  const query = agentId
    ? `SELECT s.*, COUNT(m.id) as message_count,
       (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message
       FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id
       WHERE s.agent_id = ? GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?`
    : `SELECT s.*, COUNT(m.id) as message_count,
       (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message
       FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id
       GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?`;

  const rows = agentId
    ? db.prepare(query).all(agentId, limit)
    : db.prepare(query).all(limit);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    agentId: r.agent_id as string,
    agentName: r.agent_name as string,
    title: r.title as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    messageCount: r.message_count as number,
    lastMessage: r.last_message as string | undefined,
  }));
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb().prepare(
    "UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND (title IS NULL OR title = '')"
  ).run(title, sessionId);
}

export function touchSession(sessionId: string): void {
  getDb().prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);
}

export function deleteChatSession(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
}

// --- Messages ---

export interface ChatMessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  agentName: string | null;
  createdAt: string;
}

export function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  agentName?: string
): void {
  getDb().prepare(
    "INSERT INTO chat_messages (session_id, role, content, agent_name) VALUES (?, ?, ?, ?)"
  ).run(sessionId, role, content, agentName || null);
  touchSession(sessionId);
}

export function getSessionMessages(sessionId: string): ChatMessageRecord[] {
  const rows = getDb().prepare(
    "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC"
  ).all(sessionId);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as number,
    sessionId: r.session_id as string,
    role: r.role as string,
    content: r.content as string,
    agentName: r.agent_name as string | null,
    createdAt: r.created_at as string,
  }));
}

// --- Stats ---

export function getRecentChats(limit = 10): ChatSession[] {
  return listChatSessions(undefined, limit);
}
