"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoice } from "@/hooks/use-voice";
import { useSearchParams } from "next/navigation";
import type { ChatSession } from "@/lib/db/chat-history";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "delegation";
  content: string;
  agentName?: string;
  toolCalls?: Array<{ name: string; status: string }>;
}

interface ChildAgent { id: string; name: string; description: string; }

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
    } catch (e) {
      console.error("[chat] Failed to recreate session:", e);
      return null;
    }
  }
  const [history, setHistory] = useState<ChatSession[]>([]);
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
    } catch (e) {
      console.error("[chat] Failed to load history:", e);
    }
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
    } catch (e) {
      console.error("[chat] Failed to load previous messages:", e);
    }
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

      function processSSELine(line: string) {
        if (!line.startsWith("data: ")) return;
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
        } catch (e) {
          console.warn("[chat] Failed to parse SSE chunk:", (e as Error).message);
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          processSSELine(line);
        }
      }

      // Flush any remaining data in the buffer after stream ends
      if (buffer.trim()) {
        processSSELine(buffer.trim());
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
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="flex justify-center gap-1.5 mb-4">
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-500" />
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-500" />
            <span className="typing-dot h-3 w-3 rounded-full bg-violet-500" />
          </div>
          <p className="text-slate-500 text-sm">Connecting to Kiro agent...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center animate-fade-in">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm text-red-300 leading-relaxed">{error}</p>
          <a href="/" className="mt-4 inline-block text-xs text-slate-500 hover:text-white transition-colors">
            ← Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const isOrchestrator = children.length > 0;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left sidebar — chat history */}
      <div className="w-64 shrink-0 border-r border-white/[0.06] bg-white/[0.01] overflow-y-auto">
        <div className="p-3">
          <a
            href={`/chat/${agentId}`}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600/20 to-indigo-600/20 px-3 py-2.5 text-sm text-violet-300 ring-1 ring-violet-500/20 hover:ring-violet-500/40 transition-all duration-200 mb-3"
          >
            <span>+</span> New Chat
          </a>
          <h3 className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2 px-1">History</h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-600 px-1">No previous chats</p>
          ) : (
            <div className="space-y-0.5">
              {history.map((h) => (
                <div key={h.id} className="group relative">
                  <a
                    href={`/chat/${agentId}?resume=${h.id}`}
                    className={`block rounded-xl px-3 py-2 pr-8 text-xs transition-all duration-200 ${
                      h.id === sessionId
                        ? "bg-white/[0.06] text-white ring-1 ring-white/[0.08]"
                        : "text-slate-400 hover:bg-white/[0.04]"
                    }`}
                  >
                    <p className="truncate">{h.title || "Untitled"}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {new Date(h.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </a>
                  <button
                    onClick={(e) => deleteSession(h.id, e)}
                    className="absolute right-2 top-2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label="Delete chat"
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
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${
            isOrchestrator
              ? "bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-violet-500/20"
              : "bg-white/[0.04] ring-1 ring-white/[0.06]"
          }`}>
            {isOrchestrator ? "🎯" : "🤖"}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-white truncate">{agentName}</h1>
            <p className="text-xs text-slate-500 truncate">{agentDescription}</p>
          </div>
          {agentModel && (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
              {agentModel.replace("claude-", "")}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4 px-6">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center animate-fade-in">
              <div className="text-center max-w-md">
                <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-3xl ${
                  isOrchestrator
                    ? "bg-gradient-to-br from-violet-500/10 to-indigo-500/10 ring-1 ring-violet-500/20"
                    : "bg-white/[0.04] ring-1 ring-white/[0.06]"
                }`}>
                  {isOrchestrator ? "🎯" : "🤖"}
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-300">{agentName}</h2>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">{agentDescription}</p>
                <p className="mt-4 text-xs text-slate-600">Type a message or use voice to start chatting</p>
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "delegation") {
              return (
                <div key={msg.id} className="flex justify-center animate-fade-in">
                  <div className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs">
                    <span className="relative h-2 w-2 rounded-full bg-amber-400">
                      <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping" />
                    </span>
                    <span className="text-amber-300 font-medium">Delegating to {msg.agentName}</span>
                    <span className="text-amber-500/70 max-w-xs truncate">— {msg.content}</span>
                  </div>
                </div>
              );
            }

            const isUser = msg.role === "user";
            const isSubAgent = msg.agentName && msg.agentName !== agentName;

            return (
              <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  isUser
                    ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/10"
                    : isSubAgent
                      ? "bg-white/[0.03] text-slate-200 ring-1 ring-amber-500/20"
                      : "bg-white/[0.03] text-slate-200 ring-1 ring-white/[0.06]"
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
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1 text-xs text-slate-400">
                          <span className={tc.status === "running" ? "text-amber-400 animate-pulse" : "text-emerald-400"}>●</span>
                          <span className="font-mono">{tc.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          })}

          {loading && messages.at(-1)?.role === "assistant" && !messages.at(-1)?.content && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-500" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-500" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-500" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] px-6 py-3">
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
                aria-label={isListening ? "Stop listening" : "Start voice input"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                  isListening
                    ? "bg-red-500 voice-pulse text-white"
                    : "bg-white/[0.04] text-slate-400 ring-1 ring-white/[0.06] hover:bg-white/[0.08] hover:text-white"
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
              className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all duration-200 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:brightness-110 transition-all duration-200 disabled:opacity-30 disabled:shadow-none"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar — sub-agents or agent info */}
      <div className="w-64 shrink-0 border-l border-white/[0.06] bg-white/[0.01] overflow-y-auto p-4">
        {isOrchestrator ? (
          <>
            <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Sub-Agents ({children.length})
            </h2>
            <div className="space-y-2">
              {children.map((child) => {
                const isActive = activeChild === child.name;
                return (
                  <div
                    key={child.id}
                    className={`rounded-xl p-3 transition-all duration-300 ${
                      isActive
                        ? "bg-amber-500/5 ring-1 ring-amber-500/30 glow-amber"
                        : "bg-white/[0.02] ring-1 ring-white/[0.04] hover:ring-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="relative h-2 w-2 shrink-0 rounded-full bg-amber-400">
                          <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping" />
                        </span>
                      )}
                      <span className={`text-sm font-medium truncate ${isActive ? "text-amber-300" : "text-slate-300"}`}>
                        {child.name}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{child.description}</p>
                    {isActive && (
                      <span className="mt-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 font-medium ring-1 ring-amber-500/20">
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
            <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">Agent Info</h2>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-wider">Description</p>
                <p className="text-sm text-slate-300 mt-1 leading-relaxed">{agentDescription}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-wider">Model</p>
                <p className="text-sm text-slate-300 mt-1">{agentModel}</p>
              </div>
            </div>
          </>
        )}

        {agentTools.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Tools</h3>
            <div className="flex flex-wrap gap-1.5">
              {agentTools.map((t) => (
                <span key={t} className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-white/[0.06]">{t}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-white/[0.04]">
          <p className="text-[10px] text-slate-700 font-mono">Session: {sessionId?.slice(0, 12)}...</p>
        </div>
      </div>
    </div>
  );
}
