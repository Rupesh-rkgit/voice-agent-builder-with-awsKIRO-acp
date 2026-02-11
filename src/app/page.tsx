import Link from "next/link";
import { listAgents } from "@/lib/agents/config-service";
import { getRecentChats } from "@/lib/db/chat-history";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const agents = await listAgents();
  const recentChats = getRecentChats(5);
  const orchestrators = agents.filter((a) => !a.parentAgentId && agents.some((c) => c.parentAgentId === a.id));

  return (
    <div className="relative overflow-hidden">
      {/* Hero glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] opacity-30"
        style={{ background: "radial-gradient(ellipse at center, rgba(139,92,246,0.15) 0%, transparent 70%)" }} />

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-6 pt-20 pb-16 text-center">
        <div className="animate-fade-in">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-violet-500/20">
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="13" stroke="url(#hg)" strokeWidth="1.5" opacity="0.4" />
              <rect x="7" y="11" width="2" height="6" rx="1" fill="url(#hg)" />
              <rect x="11" y="8" width="2" height="12" rx="1" fill="url(#hg)" />
              <rect x="15" y="6" width="2" height="16" rx="1" fill="url(#hg)" />
              <rect x="19" y="9" width="2" height="10" rx="1" fill="url(#hg)" />
              <defs><linearGradient id="hg" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#6366f1" />
              </linearGradient></defs>
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Build AI Agents with <span className="gradient-text">Your Voice</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400 leading-relaxed">
            Create, orchestrate, and chat with multi-agent AI systems powered by Kiro CLI.
            Describe what you need — we handle the rest.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/agents"
              className="btn-primary flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              View Agents
            </Link>
            <Link
              href="/agents/new"
              className="btn-secondary flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-slate-300 transition-all duration-200"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Create Agent
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-4xl px-6 pb-12">
        <div className="grid grid-cols-3 gap-4 animate-fade-in" style={{ animationDelay: "100ms" }}>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center">
            <p className="text-3xl font-bold text-white">{agents.length}</p>
            <p className="mt-1 text-xs text-slate-500 uppercase tracking-wider">Agents</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center">
            <p className="text-3xl font-bold text-violet-400">{orchestrators.length}</p>
            <p className="mt-1 text-xs text-slate-500 uppercase tracking-wider">Orchestrators</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center">
            <p className="text-3xl font-bold text-emerald-400">{recentChats.length}</p>
            <p className="mt-1 text-xs text-slate-500 uppercase tracking-wider">Recent Chats</p>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-3 animate-fade-in" style={{ animationDelay: "200ms" }}>
          <div className="card-glow rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20 text-lg mb-4">
              🎤
            </div>
            <h3 className="font-semibold text-white">Voice-First Creation</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Describe your agent using voice or text. The AI asks clarifying questions and builds the config.
            </p>
          </div>
          <div className="card-glow rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 text-lg mb-4">
              🎯
            </div>
            <h3 className="font-semibold text-white">Multi-Agent Orchestration</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Orchestrators delegate tasks to specialized sub-agents in real-time with streaming responses.
            </p>
          </div>
          <div className="card-glow rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 text-lg mb-4">
              💬
            </div>
            <h3 className="font-semibold text-white">Persistent Chat History</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              All conversations are saved to SQLite. Resume any session, review past interactions.
            </p>
          </div>
        </div>
      </section>

      {/* Quick access — recent chats */}
      {recentChats.length > 0 && (
        <section className="mx-auto max-w-4xl px-6 pb-16 animate-fade-in" style={{ animationDelay: "300ms" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-400">Recent Conversations</h2>
            <Link href="/history" className="text-xs text-slate-500 hover:text-violet-400 transition-colors">
              View all →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentChats.slice(0, 3).map((chat) => (
              <Link
                key={chat.id}
                href={`/chat/${chat.agentId}?resume=${chat.id}`}
                className="card-glow rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all duration-200"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/10 text-[10px]">🤖</span>
                  <span className="text-xs font-medium text-slate-300 truncate">{chat.agentName}</span>
                </div>
                <p className="text-sm text-slate-400 truncate">{chat.title || "Untitled"}</p>
                <p className="mt-2 text-[10px] text-slate-600">
                  {chat.messageCount || 0} messages
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
