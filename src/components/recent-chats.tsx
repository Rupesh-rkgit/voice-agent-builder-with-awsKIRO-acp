"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import type { ChatSession } from "@/lib/db/chat-history";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
        <div className="text-3xl mb-3">💬</div>
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
            className="block rounded-xl p-3 pr-8 hover:bg-white/[0.04] transition-all duration-200"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500/10 text-[10px]">🤖</span>
              <span className="text-xs font-medium text-slate-300 truncate">{s.agentName}</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-400 truncate leading-snug">
              {s.title || s.lastMessage || "Empty chat"}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-600">
              <span>{timeAgo(s.updatedAt)}</span>
              {s.messageCount ? <span className="text-slate-700">·</span> : null}
              {s.messageCount ? <span>{s.messageCount} msgs</span> : null}
            </div>
          </Link>
          <button
            onClick={(e) => deleteSession(s.id, e)}
            className="absolute right-2 top-3 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            aria-label={`Delete chat with ${s.agentName}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
