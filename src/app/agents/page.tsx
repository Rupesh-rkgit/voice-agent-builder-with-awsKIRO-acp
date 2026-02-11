import AgentGrid from "@/components/agent-grid";
import AgentTree from "@/components/agent-tree";
import { listAgents, getAgent } from "@/lib/agents/config-service";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await listAgents();
  const enriched = await Promise.all(
    agents.map(async (a) => {
      const full = await getAgent(a.id);
      return { ...a, config: full?.config };
    })
  );

  const orchestrators = agents.filter((a) => !a.parentAgentId && agents.some((c) => c.parentAgentId === a.id));
  const standalone = agents.filter((a) => !a.parentAgentId && !agents.some((c) => c.parentAgentId === a.id));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">Agents</h1>
          <p className="mt-1 text-sm text-slate-500">
            {agents.length === 0
              ? "No agents yet. Create your first one!"
              : `${agents.length} agent${agents.length > 1 ? "s" : ""} configured`}
          </p>
        </div>
        <Link
          href="/agents/new"
          className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          New Agent
        </Link>
      </div>

      {/* Stats */}
      {agents.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8 animate-fade-in">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Total</p>
            <p className="mt-1 text-2xl font-bold text-white">{agents.length}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Orchestrators</p>
            <p className="mt-1 text-2xl font-bold text-violet-400">{orchestrators.length}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Standalone</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">{standalone.length}</p>
          </div>
        </div>
      )}

      {/* Hierarchy */}
      <div className="mb-8">
        <AgentTree agents={agents} />
      </div>

      {/* Grid */}
      <AgentGrid agents={enriched} />
    </div>
  );
}
