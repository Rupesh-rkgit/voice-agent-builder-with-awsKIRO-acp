"use client";

import type { AgentMeta } from "@/lib/agents/schema";
import Link from "next/link";

interface TreeNode {
  agent: AgentMeta;
  children: TreeNode[];
}

function buildTree(agents: AgentMeta[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const agent of agents) {
    map.set(agent.id, { agent, children: [] });
  }

  for (const agent of agents) {
    const node = map.get(agent.id)!;
    if (agent.parentAgentId && map.has(agent.parentAgentId)) {
      map.get(agent.parentAgentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const isRoot = depth === 0;
  return (
    <div className={depth > 0 ? "ml-6 border-l border-slate-700 pl-4" : ""}>
      <Link
        href={`/agents/${node.agent.id}`}
        className={`flex items-center gap-3 rounded-lg p-3 hover:bg-slate-800 transition-colors ${
          isRoot ? "bg-slate-800/50 border border-slate-700" : ""
        }`}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${
          isRoot ? "bg-violet-600/20 text-violet-300" : "bg-slate-700 text-slate-400"
        }`}>
          {isRoot ? "🎯" : "🤖"}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-white truncate">{node.agent.name}</p>
          <p className="text-xs text-slate-500 truncate">{node.agent.description}</p>
        </div>
        {node.children.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            {node.children.length} sub
          </span>
        )}
      </Link>
      {node.children.map((child) => (
        <TreeNodeView key={child.agent.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function AgentTree({ agents }: { agents: AgentMeta[] }) {
  const tree = buildTree(agents);

  if (tree.length === 0) return null;

  // Only show tree if there are parent-child relationships
  const hasHierarchy = agents.some((a) => a.parentAgentId);
  if (!hasHierarchy) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Agent Hierarchy</h2>
      <div className="space-y-2">
        {tree.map((node) => (
          <TreeNodeView key={node.agent.id} node={node} />
        ))}
      </div>
    </div>
  );
}
