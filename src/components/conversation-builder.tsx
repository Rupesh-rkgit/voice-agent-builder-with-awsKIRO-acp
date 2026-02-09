"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  useBuilderStore,
  parseConfigFromResponse,
  type ExtractedConfig,
} from "@/stores/builder-store";
import { useVoice } from "@/hooks/use-voice";
import { useRouter } from "next/navigation";

export default function ConversationBuilder() {
  const store = useBuilderStore();
  const {
    messages, streaming, streamingText,
    pendingConfig, pendingTeam, createdAgents,
    addMessage, setStreaming, setStreamingText, appendStreamingText,
    setPendingConfig, setPendingTeam, addCreatedAgent, reset,
  } = store;

  const { isListening, transcript, startListening, stopListening, supported } = useVoice();
  const [textInput, setTextInput] = useState("");
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentTranscriptRef = useRef("");
  const router = useRouter();

  // Scroll to bottom on new messages / streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Voice transcript → auto-send when speech ends
  useEffect(() => {
    if (transcript && !isListening && transcript !== sentTranscriptRef.current) {
      sentTranscriptRef.current = transcript;
      handleSend(transcript);
    }
  }, [transcript, isListening]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start listening after assistant finishes (voice-first UX)
  useEffect(() => {
    if (!streaming && messages.length > 0 && supported && !creating && !pendingConfig && !pendingTeam) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        // Small delay so the user hears the response first
        const timer = setTimeout(() => startListening(), 800);
        return () => clearTimeout(timer);
      }
    }
  }, [streaming, messages, supported, creating, pendingConfig, pendingTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendToLLM = useCallback(async (userText: string) => {
    addMessage("user", userText);
    setStreaming(true);
    setStreamingText("");

    // Build history for Bedrock (all messages + this new one)
    const currentMessages = useBuilderStore.getState().messages;
    const history = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/api/builder/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok) {
        const err = await res.json();
        addMessage("assistant", `❌ Error: ${err.error?.message || "Something went wrong"}`);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              addMessage("assistant", `❌ ${parsed.error}`);
              setStreaming(false);
              return;
            }
            if (parsed.text) {
              fullText += parsed.text;
              appendStreamingText(parsed.text);
            }
          } catch { /* skip malformed */ }
        }
      }

      // Parse config from the full response
      const { displayText, config, team } = parseConfigFromResponse(fullText);
      addMessage("assistant", displayText || fullText);
      if (config) setPendingConfig(config);
      if (team) setPendingTeam(team);
    } catch (e) {
      addMessage("assistant", `❌ ${(e as Error).message}`);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }, [addMessage, setStreaming, setStreamingText, appendStreamingText, setPendingConfig, setPendingTeam]);

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setTextInput("");

    // If we have created agents and user wants to navigate
    if (createdAgents.length > 0) {
      const lower = trimmed.toLowerCase();
      if (lower.includes("chat")) {
        router.push(`/chat/${createdAgents[0].id}`);
        return;
      }
      if (lower.includes("dashboard") || lower.includes("home")) {
        router.push("/");
        return;
      }
      if (lower.includes("another") || lower.includes("new")) {
        // Reset ACP builder session on server
        fetch("/api/builder/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset" }),
        }).catch(() => {});
        reset();
        return;
      }
    }

    sendToLLM(trimmed);
  }

  async function createAgent(config: ExtractedConfig, parentId?: string) {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: config.name,
        description: config.description,
        prompt: config.prompt,
        tools: config.tools,
        model: config.model || "claude-sonnet-4",
        parentAgentId: parentId || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Failed to create agent");
    }
    return res.json();
  }

  async function handleConfirmSingle() {
    if (!pendingConfig) return;
    setCreating(true);
    try {
      const meta = await createAgent(pendingConfig);
      addCreatedAgent({ id: meta.id, name: meta.name });
      setPendingConfig(null);
      addMessage("assistant", `✅ Agent **${meta.name}** created! Say "chat" to talk to it, "another" to create more, or "dashboard" to go home.`);
    } catch (e) {
      addMessage("assistant", `❌ ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmTeam() {
    if (!pendingTeam?.length) return;
    setCreating(true);
    try {
      // First one is orchestrator
      const orchConfig = pendingTeam[0];
      const orchMeta = await createAgent(orchConfig);
      addCreatedAgent({ id: orchMeta.id, name: orchMeta.name });

      // Rest are members
      for (const member of pendingTeam.slice(1)) {
        const meta = await createAgent(member, orchMeta.id);
        addCreatedAgent({ id: meta.id, name: meta.name });
      }

      setPendingTeam(null);
      addMessage("assistant", `✅ Team created! ${pendingTeam.length} agents. Say "chat" to talk to the orchestrator, or "dashboard" to go home.`);
    } catch (e) {
      addMessage("assistant", `❌ ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  function handleEdit() {
    setPendingConfig(null);
    setPendingTeam(null);
    sendToLLM("I want to make some changes to the config.");
  }

  // --- Render helpers ---

  function renderMarkdown(text: string) {
    return text.split(/(\*\*.*?\*\*)|(`[^`]+`)/).map((part, i) => {
      if (!part) return null;
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={i} className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-emerald-400">{part.slice(1, -1)}</code>;
      return part;
    });
  }

  function renderConfigCard(config: ExtractedConfig) {
    return (
      <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs font-mono">
        <div className="space-y-1 text-slate-300">
          <div><span className="text-slate-500">name:</span> {config.name}</div>
          <div><span className="text-slate-500">description:</span> {config.description}</div>
          <div><span className="text-slate-500">tools:</span> {config.tools?.join(", ")}</div>
          <div><span className="text-slate-500">model:</span> {config.model}</div>
          <div className="pt-1 border-t border-slate-800">
            <span className="text-slate-500">prompt:</span>
            <p className="mt-1 text-slate-400 whitespace-pre-wrap">{config.prompt}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-violet-600 text-white"
                : "bg-slate-800 text-slate-200 border border-slate-700"
            }`}>
              <p className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</p>
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-slate-800 border border-slate-700 px-4 py-3 text-sm text-slate-200 leading-relaxed">
              {streamingText ? (
                <p className="whitespace-pre-wrap">{renderMarkdown(streamingText)}</p>
              ) : (
                <div className="flex gap-1">
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-violet-400" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending single config */}
        {pendingConfig && !creating && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              {renderConfigCard(pendingConfig)}
              <div className="mt-3 flex gap-2">
                <button onClick={handleConfirmSingle}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                  ✓ Create Agent
                </button>
                <button onClick={handleEdit}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
                  ✎ Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pending team config */}
        {pendingTeam && !creating && (
          <div className="flex justify-start">
            <div className="max-w-[85%] space-y-2">
              {pendingTeam.map((c, i) => (
                <div key={c.name}>
                  <div className="text-xs text-slate-500 mb-1">
                    {i === 0 ? "🎯 Orchestrator" : `👤 Member ${i}`}
                  </div>
                  {renderConfigCard(c)}
                </div>
              ))}
              <div className="mt-3 flex gap-2">
                <button onClick={handleConfirmTeam}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                  ✓ Create Team ({pendingTeam.length} agents)
                </button>
                <button onClick={handleEdit}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
                  ✎ Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Creating spinner */}
        {creating && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-800 border border-slate-700 px-4 py-3 text-sm text-slate-400">
              Creating agents...
              <div className="mt-2 flex gap-1">
                <span className="typing-dot h-2 w-2 rounded-full bg-emerald-400" />
                <span className="typing-dot h-2 w-2 rounded-full bg-emerald-400" />
                <span className="typing-dot h-2 w-2 rounded-full bg-emerald-400" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-slate-800 pt-4">
        {/* Listening indicator */}
        {isListening && (
          <div className="mb-2 flex items-center gap-2 text-xs text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500 voice-pulse" />
            Listening... speak now
          </div>
        )}
        <div className="flex items-center gap-3">
          {supported && (
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={streaming || creating}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                isListening
                  ? "bg-red-500 voice-pulse text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-30"
              }`}
              title={isListening ? "Stop listening" : "Voice input"}
            >
              🎤
            </button>
          )}
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend(textInput)}
            placeholder={isListening ? "Listening..." : "Describe the agent you want to create..."}
            disabled={streaming || creating}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
          />
          <button
            onClick={() => handleSend(textInput)}
            disabled={!textInput.trim() || streaming || creating}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-30"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
