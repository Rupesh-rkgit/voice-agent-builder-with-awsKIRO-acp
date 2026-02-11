import { getRecentChats } from "@/lib/db/chat-history";
import Link from "next/link";
import HistoryList from "@/components/history-list";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const sessions = getRecentChats(50);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Chat History</h1>
        <p className="mt-1 text-sm text-slate-500">
          {sessions.length === 0
            ? "No conversations yet. Start chatting with an agent!"
            : `${sessions.length} conversation${sessions.length > 1 ? "s" : ""}`}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center animate-fade-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] text-3xl">
            💬
          </div>
          <h2 className="mt-5 text-lg font-semibold text-white">No conversations yet</h2>
          <p className="mt-2 max-w-sm text-sm text-slate-500 leading-relaxed">
            Chat with an agent to see your conversation history here.
          </p>
          <Link
            href="/agents"
            className="btn-primary mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
          >
            Browse Agents
          </Link>
        </div>
      ) : (
        <HistoryList sessions={sessions} />
      )}
    </div>
  );
}
