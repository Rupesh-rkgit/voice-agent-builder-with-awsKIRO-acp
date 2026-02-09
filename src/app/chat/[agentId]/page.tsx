"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoice } from "@/hooks/use-voice";
import { useSearchParams } from "next/navigation";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "delegation";
  content: string;
  agentName?: string;
  toolCalls?: Array<{ name: string; status: string }>;
}

interface ChildAgent { id: string; name: string; description: string; }
interface HistorySession { id: string; agentId: string; agentName: string; title: string; updatedAt: string; messageCount?: number; }

export default function ChatPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [agentId, setAgentId] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentTools, setAgentTools] = useState<string[]>([]);
  const [agentModel, setAgentModel] = useState("");
  const [children, setChildren] = useState<ChildAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResumed, setIsResumed] = useState(false);
  const [activeChild, setActiveChild] = useState<string | null>(null);

  async function ensureLiveSession(): Promise<string | null> {
    if (!isResumed || !agentId) return sessionId;
    try {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const data = await res.json();
      if (data.error) return null;
      setSessionId(data.sessionId);
      setIsResumed(false);
      return data.sessionId;
    } catch {
      return null;
    }
  }
  const [history, setHistory] = useState<HistorySession[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { isListening, transcript, startListening, stopListening, supported } = useVoice();
  const searchParams = useSearchParams();

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/chat/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    setHistory((prev) => prev.filter((h) => h.id !== sid));
  }, []);

  useEffect(() => { params.then((p) => setAgentId(p.agentId)); }, [params]);

  // Load chat history for this agent
  const loadHistory = useCallback(async (aid: string) => {
    try {
      const res = await fetch(`/api/chat/history?agentId=${aid}`);
      const data = await res.json();
      setHistory(data.sessions || []);
    } catch { /* ignore */ }
  }, []);

  // Load previous messages if resuming
  const loadPreviousMessages = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/chat/history?sessionId=${sid}`);
      const data = await res.json();
      if (data.messages?.length) {
        setMessages(data.messages.map((m: { id: number; role: string; content: string; agentName?: string; agent_name?: string }, i: number) => ({
          id: `h-${i}`,
          role: m.role as ChatMessage["role"],
          content: m.content,
          agentName: m.agentName || m.agent_name || undefined,
        })));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!agentId) return;
    loadHistory(agentId);
    const resumeId = searchParams.get("resume");

    setConnecting(true);

    // First, fetch agent info (needed regardless of resume or new)
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then(async (agentData) => {
        if (agentData.error) {
          setError(agentData.error.message || "Agent not found");
          return;
        }

        setAgentName(agentData.config?.name || "");
        setAgentDescription(agentData.config?.description || "");
        setAgentTools(agentData.config?.tools || []);
        setAgentModel(agentData.config?.model || "");
        setChildren((agentData.children || []).map((c: { id: string; name: string; description: string }) => ({
          id: c.id, name: c.name, description: c.description || "",
        })));

        if (resumeId) {
          // Resume mode: load messages, set sessionId to the old one (read-only history view)
          setSessionId(resumeId);
          setIsResumed(true);
          await loadPreviousMessages(resumeId);
        } else {
          // New chat: create ACP session
          const sessionRes = await fetch("/api/chat/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId }),
          });
          const sessionData = await sessionRes.json();
          if (sessionData.error) {
            setError(sessionData.error.message);
            return;
          }
          setSessionId(sessionData.sessionId);
          setChildren(sessionData.children || []);
        }
      })
      .catch(() => setError("Failed to load agent"))
      .finally(() => setConnecting(false));
  }, [agentId, searchParams, loadHistory, loadPreviousMessages]);

  useEffect(() => {
    if (transcript && !isListening) sendMessage(transcript);
  }, [transcript, isListening]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim()) return;
    const liveSessionId = await ensureLiveSession();
    if (!liveSessionId) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setActiveChild(null);

    const assistantId = `a-${Date.now()}`;
    let currentMsgId = assistantId;
    setMessages((prev) => [...prev, {
      id: assistantId, role: "assistant", content: "", agentName: agentName, toolCalls: [],
    }]);

    try {
      let res = await fetch("/api/chat/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: liveSessionId, message: text.trim() }),
      });

      // Session expired (server restart / eviction) — recreate and retry
      if (res.status === 404 && agentId) {
        const sessionRes = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
        const sessionData = await sessionRes.json();
        if (sessionData.sessionId) {
          setSessionId(sessionData.sessionId);
          setIsResumed(false);
          res = await fetch("/api/chat/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sessionData.sessionId, message: text.trim() }),
          });
        }
      }

      if (!res.ok || !res.body) throw new Error("Failed to get response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "text") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentMsgId ? { ...m, content: m.content + data.content } : m
                )
              );
            } else if (data.type === "tool_call") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentMsgId
                    ? { ...m, toolCalls: [...(m.toolCalls || []), { name: data.name, status: data.status }] }
                    : m
                )
              );
            } else if (data.type === "delegation" && data.status === "start") {
              setActiveChild(data.agent);
              const delegationId = `d-${Date.now()}`;
              setMessages((prev) => [...prev, {
                id: delegationId, role: "delegation", content: data.task, agentName: data.agent,
              }]);
              const subMsgId = `sub-${Date.now()}`;
              setMessages((prev) => [...prev, {
                id: subMsgId, role: "assistant", content: "", agentName: data.agent, toolCalls: [],
              }]);
              currentMsgId = subMsgId;
            } else if (data.type === "delegation" && data.status === "end") {
              setActiveChild(null);
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgId ? { ...m, content: "⚠️ Failed to get response. Try again." } : m
        )
      );
    } finally {
      setLoading(false);
      // Refresh history sidebar
      if (agentId) loadHistory(agentId);
    }
  }

  if (connecting) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center gap-1 mb-4">
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-400" />
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-400" />
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-400" />
          </div>
          <p className="text-slate-400">Connecting to Kiro agent...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="max-w-md rounded-xl border border-red-900 bg-red-950/30 p-6 text-center">
          <p className="text-lg">⚠️</p>
          <p className="mt-2 text-sm text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  const isOrchestrator = children.length > 0;

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left sidebar — chat history */}
      <div className="w-64 shrink-0 border-r border-slate-800 bg-slate-950 overflow-y-auto">
        <div className="p-3">
          <a
            href={`/chat/${agentId}`}
            className="flex items-center gap-2 rounded-lg bg-violet-600/20 px-3 py-2 text-sm text-violet-300 hover:bg-violet-600/30 transition-colors mb-3"
          >
            <span>+</span> New Chat
          </a>
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">History</h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-600 px-1">No previous chats</p>
          ) : (
            <div className="space-y-0.5">
              {history.map((h) => (
                <div key={h.id} className="group relative">
                  <a
                    href={`/chat/${agentId}?resume=${h.id}`}
                    className={`block rounded-lg px-3 py-2 pr-8 text-xs hover:bg-slate-800/70 transition-colors ${
                      h.id === sessionId ? "bg-slate-800 text-white" : "text-slate-400"
                    }`}
                  >
                    <p className="truncate">{h.title || "Untitled"}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {new Date(h.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </a>
                  <button
                    onClick={(e) => deleteSession(h.id, e)}
                    className="absolute right-2 top-2 hidden group-hover:block rounded p-0.5 text-slate-600 hover:text-red-400 hover:bg-slate-700/50 transition-colors"
                    title="Delete chat"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main chat */}
      <div className="flex flex-1 flex-col min-w-0 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-800 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/20 text-base">
            {isOrchestrator ? "🎯" : "🤖"}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-white truncate">{agentName}</h1>
            <p className="text-xs text-slate-500 truncate">{agentDescription}</p>
          </div>
          {agentModel && (
            <span className="shrink-0 rounded-full bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">
              {agentModel.replace("claude-", "")}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-4xl mb-4">{isOrchestrator ? "🎯" : "🤖"}</div>
                <h2 className="text-lg font-semibold text-slate-300">{agentName}</h2>
                <p className="mt-2 text-sm text-slate-500">{agentDescription}</p>
                <p className="mt-4 text-xs text-slate-600">Type a message or use voice to start chatting</p>
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "delegation") {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="flex items-center gap-2 rounded-full border border-amber-800/50 bg-amber-950/30 px-4 py-2 text-xs">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-amber-300 font-medium">Delegating to {msg.agentName}</span>
                    <span className="text-amber-500 max-w-xs truncate">— {msg.content}</span>
                  </div>
                </div>
              );
            }

            const isUser = msg.role === "user";
            const isSubAgent = msg.agentName && msg.agentName !== agentName;

            return (
              <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                  isUser
                    ? "bg-violet-600 text-white"
                    : isSubAgent
                      ? "bg-slate-800 text-slate-200 border border-amber-700/40"
                      : "bg-slate-800 text-slate-200 border border-slate-700"
                }`}>
                  {isSubAgent && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      {msg.agentName}
                    </div>
                  )}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {msg.toolCalls.map((tc, i) => (
                        <div key={i} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-400">
                          <span className={tc.status === "running" ? "text-amber-400" : "text-emerald-400"}>●</span>
                          {tc.name}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                </div>
              </div>
            );
          })}

          {loading && messages.at(-1)?.role === "assistant" && !messages.at(-1)?.content && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-slate-800 border border-slate-700 px-4 py-3">
                <div className="flex gap-1">
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-800 py-3">
          {isListening && (
            <div className="mb-2 flex items-center gap-2 text-xs text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500 voice-pulse" />
              Listening...
            </div>
          )}
          <div className="flex items-center gap-3">
            {supported && (
              <button
                onClick={isListening ? stopListening : startListening}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isListening ? "bg-red-500 voice-pulse text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                🎤
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
              placeholder={isListening ? "Listening..." : "Message the agent..."}
              disabled={loading}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-30"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar — sub-agents (orchestrators) or agent info */}
      <div className="w-64 shrink-0 border-l border-slate-800 bg-slate-950 overflow-y-auto p-4">
        {isOrchestrator ? (
          <>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Sub-Agents ({children.length})
            </h2>
            <div className="space-y-2">
              {children.map((child) => {
                const isActive = activeChild === child.name;
                return (
                  <div
                    key={child.id}
                    className={`rounded-lg p-3 transition-all duration-300 ${
                      isActive
                        ? "bg-amber-950/40 border border-amber-600/40 shadow-lg shadow-amber-900/20"
                        : "bg-slate-800/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isActive && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />}
                      <span className={`text-sm font-medium truncate ${isActive ? "text-amber-300" : "text-slate-300"}`}>
                        {child.name}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{child.description}</p>
                    {isActive && (
                      <span className="mt-2 inline-block rounded-full bg-amber-600/30 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
                        ⚡ Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Agent Info</h2>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Description</p>
                <p className="text-sm text-slate-300 mt-1">{agentDescription}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Model</p>
                <p className="text-sm text-slate-300 mt-1">{agentModel}</p>
              </div>
            </div>
          </>
        )}

        {agentTools.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tools</h3>
            <div className="flex flex-wrap gap-1">
              {agentTools.map((t) => (
                <span key={t} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{t}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-[10px] text-slate-600">Session: {sessionId?.slice(0, 12)}...</p>
        </div>
      </div>
    </div>
  );
}
