"use client";

import type { AgentMeta } from "@/lib/agents/schema";
import { useRouter } from "next/navigation";

const TOOL_COLORS: Record<string, string> = {
  aws: "bg-amber-900/50 text-amber-300",
  shell: "bg-emerald-900/50 text-emerald-300",
  read: "bg-blue-900/50 text-blue-300",
  write: "bg-purple-900/50 text-purple-300",
  code: "bg-cyan-900/50 text-cyan-300",
  "@git": "bg-orange-900/50 text-orange-300",
};

export default function AgentCard({
  agent,
  onDelete,
}: {
  agent: AgentMeta & { config?: { tools?: string[]; model?: string } };
  onDelete?: (id: string) => void;
}) {
  const router = useRouter();
  const tools = agent.config?.tools || [];
  const model = agent.config?.model || "claude-sonnet-4";

  return (
    <div className="group rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate">{agent.name}</h3>
          <p className="mt-1 text-sm text-slate-400 line-clamp-2">{agent.description}</p>
        </div>
        <span className="ml-3 shrink-0 rounded-full bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">
          {model.replace("claude-", "")}
        </span>
      </div>

      {/* Tools */}
      {tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tools.slice(0, 5).map((tool) => (
            <span
              key={tool}
              className={`rounded-md px-2 py-0.5 text-xs ${TOOL_COLORS[tool] || "bg-slate-800 text-slate-400"}`}
            >
              {tool}
            </span>
          ))}
          {tools.length > 5 && (
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
              +{tools.length - 5}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => router.push(`/chat/${agent.id}`)}
          className="rounded-lg bg-violet-600/20 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-600/30"
        >
          💬 Chat
        </button>
        <button
          onClick={() => router.push(`/agents/${agent.id}`)}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
        >
          ✏️ Edit
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(agent.id)}
            className="rounded-lg bg-red-900/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30"
          >
            🗑️
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-600">
        Created {new Date(agent.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
