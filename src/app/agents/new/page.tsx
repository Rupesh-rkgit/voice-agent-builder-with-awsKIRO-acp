import ConversationBuilder from "@/components/conversation-builder";

export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-xl font-bold">Create New Agent</h1>
      <p className="mt-1 text-sm text-slate-400">
        Describe what you need — use voice or text. The AI will ask clarifying questions.
      </p>
      <div className="mt-4">
        <ConversationBuilder />
      </div>
    </div>
  );
}
