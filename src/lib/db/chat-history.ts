/**
 * SQLite database for chat history persistence.
 * Auto-creates tables on first use. Zero config.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(
  process.env.KIRO_WORKSPACE_DIR || process.cwd(),
  ".kiro"
);
const DB_PATH = path.join(DB_DIR, "chat-history.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
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

/** Close the database connection (called on shutdown). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Close DB on process exit
process.on("SIGTERM", closeDb);
process.on("SIGINT", closeDb);

// --- DB Row Types (match SQLite column names) ---

interface SessionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  agent_name: string | null;
  created_at: string;
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

  const rows = (agentId
    ? db.prepare(query).all(agentId, limit)
    : db.prepare(query).all(limit)) as SessionRow[];

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    lastMessage: r.last_message ?? undefined,
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
  ).all(sessionId) as MessageRow[];

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    agentName: r.agent_name,
    createdAt: r.created_at,
  }));
}

// --- Stats ---

export function getRecentChats(limit = 10): ChatSession[] {
  return listChatSessions(undefined, limit);
}
