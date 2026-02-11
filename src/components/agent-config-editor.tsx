"use client";

import { useState } from "react";
import type { KiroAgentConfig } from "@/lib/agents/schema";

export default function AgentConfigEditor({
  agentId,
  config,
}: {
  agentId: string;
  config: KiroAgentConfig;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(JSON.stringify(config, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setError(null);
    setSuccess(false);
    try {
      const parsed = JSON.parse(value);
      setSaving(true);
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.message || "Save failed");
        return;
      }
      setSuccess(true);
      setEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Invalid JSON");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Agent Configuration</h2>
        <div className="flex items-center gap-2">
          {success && <span className="text-xs text-emerald-400 animate-fade-in">✓ Saved</span>}
          {error && <span className="text-xs text-red-400 animate-fade-in">{error}</span>}
          {editing ? (
            <>
              <button
                onClick={() => { setEditing(false); setValue(JSON.stringify(config, null, 2)); setError(null); }}
                className="btn-secondary rounded-lg px-3 py-1.5 text-xs text-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="btn-secondary rounded-lg px-3 py-1.5 text-xs text-slate-400 transition-colors"
            >
              ✏️ Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          className="mt-4 w-full rounded-xl bg-black/30 p-4 text-sm text-slate-300 font-mono ring-1 ring-white/[0.06] outline-none focus:ring-violet-500/30 resize-y min-h-[300px] transition-all"
        />
      ) : (
        <pre className="mt-4 overflow-x-auto rounded-xl bg-black/30 p-4 text-sm text-slate-300 font-mono ring-1 ring-white/[0.04]">
          {JSON.stringify(config, null, 2)}
        </pre>
      )}
    </div>
  );
}
