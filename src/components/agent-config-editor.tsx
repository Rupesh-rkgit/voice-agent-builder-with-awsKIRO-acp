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
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Agent Configuration</h2>
        <div className="flex items-center gap-2">
          {success && <span className="text-xs text-emerald-400">✓ Saved</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setValue(JSON.stringify(config, null, 2)); setError(null); }}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
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
          className="mt-4 w-full rounded-lg bg-slate-950 p-4 text-sm text-slate-300 font-mono border border-slate-700 outline-none focus:border-violet-500 resize-y min-h-[300px]"
        />
      ) : (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm text-slate-300 font-mono">
          {JSON.stringify(config, null, 2)}
        </pre>
      )}
    </div>
  );
}
