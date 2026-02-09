/**
 * ACP (Agent Client Protocol) client for communicating with kiro-cli.
 *
 * Spawns `kiro-cli acp` as a child process and communicates via
 * JSON-RPC 2.0 over stdin/stdout.
 *
 * Verified against kiro-cli 1.25.0:
 *   - Prompt field is "prompt" (not "content")
 *   - Notifications use method "session/update"
 *   - Update shape: { sessionUpdate: "agent_message_chunk", content: { type, text } }
 *   - Prompt result: { stopReason: "end_turn" }
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

const KIRO_CLI_PATH = process.env.KIRO_CLI_PATH || "kiro-cli";

export interface AcpClientOptions {
  cwd: string;
}

export type SessionUpdate =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; status: string; args?: unknown }
  | { type: "tool_call_update"; name: string; content: string }
  | { type: "turn_end"; stopReason?: string }
  | { type: "error"; message: string }
  | { type: "delegation"; agent: string; task: string; status: "start" | "end" };

export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private _sessionId: string | null = null;

  get sessionId() { return this._sessionId; }
  get processId() { return this.process?.pid ?? -1; }

  async connect(opts: AcpClientOptions): Promise<void> {
    this.process = spawn(KIRO_CLI_PATH, ["acp"], {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr!.on("data", (chunk: Buffer) => {
      console.error("[kiro-acp stderr]", chunk.toString().trim());
    });

    this.process.on("exit", (code) => {
      this.emit("exit", code);
      this.rejectAllPending(new Error(`kiro-cli exited with code ${code}`));
    });

    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: "voice-agent-studio", version: "1.0.0" },
    });
  }

  async createSession(cwd: string): Promise<string> {
    const result = (await this.send("session/new", {
      cwd,
      mcpServers: [],
    })) as { sessionId: string };
    this._sessionId = result.sessionId;
    return result.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    // Field is "prompt" not "content" — verified against kiro-cli 1.25.0
    await this.send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async switchAgent(sessionId: string, agentName: string): Promise<void> {
    await this.send("session/set_mode", { sessionId, modeId: agentName });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.send("session/cancel", { sessionId });
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this._sessionId = null;
    this.rejectAllPending(new Error("Client disconnected"));
  }

  private async send(method: string, params?: unknown): Promise<unknown> {
    if (!this.process?.stdin?.writable) throw new Error("ACP process not connected");

    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.process!.stdin!.write(msg);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if ("id" in msg && msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
          this.handleResponse(msg);
        } else if ("method" in msg) {
          this.handleNotification(msg);
        }
      } catch { /* skip malformed */ }
    }
  }

  private handleResponse(msg: { id: number; result?: unknown; error?: { code: number; message: string } }): void {
    const handler = this.pending.get(msg.id);
    if (!handler) return;
    this.pending.delete(msg.id);
    if (msg.error) handler.reject(new Error(msg.error.message));
    else handler.resolve(msg.result);
  }

  private handleNotification(msg: { method: string; params?: Record<string, unknown> }): void {
    const params = msg.params || {};

    // session/update — the main notification channel for streaming responses
    if (msg.method === "session/update") {
      const update = params.update as Record<string, unknown> | undefined;
      if (!update) return;

      const sessionUpdate = update.sessionUpdate as string;
      let event: SessionUpdate;

      switch (sessionUpdate) {
        case "agent_message_chunk": {
          const content = update.content as { type: string; text: string } | undefined;
          event = { type: "text", content: content?.text || "" };
          break;
        }
        case "tool_use": {
          event = {
            type: "tool_call",
            name: (update.name as string) || "unknown",
            status: (update.status as string) || "running",
            args: update.input,
          };
          break;
        }
        case "tool_result": {
          event = {
            type: "tool_call_update",
            name: (update.name as string) || "unknown",
            content: (update.content as string) || "",
          };
          break;
        }
        default:
          return; // Ignore unknown update types
      }

      this.emit("update", event);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, handler] of this.pending) handler.reject(error);
    this.pending.clear();
  }
}
