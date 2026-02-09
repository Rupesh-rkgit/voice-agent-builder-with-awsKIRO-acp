"use client";

import Link from "next/link";

interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

export default function RecentChats({ sessions }: { sessions: ChatSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-slate-500">No chat history yet.</p>
        <p className="text-xs text-slate-600 mt-1">Start chatting with an agent!</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={`/chat/${s.agentId}?resume=${s.id}`}
          className="block rounded-lg p-3 hover:bg-slate-800/70 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs">🤖</span>
            <span className="text-xs font-medium text-slate-300 truncate">{s.agentName}</span>
          </div>
          <p className="mt-1 text-sm text-slate-400 truncate">
            {s.title || s.lastMessage || "Empty chat"}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600">
            <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
            {s.messageCount ? <span>· {s.messageCount} msgs</span> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
