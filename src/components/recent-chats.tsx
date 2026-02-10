"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import type { ChatSession } from "@/lib/db/chat-history";

export default function RecentChats({ sessions: initial }: { sessions: ChatSession[] }) {
  const [sessions, setSessions] = useState(initial);

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/chat/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    setSessions((prev) => prev.filter((s) => s.id !== sid));
  }, []);

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
        <div key={s.id} className="group relative">
          <Link
            href={`/chat/${s.agentId}?resume=${s.id}`}
            className="block rounded-lg p-3 pr-8 hover:bg-slate-800/70 transition-colors"
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
          <button
            onClick={(e) => deleteSession(s.id, e)}
            className="absolute right-2 top-3 hidden group-hover:block rounded p-0.5 text-slate-600 hover:text-red-400 hover:bg-slate-700/50 transition-colors"
            title="Delete chat"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
