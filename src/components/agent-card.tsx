"use client";

import type { AgentMeta } from "@/lib/agents/schema";
import { useRouter } from "next/navigation";

const TOOL_COLORS: Record<string, string> = {
  aws: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  shell: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  read: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  write: "bg-purple-500/10 text-purple-400 ring-purple-500/20",
  code: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20",
  "@git": "bg-orange-500/10 text-orange-400 ring-orange-500/20",
  "@fetch": "bg-pink-500/10 text-pink-400 ring-pink-500/20",
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
  const isOrchestrator = agent.parentAgentId === null && agent.name.includes("orchestrator");

  return (
    <div className="card-glow group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:border-white/[0.12] transition-all duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
            isOrchestrator
              ? "bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-violet-500/20"
              : "bg-white/[0.04] ring-1 ring-white/[0.06]"
          }`}>
            {isOrchestrator ? "🎯" : "🤖"}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white truncate">{agent.name}</h3>
            <p className="mt-0.5 text-sm text-slate-500 line-clamp-2 leading-relaxed">{agent.description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
          {model.replace("claude-", "")}
        </span>
      </div>

      {/* Tools */}
      {tools.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {tools.slice(0, 5).map((tool) => (
            <span
              key={tool}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${TOOL_COLORS[tool] || "bg-white/[0.04] text-slate-400 ring-white/[0.06]"}`}
            >
              {tool}
            </span>
          ))}
          {tools.length > 5 && (
            <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-white/[0.06]">
              +{tools.length - 5}
            </span>
          )}
        </div>
      )}

      {/* Actions — always visible on mobile, hover on desktop */}
      <div className="mt-4 flex items-center gap-2 pt-3 border-t border-white/[0.04] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={() => router.push(`/chat/${agent.id}`)}
          className="rounded-lg bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 ring-1 ring-violet-500/20 hover:bg-violet-500/20 transition-colors"
        >
          💬 Chat
        </button>
        <button
          onClick={() => router.push(`/agents/${agent.id}`)}
          className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-400 ring-1 ring-white/[0.06] hover:bg-white/[0.08] transition-colors"
        >
          ✏️ Edit
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(agent.id)}
            className="ml-auto rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-colors"
            aria-label={`Delete agent ${agent.name}`}
          >
            🗑️
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-600">
        Created {new Date(agent.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </p>
    </div>
  );
}
