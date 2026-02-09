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
          <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors">← Back</Link>
          <h1 className="mt-2 text-2xl font-bold">{agent.config.name}</h1>
          <p className="mt-1 text-sm text-slate-400">{agent.config.description}</p>
        </div>
        <Link href={`/chat/${id}`}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors">
          💬 Chat
        </Link>
      </div>

      {/* Tools */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Tools</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {agent.config.tools.map((tool) => (
            <span key={tool} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300">{tool}</span>
          ))}
        </div>
      </div>

      {/* Editable config */}
      <AgentConfigEditor agentId={id} config={agent.config} />

      {/* Children */}
      {children.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Child Agents</h2>
          <div className="mt-3 space-y-2">
            {children.map((child) => (
              <Link key={child.id} href={`/agents/${child.id}`}
                className="flex items-center gap-3 rounded-lg bg-slate-800 p-3 hover:bg-slate-700 transition-colors">
                <span className="text-lg">🤖</span>
                <div>
                  <span className="font-medium text-white">{child.name}</span>
                  <span className="ml-2 text-sm text-slate-400">{child.description}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-slate-600 space-y-1">
        <p>ID: {agent.meta.id}</p>
        <p>Config: {agent.meta.configPath}</p>
        <p>Created: {new Date(agent.meta.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
