"use client";

import { useState } from "react";
import type { AgentMeta } from "@/lib/agents/schema";
import AgentCard from "@/components/agent-card";

export default function AgentGrid({
  agents,
}: {
  agents: Array<AgentMeta & { config?: { tools?: string[]; model?: string } }>;
}) {
  const [items, setItems] = useState(agents);

  async function handleDelete(id: string) {
    if (!confirm("Delete this agent? This cannot be undone.")) return;
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((a) => a.id !== id));
    }
  }

  if (items.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center text-center animate-fade-in">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 ring-1 ring-violet-500/20 text-4xl">
          🤖
        </div>
        <h2 className="mt-6 text-lg font-semibold text-white">No agents yet</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500 leading-relaxed">
          Create your first AI agent using voice commands or text. Describe what you need and the AI will configure it for you.
        </p>
        <a
          href="/agents/new"
          className="btn-primary mt-6 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-200"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Create Your First Agent
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((agent, i) => (
        <div key={agent.id} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
          <AgentCard agent={agent} onDelete={handleDelete} />
        </div>
      ))}
    </div>
  );
}
