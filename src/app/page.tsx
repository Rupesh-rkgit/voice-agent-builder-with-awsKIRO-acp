import AgentGrid from "@/components/agent-grid";
import AgentTree from "@/components/agent-tree";
import RecentChats from "@/components/recent-chats";
import { listAgents, getAgent } from "@/lib/agents/config-service";
import { getRecentChats } from "@/lib/db/chat-history";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const agents = await listAgents();
  const enriched = await Promise.all(
    agents.map(async (a) => {
      const full = await getAgent(a.id);
      return { ...a, config: full?.config };
    })
  );
  const recentChats = getRecentChats(10);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Your Agents</h1>
              <p className="mt-1 text-sm text-slate-400">
                {agents.length === 0
                  ? "No agents yet. Create your first one!"
                  : `${agents.length} agent${agents.length > 1 ? "s" : ""} configured`}
              </p>
            </div>
          </div>

          <AgentTree agents={agents} />
          <AgentGrid agents={enriched} />
        </div>
      </div>

      {/* Right sidebar — recent chats */}
      <div className="w-72 shrink-0 border-l border-slate-800 bg-slate-950 overflow-y-auto">
        <div className="p-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Recent Chats
          </h2>
          <RecentChats sessions={recentChats} />
        </div>
      </div>
    </div>
  );
}
