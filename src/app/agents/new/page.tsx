import ConversationBuilder from "@/components/conversation-builder";

export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-xl font-bold tracking-tight gradient-text">Create New Agent</h1>
      <p className="mt-1 text-sm text-slate-500 leading-relaxed">
        Describe what you need — use voice or text. The AI will ask clarifying questions and build the config for you.
      </p>
      <div className="mt-5">
        <ConversationBuilder />
      </div>
    </div>
  );
}
