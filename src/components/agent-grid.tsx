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
      <div className="mt-16 flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-800 text-4xl">🤖</div>
        <h2 className="mt-6 text-lg font-semibold">No agents yet</h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Create your first AI agent using voice commands or text.
        </p>
        <a href="/agents/new" className="mt-6 rounded-lg bg-violet-600 px-6 py-3 text-sm font-medium hover:bg-violet-700 transition-colors">
          + Create Your First Agent
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((agent) => (
        <AgentCard key={agent.id} agent={agent} onDelete={handleDelete} />
      ))}
    </div>
  );
}
