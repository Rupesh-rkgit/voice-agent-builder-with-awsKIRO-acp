import { getAgent, getChildAgents } from "@/lib/agents/config-service";
import { notFound } from "next/navigation";
import Link from "next/link";
import AgentConfigEditor from "@/components/agent-config-editor";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const children = await getChildAgents(id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-white transition-colors">← Back</Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight gradient-text">{agent.config.name}</h1>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">{agent.config.description}</p>
        </div>
        <Link
          href={`/chat/${id}`}
          className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200"
        >
          💬 Chat
        </Link>
      </div>

      {/* Tools */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Tools</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {agent.config.tools.map((tool) => (
            <span key={tool} className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/[0.06]">{tool}</span>
          ))}
        </div>
      </div>

      {/* Editable config */}
      <AgentConfigEditor agentId={id} config={agent.config} />

      {/* Children */}
      {children.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Child Agents</h2>
          <div className="mt-3 space-y-2">
            {children.map((child) => (
              <Link key={child.id} href={`/agents/${child.id}`}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.04] hover:ring-white/[0.08] transition-all duration-200">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-sm">🤖</span>
                <div className="min-w-0">
                  <span className="font-medium text-white">{child.name}</span>
                  <p className="text-sm text-slate-500 truncate">{child.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-700 font-mono space-y-1">
        <p>ID: {agent.meta.id}</p>
        <p>Config: {agent.meta.configPath}</p>
        <p>Created: {new Date(agent.meta.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
