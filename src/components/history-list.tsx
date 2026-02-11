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

export default function HistoryList({ sessions: initial }: { sessions: ChatSession[] }) {
  const [sessions, setSessions] = useState(initial);

  const deleteSession = useCallback(async (sid: string) => {
    await fetch("/api/chat/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    setSessions((prev) => prev.filter((s) => s.id !== sid));
  }, []);

  return (
    <div className="space-y-2">
      {sessions.map((s, i) => (
        <div
          key={s.id}
          className="group card-glow flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all duration-200 animate-fade-in"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20 text-sm">
            🤖
          </div>
          <Link href={`/chat/${s.agentId}?resume=${s.id}`} className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white truncate">{s.title || "Untitled"}</span>
              <span className="shrink-0 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-white/[0.06]">
                {s.agentName}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>{timeAgo(s.updatedAt)}</span>
              {s.messageCount ? <span>{s.messageCount} messages</span> : null}
            </div>
          </Link>
          <button
            onClick={() => deleteSession(s.id)}
            className="shrink-0 hidden group-hover:flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            aria-label={`Delete chat ${s.title || "Untitled"}`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3.5h10M5 3.5V2.5a1 1 0 011-1h2a1 1 0 011 1v1M11 3.5l-.5 8a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5L3 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
