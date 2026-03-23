# Part 1: Foundations — Node.js, TypeScript, and Next.js

> This guide explains every concept used in the Voice Agent Studio codebase.
> If you know introductory Node.js, this will take you from there to understanding production-level code.

---

## Table of Contents

1. [How This Project Works — The Big Picture](#1-how-this-project-works--the-big-picture)
2. [Node.js Fundamentals Used Here](#2-nodejs-fundamentals-used-here)
3. [TypeScript — Why and How](#3-typescript--why-and-how)
4. [Next.js App Router — The Framework](#4-nextjs-app-router--the-framework)
5. [Server Components vs Client Components](#5-server-components-vs-client-components)
6. [The Request Lifecycle](#6-the-request-lifecycle)

---

## 1. How This Project Works — The Big Picture

Before diving into code, let's understand what this application actually does:

```
┌──────────────┐     HTTP/SSE      ┌──────────────────┐    stdio/JSON-RPC    ┌───────────┐
│   Browser    │ ◄──────────────► │  Next.js Server   │ ◄──────────────────► │ kiro-cli  │
│   (React)    │                   │  (API Routes)     │                      │   (ACP)   │
└──────────────┘                   └──────────────────┘                      └───────────┘
```

**In plain English:**
1. You open a web page in your browser (React frontend)
2. The browser talks to a Next.js server (running on your machine)
3. The Next.js server talks to `kiro-cli` (an AI tool) using a protocol called ACP
4. `kiro-cli` talks to Claude (the AI model) and sends responses back
5. The responses stream back through the server to your browser in real-time

**The three main things this app does:**
- **Create AI agents** — through a conversational builder (you describe what you want, AI builds the config)
- **Chat with agents** — send messages, get streaming responses, agents can delegate to sub-agents
- **Manage agents** — CRUD operations (Create, Read, Update, Delete) on agent configurations

---

## 2. Node.js Fundamentals Used Here

### 2.1 What is Node.js?

Node.js lets you run JavaScript on your computer (not just in a browser). It's built on Chrome's V8 engine.

**Why it matters for this project:** Our Next.js server runs on Node.js. All the backend code (database, file system, spawning processes) uses Node.js APIs.

### 2.2 Modules and Imports

This project uses **ES Modules** (the modern way). You'll see two styles:

```typescript
// Named imports — grab specific things from a module
import { spawn, exec, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

// Default import — grab the main export
import Database from "better-sqlite3";

// Type-only import — only used for TypeScript types, removed at runtime
import type { NextConfig } from "next";
```

**Key concept: `import` vs `require`**
- `import` = ES Modules (what this project uses). Static, analyzed at build time.
- `require` = CommonJS (older style). Dynamic, runs at runtime.
- Next.js and TypeScript prefer `import`.

### 2.3 The `path` Module

Used everywhere in this project for file path manipulation:

```typescript
import path from "path";

// path.join() — combines path segments with the correct separator (/ on Linux, \ on Windows)
const DB_DIR = path.join(process.env.KIRO_WORKSPACE_DIR || process.cwd(), ".kiro");
// If KIRO_WORKSPACE_DIR = "/home/user/project"
// Result: "/home/user/project/.kiro"

// path.resolve() — creates an absolute path (resolves relative paths)
const resolved = path.resolve(AGENTS_DIR, `${name}.json`);
// If AGENTS_DIR = "/home/user/project/.kiro/agents" and name = "my-agent"
// Result: "/home/user/project/.kiro/agents/my-agent.json"

// path.dirname() — gets the directory part of a path
const dir = path.dirname("/home/user/project/file.txt");
// Result: "/home/user/project"

// path.sep — the path separator for the current OS
// On Linux: "/"
// On Windows: "\\"
```

**Where it's used in our code:**
```typescript
// From src/lib/db/chat-history.ts
const DB_DIR = path.join(
  process.env.KIRO_WORKSPACE_DIR || process.cwd(),
  ".kiro"
);
const DB_PATH = path.join(DB_DIR, "chat-history.db");
```

This builds the path to the SQLite database file. `process.cwd()` returns the current working directory (where you ran `npm run dev` from).

### 2.4 The `fs` Module (File System)

Two versions are used:

```typescript
// Synchronous fs — blocks the thread until done
import fs from "fs";
fs.mkdirSync(DB_DIR, { recursive: true });  // Create directory, wait until done
fs.readFile(safe, "utf-8", (err, content) => { ... });  // Async with callback

// Promise-based fs — returns Promises (used with async/await)
import fs from "fs/promises";
await fs.readFile(INDEX_FILE, "utf-8");  // Returns a Promise
await fs.writeFile(configPath, JSON.stringify(config, null, 2));
await fs.mkdir(AGENTS_DIR, { recursive: true });
await fs.unlink(oldPath);  // Delete a file
await fs.access(configPath);  // Check if file exists (throws if not)
```

**`{ recursive: true }` explained:**
```typescript
fs.mkdirSync("/a/b/c/d", { recursive: true });
// Creates ALL directories in the path: /a, /a/b, /a/b/c, /a/b/c/d
// Without recursive: true, it would fail if /a/b/c doesn't exist
```

### 2.5 `process` — The Global Node.js Object

```typescript
// Environment variables — configuration values set outside the code
process.env.KIRO_CLI_PATH     // "/usr/bin/kiro-cli"
process.env.AWS_REGION         // "us-east-1"
process.env.MAX_ACP_SESSIONS   // "10"

// Current working directory
process.cwd()  // "/home/user/voice-agent-studio"

// Process signals — OS-level events
process.on("SIGTERM", closeDb);  // Sent when process is asked to terminate
process.on("SIGINT", closeDb);   // Sent when you press Ctrl+C

// Node.js version
process.version  // "v20.11.0"
```

**Why we listen for SIGTERM/SIGINT:**
When you stop the server (Ctrl+C or deployment shutdown), we need to:
1. Close the SQLite database properly (prevent corruption)
2. Kill all kiro-cli child processes (prevent zombie processes)

```typescript
// From chat-history.ts
process.on("SIGTERM", closeDb);
process.on("SIGINT", closeDb);

// From session-manager.ts
function shutdown() {
  console.log("[session-manager] Shutting down, destroying all sessions...");
  sessionManager.destroyAll().catch(() => {});
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

### 2.6 Child Processes — `spawn` and `exec`

This is how our server talks to `kiro-cli`:

```typescript
import { spawn, exec, type ChildProcess } from "child_process";

// spawn() — starts a long-running process, streams data
const child = spawn("kiro-cli", ["acp"], {
  cwd: opts.cwd,                    // Working directory for the child
  stdio: ["pipe", "pipe", "pipe"],  // stdin, stdout, stderr — all piped to us
  env: { ...process.env },          // Pass all environment variables
});

// Now we can:
child.stdin.write("hello\n");           // Send data TO the process
child.stdout.on("data", (chunk) => {}); // Receive data FROM the process
child.stderr.on("data", (chunk) => {}); // Receive error output
child.on("exit", (code) => {});         // Know when it exits
child.kill("SIGTERM");                  // Kill the process

// exec() — runs a command and returns all output at once
exec(command, { timeout: 60000 }, (err, stdout, stderr) => {
  // stdout = all standard output as a string
  // stderr = all error output as a string
  // err = null if success, Error if failed
});
```

**`stdio: ["pipe", "pipe", "pipe"]` explained:**

Each process has 3 standard streams:
- `stdin` (index 0) — input to the process
- `stdout` (index 1) — output from the process
- `stderr` (index 2) — error output from the process

`"pipe"` means: "create a pipe so our Node.js code can read/write to this stream."

Other options: `"inherit"` (share with parent), `"ignore"` (discard).

### 2.7 EventEmitter — The Observer Pattern

```typescript
import { EventEmitter } from "events";

// EventEmitter lets objects emit named events that others can listen to
class AcpClient extends EventEmitter {
  // Inside the class, emit events:
  this.emit("update", event);   // Fire the "update" event with data
  this.emit("exit", code);      // Fire the "exit" event

  // Outside, listen for events:
  client.on("update", (data) => { ... });      // Listen for "update"
  client.on("exit", (code) => { ... });        // Listen for "exit"
  client.removeListener("update", handler);     // Stop listening
  client.removeAllListeners("update");          // Remove ALL listeners for "update"
}
```

**Why this pattern?**
The ACP client receives streaming data from kiro-cli. We don't know WHEN data will arrive. EventEmitter lets us say "call this function whenever new data arrives" — this is the **Observer Pattern**.

**Real-world analogy:** It's like subscribing to a YouTube channel. You don't check every second — you get notified when there's a new video.

### 2.8 Promises and async/await

Almost all our backend code uses async/await:

```typescript
// A Promise represents a value that will be available in the future
// async/await is syntactic sugar to work with Promises

// WITHOUT async/await (callback hell):
fs.readFile("file.txt", (err, data) => {
  if (err) { handleError(err); return; }
  JSON.parse(data, (err2, parsed) => {
    if (err2) { handleError(err2); return; }
    doSomething(parsed);
  });
});

// WITH async/await (clean and readable):
async function loadConfig() {
  const data = await fs.readFile("file.txt", "utf-8");
  const parsed = JSON.parse(data);
  return doSomething(parsed);
}

// Error handling with try/catch:
try {
  const result = await riskyOperation();
} catch (e) {
  console.error("Failed:", (e as Error).message);
}
```

**The `(e as Error).message` pattern:**
TypeScript's `catch` clause types `e` as `unknown` (could be anything). We use `as Error` to tell TypeScript "trust me, this is an Error object" so we can access `.message`.

### 2.9 The `Map` Data Structure

Used for the session pool:

```typescript
// Map is like an object but better for dynamic keys
const sessions = new Map<string, ManagedSession>();

sessions.set("abc-123", { client, sessionId: "abc-123", ... });  // Add
sessions.get("abc-123");   // Retrieve — returns undefined if not found
sessions.has("abc-123");   // Check existence — returns boolean
sessions.delete("abc-123"); // Remove
sessions.size;              // Number of entries
sessions.values();          // Iterator of all values

// Iterate over all entries
for (const [key, value] of sessions) {
  console.log(key, value);
}
for (const session of sessions.values()) {
  console.log(session);
}
```

**Map vs Object:**
- Map keys can be any type (not just strings)
- Map preserves insertion order
- Map has `.size` (objects don't)
- Map is better for frequent additions/deletions
- Map doesn't have prototype pollution issues

---

## 3. TypeScript — Why and How

### 3.1 What TypeScript Adds

TypeScript = JavaScript + Types. It catches bugs at compile time instead of runtime.

```typescript
// JavaScript — no types, bugs found at runtime
function add(a, b) { return a + b; }
add("hello", 5);  // "hello5" — probably not what you wanted!

// TypeScript — types catch this at compile time
function add(a: number, b: number): number { return a + b; }
add("hello", 5);  // ❌ Compile error: Argument of type 'string' is not assignable to 'number'
```

### 3.2 Type Annotations Used in This Project

```typescript
// Basic types
const name: string = "my-agent";
const count: number = 10;
const active: boolean = true;
const items: string[] = ["read", "write"];

// Object types (interfaces)
interface SessionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;  // Can be string OR null
}

// Optional properties (?)
interface ChatSession {
  id: string;
  messageCount?: number;   // This property might not exist
  lastMessage?: string;    // This property might not exist
}

// Function types
function saveMessage(
  sessionId: string,       // Required parameter
  role: string,            // Required parameter
  content: string,         // Required parameter
  agentName?: string       // Optional parameter (note the ?)
): void {                  // Return type: void (returns nothing)
  // ...
}

// Generic types — types that work with any type
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  // T is a placeholder — it becomes whatever type the function returns
  // If fn returns Promise<AgentMeta>, then T = AgentMeta
  // If fn returns Promise<boolean>, then T = boolean
}
```

### 3.3 Union Types and Discriminated Unions

This is a powerful pattern used for the `SessionUpdate` type:

```typescript
// Union type — a value can be one of several types
export type SessionUpdate =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; status: string; args?: unknown }
  | { type: "tool_call_update"; name: string; content: string }
  | { type: "turn_end"; stopReason?: string }
  | { type: "error"; message: string }
  | { type: "delegation"; agent: string; task: string; status: "start" | "end" };
```

**How this works:**
- A `SessionUpdate` can be ANY of these shapes
- The `type` field is the **discriminator** — it tells you which shape you have
- TypeScript narrows the type when you check `type`:

```typescript
function handleUpdate(update: SessionUpdate) {
  if (update.type === "text") {
    // TypeScript KNOWS update has .content (string) here
    console.log(update.content);
  } else if (update.type === "tool_call") {
    // TypeScript KNOWS update has .name and .status here
    console.log(update.name, update.status);
  }
}
```

### 3.4 Type Inference with Zod

Zod is a validation library that also generates TypeScript types:

```typescript
import { z } from "zod";

// Define a schema (validation rules)
const KiroAgentConfigSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1),
  tools: z.array(z.string()).default(["read", "write"]),
  model: z.string().default("claude-sonnet-4"),
});

// Extract the TypeScript type FROM the schema
type KiroAgentConfig = z.infer<typeof KiroAgentConfigSchema>;
// This is equivalent to writing:
// type KiroAgentConfig = {
//   name: string;
//   description: string;
//   prompt: string;
//   tools: string[];
//   model: string;
// }

// Validate data at runtime
const config = KiroAgentConfigSchema.parse(userInput);
// If userInput is valid → returns typed object
// If userInput is invalid → throws ZodError with details
```

**Why this is powerful:** You define validation rules ONCE and get both runtime validation AND compile-time types. No duplication.

### 3.5 The `as` Keyword (Type Assertions)

```typescript
// Sometimes TypeScript can't figure out the type
const rows = db.prepare(query).all(limit) as SessionRow[];
// We tell TypeScript: "I know this returns SessionRow[]"

// Common pattern for error handling:
catch (e) {
  // e is 'unknown' — TypeScript doesn't know what it is
  console.error((e as Error).message);
  // We assert it's an Error to access .message

  // Safer alternative:
  if (e instanceof Error) {
    console.error(e.message);  // TypeScript knows it's Error here
  }
}

// Node.js error codes:
if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
  // ENOENT = "Error NO ENTry" = file not found
  // We check the error code to handle "file not found" differently
}
```

---

## 4. Next.js App Router — The Framework

### 4.1 What is Next.js?

Next.js is a React framework that adds:
- **Server-side rendering** — pages can render on the server (faster initial load)
- **File-based routing** — folder structure = URL structure
- **API routes** — backend endpoints alongside frontend code
- **Automatic code splitting** — only loads JavaScript needed for each page

### 4.2 File-Based Routing

The folder structure under `src/app/` directly maps to URLs:

```
src/app/
├── page.tsx                    → http://localhost:3000/
├── layout.tsx                  → Wraps ALL pages (header, footer)
├── globals.css                 → Global styles
├── agents/
│   ├── page.tsx                → http://localhost:3000/agents
│   ├── new/
│   │   └── page.tsx            → http://localhost:3000/agents/new
│   └── [id]/
│       └── page.tsx            → http://localhost:3000/agents/abc-123
├── chat/
│   └── [agentId]/
│       └── page.tsx            → http://localhost:3000/chat/abc-123
├── history/
│   └── page.tsx                → http://localhost:3000/history
└── api/
    ├── agents/
    │   ├── route.ts            → GET/POST http://localhost:3000/api/agents
    │   ├── [id]/
    │   │   └── route.ts        → GET/PUT/DELETE http://localhost:3000/api/agents/abc-123
    │   ├── confirm/
    │   │   └── route.ts        → POST http://localhost:3000/api/agents/confirm
    │   ├── from-voice/
    │   │   └── route.ts        → POST http://localhost:3000/api/agents/from-voice
    │   └── templates/
    │       └── route.ts        → GET http://localhost:3000/api/agents/templates
    ├── builder/
    │   └── chat/
    │       └── route.ts        → POST http://localhost:3000/api/builder/chat
    ├── chat/
    │   ├── session/
    │   │   └── route.ts        → POST http://localhost:3000/api/chat/session
    │   ├── prompt/
    │   │   └── route.ts        → POST http://localhost:3000/api/chat/prompt
    │   └── history/
    │       └── route.ts        → GET/DELETE http://localhost:3000/api/chat/history
    └── health/
        └── route.ts            → GET http://localhost:3000/api/health
```

**Key rules:**
- `page.tsx` = a page (renders UI)
- `route.ts` = an API endpoint (returns data)
- `layout.tsx` = wraps child pages (shared UI like headers)
- `[id]` = dynamic segment (captures a URL parameter)
- `(group)` = route group (organizes files without affecting URL)

### 4.3 Dynamic Routes — The `[id]` Pattern

```typescript
// File: src/app/agents/[id]/page.tsx
// URL: /agents/abc-123-def-456

// In Next.js 16, params is a Promise (async)
export default async function AgentDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;
  // id = "abc-123-def-456" (from the URL)
  const agent = await getAgent(id);
  if (!agent) notFound();  // Shows 404 page
  // ...
}
```

**Why `params` is a Promise in Next.js 16:**
This is a new change. In older versions, params was a plain object. Now it's async to support streaming and partial rendering. You must `await` it.

### 4.4 API Routes — `route.ts` Files

API routes export functions named after HTTP methods:

```typescript
// src/app/api/agents/route.ts

import { NextRequest, NextResponse } from "next/server";

// GET /api/agents — list all agents
export async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents });
  // Returns: { "agents": [...] } with Content-Type: application/json
}

// POST /api/agents — create a new agent
export async function POST(req: NextRequest) {
  const body = await req.json();  // Parse JSON body
  // ... validate and create
  return NextResponse.json(meta, { status: 201 });
  // Returns with HTTP 201 Created
}
```

**HTTP Methods explained:**
- `GET` — Read data (list agents, get agent details)
- `POST` — Create something new (create agent, start session)
- `PUT` — Update existing data (update agent config)
- `DELETE` — Remove data (delete agent, delete chat session)

**HTTP Status Codes used in this project:**
- `200` — OK (default for successful responses)
- `201` — Created (something new was created)
- `204` — No Content (success, but nothing to return — used for DELETE)
- `400` — Bad Request (invalid input from the client)
- `404` — Not Found (agent/session doesn't exist)
- `409` — Conflict (agent name already exists)
- `500` — Internal Server Error (something broke on the server)
- `503` — Service Unavailable (kiro-cli not reachable)

---

## 5. Server Components vs Client Components

### 5.1 The Two Worlds

Next.js App Router has two types of components:

**Server Components (default):**
- Run on the server only
- Can directly access databases, file system, environment variables
- Cannot use `useState`, `useEffect`, event handlers
- Their code is never sent to the browser
- Faster initial load

**Client Components:**
- Run in the browser (and initially on server for SSR)
- Can use React hooks (`useState`, `useEffect`, etc.)
- Can handle user interactions (clicks, typing)
- Must be marked with `"use client"` at the top

### 5.2 Examples from Our Codebase

**Server Component — `src/app/page.tsx` (Dashboard):**
```typescript
// No "use client" directive — this is a Server Component
import { listAgents } from "@/lib/agents/config-service";
import { getRecentChats } from "@/lib/db/chat-history";

export default async function HomePage() {
  // These run on the SERVER — direct database/file access!
  const agents = await listAgents();        // Reads files from disk
  const recentChats = getRecentChats(5);    // Queries SQLite directly

  return <div>...</div>;  // HTML is generated on the server
}
```

**Client Component — `src/app/chat/[agentId]/page.tsx`:**
```typescript
"use client";  // ← This makes it a Client Component

import { useState, useRef, useEffect } from "react";

export default function ChatPage() {
  const [messages, setMessages] = useState([]);  // React state
  const [input, setInput] = useState("");

  // This runs in the BROWSER
  async function sendMessage(text: string) {
    const res = await fetch("/api/chat/prompt", { ... });
    // fetch() calls our API route from the browser
  }

  return <input onChange={(e) => setInput(e.target.value)} />;
}
```

**Key insight:** Server Components can import and render Client Components, but not vice versa. Data flows from server → client.

### 5.3 `export const dynamic = "force-dynamic"`

```typescript
export const dynamic = "force-dynamic";
```

This tells Next.js: "Don't cache this page. Always re-render it on every request."

Without this, Next.js might cache the page at build time and serve stale data. Since our agent list and chat history change frequently, we need fresh data every time.

---

## 6. The Request Lifecycle

Let's trace what happens when you open the dashboard:

### Step 1: Browser requests `http://localhost:3000/`

### Step 2: Next.js matches `src/app/page.tsx`

### Step 3: Server Component executes:
```typescript
const agents = await listAgents();      // Reads .agent-index.json from disk
const recentChats = getRecentChats(5);  // Queries SQLite
```

### Step 4: React renders the JSX to HTML on the server

### Step 5: HTML is sent to the browser (fast initial paint)

### Step 6: React "hydrates" — makes the HTML interactive

---

Now let's trace a chat message:

### Step 1: User types "Hello" and presses Enter

### Step 2: Client Component calls:
```typescript
const res = await fetch("/api/chat/prompt", {
  method: "POST",
  body: JSON.stringify({ sessionId: "abc", message: "Hello" }),
});
```

### Step 3: Next.js matches `src/app/api/chat/prompt/route.ts` → `POST` function

### Step 4: Server validates input, finds the ACP session

### Step 5: Server sends the message to kiro-cli via JSON-RPC over stdin

### Step 6: kiro-cli sends streaming responses back via stdout

### Step 7: Server converts these to SSE (Server-Sent Events) and streams to browser

### Step 8: Browser reads the stream and updates the UI in real-time

---

## Key Takeaways

1. **Node.js** provides the runtime — file system, child processes, networking
2. **TypeScript** adds type safety — catches bugs before they happen
3. **Next.js App Router** provides the structure — file-based routing, server/client split
4. **Server Components** handle data fetching — direct DB/file access
5. **Client Components** handle interactivity — state, effects, user input
6. **API Routes** are the bridge — browser ↔ server communication

---

**Next up: Part 2 — Project Configuration**

---
---


---

## Table of Contents

1. [package.json — The Project Manifest](#1-packagejson--the-project-manifest)
2. [tsconfig.json — TypeScript Configuration](#2-tsconfigjson--typescript-configuration)
3. [next.config.ts — Next.js Configuration](#3-nextconfigts--nextjs-configuration)
4. [postcss.config.mjs — CSS Processing](#4-postcssconfigmjs--css-processing)
5. [eslint.config.mjs — Code Linting](#5-eslintconfigmjs--code-linting)
6. [.env.example — Environment Variables](#6-envexample--environment-variables)
7. [.nvmrc — Node Version](#7-nvmrc--node-version)
8. [next-env.d.ts — TypeScript Declarations](#8-next-envdts--typescript-declarations)
9. [globals.css — Global Styles and Tailwind](#9-globalscss--global-styles-and-tailwind)

---

## 1. package.json — The Project Manifest

This is the most important config file. It tells Node.js everything about your project.

```json
{
  "name": "voice-agent-studio",
  "version": "0.1.0",
  "private": true,
```

- `"name"` — The project name. Used by npm if you ever publish it.
- `"version"` — Semantic versioning: `MAJOR.MINOR.PATCH`. `0.1.0` means "pre-release, first minor version."
- `"private": true` — **Prevents accidental publishing to npm.** Without this, running `npm publish` would upload your code to the public npm registry. Always set this for private projects.

```json
  "engines": {
    "node": ">=20.0.0 <21.0.0"
  },
```

**`engines`** — Declares which Node.js version this project requires. Here: Node 20.x only (not 19, not 21+). This is a hint — npm will warn (not error) if you use the wrong version. The `predev` script enforces it more strictly.

```json
  "scripts": {
    "predev": "node -e \"const v=parseInt(process.version.slice(1));if(v!==20){console.error('\\n\\x1b[31m✖ Node '+process.version+' detected. This project requires Node 20.\\n  Run: nvm use\\x1b[0m\\n');process.exit(1)}\"",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
```

**Scripts** are commands you run with `npm run <name>`:

- **`predev`** — Runs automatically BEFORE `dev` (the `pre` prefix is magic in npm). It's a one-liner that checks if you're using Node 20. If not, it prints a red error and exits.

  Let's break down that one-liner:
  ```javascript
  const v = parseInt(process.version.slice(1));
  // process.version = "v20.11.0"
  // .slice(1) = "20.11.0" (removes the "v")
  // parseInt() = 20 (takes the first number)

  if (v !== 20) {
    console.error('\n\x1b[31m✖ Node ' + process.version + ' detected...\x1b[0m\n');
    // \x1b[31m = ANSI escape code for RED text
    // \x1b[0m = ANSI escape code to RESET color
    process.exit(1);  // Exit with error code 1 (non-zero = failure)
  }
  ```

- **`dev`** → `next dev` — Starts the development server with hot reload (changes appear instantly)
- **`build`** → `next build` — Creates an optimized production build
- **`start`** → `next start` — Runs the production build
- **`lint`** → `eslint` — Checks code for style/quality issues

### Dependencies vs DevDependencies

```json
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.985.0",
    "@aws-sdk/client-polly": "^3.985.0",
    "@aws-sdk/client-transcribe-streaming": "^3.985.0",
    "better-sqlite3": "^12.6.2",
    "next": "16.1.6",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "uuid": "^13.0.0",
    "zod": "^4.3.6",
    "zustand": "^5.0.11"
  },
```

**`dependencies`** — Packages needed at RUNTIME (in production). Installed with `npm install`.

| Package | What it does | Where it's used |
|---------|-------------|-----------------|
| `@aws-sdk/client-bedrock-runtime` | Talk to AWS Bedrock (AI models) | `converse-bedrock.ts` (backup LLM provider) |
| `@aws-sdk/client-polly` | Text-to-speech via AWS Polly | `voice/synthesize/route.ts` |
| `@aws-sdk/client-transcribe-streaming` | Speech-to-text via AWS Transcribe | `voice/transcribe/route.ts` |
| `better-sqlite3` | SQLite database driver (C++ native addon) | `chat-history.ts` |
| `next` | The Next.js framework | Everything |
| `react` / `react-dom` | React UI library | All components |
| `uuid` | Generate unique IDs (UUIDs) | `config-service.ts` (agent IDs) |
| `zod` | Runtime validation + TypeScript types | `schema.ts` (all validation) |
| `zustand` | Lightweight state management | `builder-store.ts` |

**Version syntax:**
- `"16.1.6"` — Exact version (no caret). Only this version.
- `"^3.985.0"` — Compatible updates. Allows `3.985.0` to `3.999.999` but NOT `4.0.0`.
- `"^12.6.2"` — Allows `12.6.2` to `12.999.999` but NOT `13.0.0`.

The `^` (caret) means "allow minor and patch updates, but not major." Major versions can have breaking changes.

```json
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/uuid": "^11.0.0",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
```

**`devDependencies`** — Only needed during development. NOT included in production builds.

| Package | What it does |
|---------|-------------|
| `@tailwindcss/postcss` | Tailwind CSS integration with PostCSS |
| `@types/*` | TypeScript type definitions for JavaScript libraries |
| `eslint` + `eslint-config-next` | Code linting (finds bugs and style issues) |
| `tailwindcss` | Utility-first CSS framework |
| `typescript` | The TypeScript compiler |

**Why `@types/*` packages?**
Libraries like `better-sqlite3` and `uuid` are written in JavaScript. They don't have built-in TypeScript types. The `@types/*` packages provide type definitions so TypeScript knows what functions exist and what types they accept/return.

---

## 2. tsconfig.json — TypeScript Configuration

This tells the TypeScript compiler how to behave:

```json
{
  "compilerOptions": {
    "target": "ES2017",
```

**`target`** — What JavaScript version to compile to. `ES2017` supports `async/await` natively. TypeScript converts newer syntax to work with this target.

```json
    "lib": ["dom", "dom.iterable", "esnext"],
```

**`lib`** — Which built-in type definitions to include:
- `"dom"` — Browser APIs (`document`, `window`, `fetch`, `HTMLElement`)
- `"dom.iterable"` — Iterable DOM collections (`NodeList.forEach()`)
- `"esnext"` — Latest JavaScript features (`Promise`, `Map`, `Set`, `Array.at()`)

We need `dom` because our client components run in the browser.

```json
    "allowJs": true,
```

**`allowJs`** — Allow `.js` files alongside `.ts` files. Useful for gradual migration or config files.

```json
    "skipLibCheck": true,
```

**`skipLibCheck`** — Don't type-check declaration files (`.d.ts`) from `node_modules`. This speeds up compilation significantly. If a library has type errors, we don't care — we trust the library authors.

```json
    "strict": true,
```

**`strict`** — Enables ALL strict type-checking options at once:
- `strictNullChecks` — `null` and `undefined` are distinct types (can't assign `null` to `string`)
- `noImplicitAny` — Must declare types (no implicit `any`)
- `strictFunctionTypes` — Stricter function parameter checking
- And more...

This is the most important setting. It catches the most bugs.

```json
    "noEmit": true,
```

**`noEmit`** — TypeScript only checks types, doesn't output JavaScript files. Next.js handles the actual compilation with its own bundler (Turbopack/SWC). TypeScript is just the type checker.

```json
    "esModuleInterop": true,
```

**`esModuleInterop`** — Allows `import fs from "fs"` instead of `import * as fs from "fs"`. Makes CommonJS modules (like `fs`) work with ES Module import syntax.

```json
    "module": "esnext",
    "moduleResolution": "bundler",
```

- **`module`** — Use ES Modules (`import`/`export`), not CommonJS (`require`/`module.exports`)
- **`moduleResolution: "bundler"`** — Resolve imports the way modern bundlers (Webpack, Turbopack) do. This supports `package.json` `exports` field and other modern features.

```json
    "resolveJsonModule": true,
```

**`resolveJsonModule`** — Allows `import data from "./file.json"`. TypeScript will infer types from the JSON structure.

```json
    "isolatedModules": true,
```

**`isolatedModules`** — Each file must be compilable on its own (no cross-file type dependencies that require whole-program analysis). Required by Next.js because it compiles files individually for speed.

```json
    "jsx": "react-jsx",
```

**`jsx`** — How to handle JSX syntax (`<div>`, `<Component />`):
- `"react-jsx"` — Uses the new JSX transform (React 17+). You don't need `import React from "react"` in every file.

```json
    "incremental": true,
```

**`incremental`** — Cache type-checking results between runs. Makes subsequent `tsc` runs faster by only re-checking changed files. Creates `tsconfig.tsbuildinfo`.

```json
    "plugins": [
      { "name": "next" }
    ],
```

**`plugins`** — The Next.js TypeScript plugin. Provides:
- Type-safe routing (knows which routes exist)
- Validates `page.tsx` and `layout.tsx` exports
- Checks Server/Client Component boundaries

```json
    "paths": {
      "@/*": ["./src/*"]
    }
```

**`paths`** — Import aliases. Instead of relative paths:
```typescript
// Without alias (ugly, fragile):
import { listAgents } from "../../../lib/agents/config-service";

// With alias (clean, stable):
import { listAgents } from "@/lib/agents/config-service";
```

`@/*` maps to `./src/*`, so `@/lib/agents/schema` → `./src/lib/agents/schema`.

```json
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
```

- **`include`** — Which files TypeScript should check. `**/*.ts` means "all `.ts` files in all subdirectories."
- **`exclude`** — Skip `node_modules` (thousands of files we don't own).

---

## 3. next.config.ts — Next.js Configuration

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

This is surprisingly minimal. Let's understand the one setting:

**`serverExternalPackages: ["better-sqlite3"]`**

This is critical. `better-sqlite3` is a **native C++ addon** — it's compiled machine code, not JavaScript. Next.js's bundler (Turbopack) can't bundle native addons. This setting tells Next.js: "Don't try to bundle `better-sqlite3`. Load it directly from `node_modules` at runtime."

Without this, you'd get a build error like:
```
Error: Cannot find module 'better-sqlite3'
```

**Why `import type { NextConfig }`?**
The `type` keyword means this import is only for TypeScript type checking. It's completely removed at runtime. We only need the `NextConfig` type to get autocomplete and validation for our config object.

---

## 4. postcss.config.mjs — CSS Processing

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

**PostCSS** is a CSS transformation tool. It processes your CSS files through plugins.

**`@tailwindcss/postcss`** — This plugin does two things:
1. Processes Tailwind CSS directives (like `@import "tailwindcss"`)
2. Generates utility classes based on what you actually use in your code

**Why `.mjs` extension?**
`.mjs` = ES Module JavaScript. It tells Node.js to treat this file as an ES Module (using `export default`) rather than CommonJS (using `module.exports`).

**How Tailwind 4 works (different from v3):**
In Tailwind CSS 4, you don't need a `tailwind.config.js` file. Configuration is done in CSS:
```css
/* globals.css */
@import "tailwindcss";
```
That single line imports all of Tailwind's utility classes. Tailwind 4 auto-detects your source files and only generates CSS for classes you actually use.

---

## 5. eslint.config.mjs — Code Linting

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

**ESLint** checks your code for common mistakes and enforces style rules.

- **`defineConfig()`** — Helper that provides type checking for the config
- **`...nextVitals`** — Spread operator. Includes all rules from Next.js's "core web vitals" preset (performance rules)
- **`...nextTs`** — Includes TypeScript-specific rules
- **`globalIgnores()`** — Don't lint these files/folders:
  - `.next/` — Build output (generated code)
  - `out/` — Static export output
  - `build/` — Build artifacts
  - `next-env.d.ts` — Auto-generated by Next.js

**ESLint 9 flat config:**
This uses ESLint 9's new "flat config" format (arrays instead of nested objects). Older projects use `.eslintrc.json` — this is the modern replacement.

---

## 6. .env.example — Environment Variables

Environment variables configure the app without changing code. `.env.example` is a template — you copy it to `.env.local` and fill in real values.

```bash
# ============================================
# KIRO CLI
# ============================================
KIRO_CLI_PATH=/usr/bin/kiro-cli
KIRO_WORKSPACE_DIR=./
```

- **`KIRO_CLI_PATH`** — Where the `kiro-cli` binary is installed. Used by `AcpClient` to spawn the process:
  ```typescript
  const KIRO_CLI_PATH = process.env.KIRO_CLI_PATH || "kiro-cli";
  spawn(KIRO_CLI_PATH, ["acp"], { ... });
  ```
- **`KIRO_WORKSPACE_DIR`** — The project root. Used to find `.kiro/agents/` and `.kiro/chat-history.db`.

```bash
# ============================================
# AWS CREDENTIALS (use ONE of these methods)
# ============================================
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

Two authentication methods for AWS services:
1. **Bearer token** — For Bedrock API key / SSO. Injected as `Authorization: Bearer <token>` header.
2. **IAM access keys** — Traditional AWS credentials. Used by the AWS SDK automatically.

```bash
# ============================================
# VOICE PROVIDER
# ============================================
VOICE_PROVIDER=auto
```

Controls which voice engine to use:
- `auto` — Try AWS Transcribe+Polly first, fall back to browser's Web Speech API
- `aws` — Force AWS only (fails if no credentials)
- `webspeech` — Skip AWS, use browser APIs only

```bash
# ============================================
# APP
# ============================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
MAX_ACP_SESSIONS=10
```

- **`NEXT_PUBLIC_APP_URL`** — The `NEXT_PUBLIC_` prefix is special in Next.js. It means this variable is available in BOTH server and client code. Variables without this prefix are server-only (for security).
- **`MAX_ACP_SESSIONS`** — Maximum concurrent kiro-cli processes. Each chat session spawns one process. Used in `session-manager.ts`:
  ```typescript
  const MAX_SESSIONS = parseInt(process.env.MAX_ACP_SESSIONS || "10", 10);
  ```

**How `.env` files work in Next.js:**
- `.env` — Default values (committed to git)
- `.env.local` — Local overrides (gitignored — contains secrets)
- `.env.development` — Only in `npm run dev`
- `.env.production` — Only in `npm run build` / `npm start`

Priority: `.env.local` > `.env.development` > `.env`

---

## 7. .nvmrc — Node Version

```
20
```

One line. Tells **nvm** (Node Version Manager) which Node.js version to use. When you run `nvm use` in this directory, it reads this file and switches to Node 20.

**Why pin Node 20?**
- `better-sqlite3` compiles native C++ code. Different Node versions have different native APIs.
- Node 20 is the LTS (Long Term Support) version — stable and well-tested.
- The `predev` script in `package.json` enforces this at runtime.

---

## 8. next-env.d.ts — TypeScript Declarations

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/dev/types/routes.d.ts";

// NOTE: This file should not be edited
```

**Triple-slash directives** (`///`) are TypeScript's way of including type definitions:
- `/// <reference types="next" />` — Include Next.js's type definitions (makes `NextRequest`, `NextResponse`, etc. available)
- `/// <reference types="next/image-types/global" />` — Type definitions for image imports

**This file is auto-generated by Next.js.** Don't edit it. It's regenerated every time you run `next dev` or `next build`.

---

## 9. globals.css — Global Styles and Tailwind

This file defines the visual theme for the entire application. Let's break it down:

```css
@import "tailwindcss";
```

**This single line imports Tailwind CSS 4.** It makes all utility classes available (`bg-white`, `text-sm`, `flex`, etc.). In Tailwind 4, this replaces the old `@tailwind base; @tailwind components; @tailwind utilities;` directives.

### CSS Custom Properties (Variables)

```css
:root {
  --background: #06060b;
  --foreground: #f1f5f9;
  --card: #0d1117;
  --card-border: #1e293b;
  --muted: #94a3b8;
  --accent: #8b5cf6;
  --accent-hover: #7c3aed;
  --success: #10b981;
  --danger: #ef4444;
}
```

**`:root`** targets the `<html>` element. Variables defined here are available everywhere.

**`--variable-name`** is a CSS custom property. Use it with `var()`:
```css
body {
  background: var(--background);  /* #06060b — very dark blue-black */
  color: var(--foreground);        /* #f1f5f9 — light gray */
}
```

The color scheme is a dark theme with violet/indigo accents — very modern "developer tool" aesthetic.

### Glassmorphism Header

```css
.nav-header {
  background: rgba(6, 6, 11, 0.85);           /* 85% opaque dark background */
  backdrop-filter: blur(20px) saturate(1.4);    /* Blur content behind it */
  -webkit-backdrop-filter: blur(20px) saturate(1.4);  /* Safari support */
  border-bottom: 1px solid rgba(255, 255, 255, 0.04); /* Subtle border */
}
```

**`backdrop-filter: blur(20px)`** — This creates the "frosted glass" effect. Content scrolling behind the header appears blurred. `saturate(1.4)` makes colors slightly more vivid through the blur.

**`rgba(6, 6, 11, 0.85)`** — RGBA color: Red=6, Green=6, Blue=11, Alpha=0.85 (85% opaque). The slight transparency lets the blur effect show through.

### The Glow Line

```css
.nav-glow-line {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(139, 92, 246, 0.3) 20%,    /* violet, 30% opacity */
    rgba(99, 102, 241, 0.5) 50%,     /* indigo, 50% opacity */
    rgba(139, 92, 246, 0.3) 80%,     /* violet, 30% opacity */
    transparent 100%
  );
}
```

A 1px line under the header that glows violet/indigo in the center and fades to transparent at the edges. Creates a subtle "energy line" effect.

### CSS Animations

```css
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
}
.voice-pulse { animation: voice-pulse 1.5s ease-in-out infinite; }
```

**`@keyframes`** defines an animation sequence:
- At 0% and 100% (start and end): red shadow at 0px spread
- At 50% (middle): red shadow expanded to 12px but fully transparent

This creates a pulsing ring effect on the microphone button when recording. The shadow expands outward and fades, then resets — creating a "sonar ping" visual.

```css
@keyframes blink {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
.typing-dot { animation: blink 1.4s infinite; }
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
```

The typing indicator (three dots). Each dot blinks between 20% and 100% opacity. The `animation-delay` staggers them so they blink in sequence: dot1 → dot2 → dot3, creating the classic "typing..." animation.

### Card Hover Glow

```css
.card-glow {
  position: relative;
  transition: all 0.3s ease;
}
.card-glow::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(135deg,
    rgba(139, 92, 246, 0.2),   /* violet */
    rgba(56, 189, 248, 0.1),    /* sky blue */
    transparent
  );
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: -1;
}
.card-glow:hover::before {
  opacity: 1;
}
```

**`::before` pseudo-element** — Creates an invisible element BEFORE the card's content. On hover, it fades in a gradient border glow effect.

- `content: ""` — Required for pseudo-elements to render (even if empty)
- `inset: -1px` — Positions it 1px outside the card on all sides
- `border-radius: inherit` — Matches the card's rounded corners
- `z-index: -1` — Places it behind the card content
- `opacity: 0` → `opacity: 1` on hover — Smooth fade-in

---

## Key Takeaways

1. **`package.json`** defines dependencies, scripts, and Node version requirements
2. **`tsconfig.json`** configures TypeScript — `strict: true` is the most important setting
3. **`next.config.ts`** is minimal — only `serverExternalPackages` for the native SQLite driver
4. **Tailwind CSS 4** needs just `@import "tailwindcss"` — no config file needed
5. **Environment variables** control runtime behavior without code changes
6. **CSS custom properties + animations** create the dark theme with glow effects

---

**Next up: Part 3 — Database Layer**

---
---

# Part 3: Database Layer — SQLite, WAL Mode, and chat-history.ts

> This part explains the entire database layer line by line. File: `src/lib/db/chat-history.ts`

---

## Table of Contents

1. [What is SQLite?](#1-what-is-sqlite)
2. [better-sqlite3 — The Driver](#2-better-sqlite3--the-driver)
3. [The Singleton Pattern — One Database Connection](#3-the-singleton-pattern--one-database-connection)
4. [WAL Mode — Concurrent Access](#4-wal-mode--concurrent-access)
5. [Schema Design — Tables and Indexes](#5-schema-design--tables-and-indexes)
6. [CRUD Operations — Line by Line](#6-crud-operations--line-by-line)
7. [The Full File Walkthrough](#7-the-full-file-walkthrough)

---

## 1. What is SQLite?

SQLite is a database that lives in a **single file** on disk. No separate server process needed.

**Comparison:**
| Feature | PostgreSQL/MySQL | SQLite |
|---------|-----------------|--------|
| Server | Separate process | No server — just a file |
| Setup | Install, configure, start | Zero config |
| Concurrency | Thousands of connections | One writer at a time |
| Use case | Web apps, microservices | Desktop apps, embedded, prototypes |
| File | Data in a data directory | Single `.db` file |

**Why SQLite for this project?**
- Zero setup — just `npm install better-sqlite3`
- The database file lives at `.kiro/chat-history.db`
- Perfect for a single-user development tool
- No need to install/run a database server

## 2. better-sqlite3 — The Driver

`better-sqlite3` is a Node.js library that lets you talk to SQLite. It's a **native C++ addon** — compiled machine code that's much faster than pure JavaScript alternatives.

**Key characteristic: It's synchronous.**

```typescript
// better-sqlite3 — synchronous (blocks until done)
const rows = db.prepare("SELECT * FROM users").all();
// Code here runs AFTER the query completes

// Most other DB drivers — asynchronous (returns a Promise)
const rows = await db.query("SELECT * FROM users");
// Code here runs AFTER the query completes (but doesn't block the thread)
```

**Why synchronous is OK here:**
SQLite reads from a local file — it's extremely fast (microseconds). Blocking for microseconds is fine. For a remote database (PostgreSQL over network), you'd want async to avoid blocking while waiting for network responses.

## 3. The Singleton Pattern — One Database Connection

```typescript
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    // First call: create the connection
    fs.mkdirSync(DB_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`CREATE TABLE IF NOT EXISTS ...`);
  }
  return _db;
}
```

**The Singleton Pattern** ensures only ONE database connection exists for the entire application.

**How it works:**
1. `_db` starts as `null`
2. First time `getDb()` is called → creates the connection, stores it in `_db`
3. Every subsequent call → returns the existing `_db` (skips creation)

**Why singleton?**
- Opening a database connection is expensive (file locks, memory allocation)
- Multiple connections to the same SQLite file can cause locking issues
- One connection is reused across all API route handlers

**Module-level variables persist in Next.js:**
In Next.js, module-level variables (like `_db`) survive across API route invocations. The module is loaded once and stays in memory. This is why the singleton works — `_db` isn't reset between requests.

## 4. WAL Mode — Concurrent Access

```typescript
_db.pragma("journal_mode = WAL");
```

**WAL = Write-Ahead Logging.** This is the most important performance setting for SQLite.

**Without WAL (default "rollback journal"):**
- Readers block writers, writers block readers
- Only one operation at a time
- Slow for concurrent access

**With WAL:**
- Readers don't block writers
- Writers don't block readers
- Multiple readers can work simultaneously
- Only one writer at a time (but readers continue during writes)

**How WAL works (simplified):**
1. Changes are written to a separate WAL file (`.db-wal`)
2. Readers see the old data until the write is committed
3. Periodically, WAL changes are merged back into the main `.db` file (called "checkpointing")

**The three files you see:**
- `chat-history.db` — The main database
- `chat-history.db-wal` — Write-ahead log (pending changes)
- `chat-history.db-shm` — Shared memory file (coordinates access between connections)

## 5. Schema Design — Tables and Indexes

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  title TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**`chat_sessions` table** — One row per conversation:

| Column | Type | Constraint | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PRIMARY KEY | Unique session ID (from ACP) |
| `agent_id` | TEXT | NOT NULL | Which agent this chat is with |
| `agent_name` | TEXT | NOT NULL | Agent's display name |
| `title` | TEXT | DEFAULT '' | Auto-generated from first message |
| `created_at` | TEXT | DEFAULT datetime('now') | When the session started |
| `updated_at` | TEXT | DEFAULT datetime('now') | Last activity time |

**`CREATE TABLE IF NOT EXISTS`** — Only creates the table if it doesn't already exist. Safe to run multiple times (idempotent).

**`DEFAULT (datetime('now'))`** — SQLite function that returns the current UTC timestamp as a string like `"2024-01-15 10:30:00"`.

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**`chat_messages` table** — One row per message:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER | Auto-incrementing unique ID |
| `session_id` | TEXT | Links to `chat_sessions.id` |
| `role` | TEXT | "user", "assistant", or "delegation" |
| `content` | TEXT | The message text |
| `agent_name` | TEXT | Which agent sent this (nullable for user messages) |
| `created_at` | TEXT | When the message was sent |

**`REFERENCES chat_sessions(id) ON DELETE CASCADE`** — Foreign key constraint:
- `REFERENCES` — This column must contain a value that exists in `chat_sessions.id`
- `ON DELETE CASCADE` — If a session is deleted, automatically delete all its messages too

**`AUTOINCREMENT`** — SQLite automatically assigns the next integer (1, 2, 3, ...). Unlike UUIDs, these are sequential and compact.

```sql
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON chat_sessions(agent_id);
```

**Indexes** speed up queries that filter by these columns:
- `idx_messages_session` — Makes `WHERE session_id = ?` fast (used when loading chat messages)
- `idx_sessions_agent` — Makes `WHERE agent_id = ?` fast (used when listing chats for an agent)

**Without an index:** SQLite scans every row (slow for large tables).
**With an index:** SQLite jumps directly to matching rows (like a book's index).

## 6. CRUD Operations — Line by Line

### Creating a Session

```typescript
export function createChatSession(id: string, agentId: string, agentName: string): ChatSession {
  const db = getDb();
  db.prepare(
    "INSERT INTO chat_sessions (id, agent_id, agent_name) VALUES (?, ?, ?)"
  ).run(id, agentId, agentName);
  return { id, agentId, agentName, title: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
```

**`db.prepare(sql)`** — Compiles the SQL statement. The `?` are **parameter placeholders** (prevents SQL injection).

**`SQL injection` explained:**
```typescript
// DANGEROUS — never do this:
db.exec(`INSERT INTO sessions (id) VALUES ('${userInput}')`);
// If userInput = "'; DROP TABLE sessions; --"
// The SQL becomes: INSERT INTO sessions (id) VALUES (''; DROP TABLE sessions; --')
// This DELETES your table!

// SAFE — use parameterized queries:
db.prepare("INSERT INTO sessions (id) VALUES (?)").run(userInput);
// The ? is replaced safely — special characters are escaped
```

**`.run()`** — Executes the statement with the given parameters. Used for INSERT, UPDATE, DELETE.

### Listing Sessions (Complex Query)

```typescript
export function listChatSessions(agentId?: string, limit = 50): ChatSession[] {
  const db = getDb();
  const query = agentId
    ? `SELECT s.*, COUNT(m.id) as message_count,
       (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message
       FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id
       WHERE s.agent_id = ? GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?`
    : `SELECT s.*, COUNT(m.id) as message_count,
       (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message
       FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id
       GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?`;
```

Let's break down this SQL:

1. **`SELECT s.*`** — Select all columns from the `chat_sessions` table (aliased as `s`)

2. **`COUNT(m.id) as message_count`** — Count how many messages each session has. `as message_count` gives the result a name.

3. **`(SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message`** — A **subquery** that gets the most recent message content for each session. `ORDER BY id DESC LIMIT 1` = "last message by ID."

4. **`LEFT JOIN chat_messages m ON m.session_id = s.id`** — Combine sessions with their messages. `LEFT JOIN` means "include sessions even if they have zero messages" (unlike `INNER JOIN` which would exclude them).

5. **`GROUP BY s.id`** — Required because we're using `COUNT()`. Groups all messages by session so we get one row per session with a count.

6. **`ORDER BY s.updated_at DESC`** — Most recently active sessions first.

7. **`LIMIT ?`** — Maximum number of results (default 50).

```typescript
  const rows = (agentId
    ? db.prepare(query).all(agentId, limit)
    : db.prepare(query).all(limit)) as SessionRow[];
```

**`.all()`** — Returns all matching rows as an array (unlike `.run()` which returns nothing, or `.get()` which returns one row).

### The Row-to-Object Mapping

```typescript
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,        // snake_case → camelCase
    agentName: r.agent_name,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    lastMessage: r.last_message ?? undefined,
  }));
```

SQLite returns column names in `snake_case` (as defined in the schema). JavaScript convention is `camelCase`. This mapping converts between the two.

**`r.last_message ?? undefined`** — The **nullish coalescing operator**. If `last_message` is `null` (no messages), use `undefined` instead. This is because our TypeScript interface uses `lastMessage?: string` (optional, not nullable).

### Saving a Message

```typescript
export function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  agentName?: string
): void {
  getDb().prepare(
    "INSERT INTO chat_messages (session_id, role, content, agent_name) VALUES (?, ?, ?, ?)"
  ).run(sessionId, role, content, agentName || null);
  touchSession(sessionId);
}
```

**`agentName || null`** — If `agentName` is `undefined` or empty string, store `null` in the database. SQLite `NULL` means "no value."

**`touchSession(sessionId)`** — Updates the session's `updated_at` timestamp:
```typescript
export function touchSession(sessionId: string): void {
  getDb().prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);
}
```

This ensures the "most recent" sorting works correctly — every new message bumps the session to the top.

### Graceful Shutdown

```typescript
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

process.on("SIGTERM", closeDb);
process.on("SIGINT", closeDb);
```

When the server shuts down (Ctrl+C or deployment), we close the database connection. This:
1. Flushes any pending WAL writes to the main database file
2. Releases the file lock
3. Prevents database corruption

---

## 7. The Full File Walkthrough

Here's the complete mental model of `chat-history.ts`:

```
┌─────────────────────────────────────────────────┐
│                chat-history.ts                    │
│                                                   │
│  Module-level:                                    │
│  ├── DB_DIR, DB_PATH (computed from env vars)     │
│  ├── _db = null (singleton holder)                │
│  └── SIGTERM/SIGINT handlers (cleanup)            │
│                                                   │
│  getDb() — lazy initialization:                   │
│  ├── Create .kiro/ directory if needed            │
│  ├── Open SQLite database                         │
│  ├── Enable WAL mode                              │
│  └── Create tables + indexes if needed            │
│                                                   │
│  Session operations:                              │
│  ├── createChatSession() — INSERT                 │
│  ├── listChatSessions() — SELECT with JOIN        │
│  ├── updateSessionTitle() — UPDATE (once only)    │
│  ├── touchSession() — UPDATE updated_at           │
│  └── deleteChatSession() — DELETE (cascade)       │
│                                                   │
│  Message operations:                              │
│  ├── saveMessage() — INSERT + touch session       │
│  └── getSessionMessages() — SELECT ordered by id  │
│                                                   │
│  Convenience:                                     │
│  └── getRecentChats() — alias for listSessions    │
└─────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **SQLite** is a file-based database — no server needed, perfect for dev tools
2. **WAL mode** enables concurrent reads during writes — essential for a web server
3. **Singleton pattern** ensures one database connection shared across all requests
4. **Parameterized queries** (`?` placeholders) prevent SQL injection attacks
5. **Indexes** on `session_id` and `agent_id` make lookups fast
6. **Graceful shutdown** handlers prevent database corruption
7. **Row mapping** converts between SQL `snake_case` and JS `camelCase`

---

**Next up: Part 4 — Agent System**

---
---

# Part 4: Agent System — Schemas, Config Service, and File-Based Storage

> Files covered: `src/lib/agents/schema.ts`, `src/lib/agents/config-service.ts`, `src/lib/agents/templates.ts`, `src/lib/intent/parser.ts`

---

## 1. schema.ts — Validation and Types with Zod

This file is the **single source of truth** for all data shapes in the application.

### MCP Server Schema

```typescript
import { z } from "zod";

export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
});
```

**MCP (Model Context Protocol)** servers are external tools that agents can use. This schema validates their configuration:
- `command` — The executable to run (required)
- `args` — Command-line arguments (defaults to empty array)
- `env` — Environment variables as key-value pairs (optional)
- `timeout` — Max execution time in ms (optional)

**`z.record(z.string(), z.string())`** — A Record type: an object where both keys and values are strings. Like `{ "API_KEY": "abc123", "DEBUG": "true" }`.

### The Main Agent Config Schema

```typescript
export const KiroAgentConfigSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1),
  tools: z.array(z.string()).default(["read", "write"]),
  allowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  model: z.string().default("claude-sonnet-4"),
  welcomeMessage: z.string().optional(),
  // ... more optional fields
});

export type KiroAgentConfig = z.infer<typeof KiroAgentConfigSchema>;
```

**Validation chain on `name`:**
```typescript
z.string()          // Must be a string
  .min(1)           // At least 1 character (not empty)
  .max(64)          // At most 64 characters
  .regex(/^[a-z0-9-]+$/)  // Only lowercase letters, numbers, and hyphens
```

The regex `/^[a-z0-9-]+$/` means:
- `^` — Start of string
- `[a-z0-9-]` — Character class: lowercase a-z, digits 0-9, or hyphen
- `+` — One or more of the above
- `$` — End of string

So `"my-agent-1"` ✅, `"My Agent"` ❌, `"agent_v2"` ❌

**`z.infer<typeof KiroAgentConfigSchema>`** — Extracts the TypeScript type from the Zod schema. This means you define validation rules ONCE and get both runtime validation AND compile-time types.

### API Request Schemas

```typescript
export const CreateAgentRequestSchema = KiroAgentConfigSchema.extend({
  parentAgentId: z.string().uuid().nullable().optional(),
  additionalFiles: z.array(AgentFileSchema).optional(),
});
```

**`.extend()`** — Creates a new schema that includes all fields from `KiroAgentConfigSchema` PLUS the new ones. Like class inheritance but for schemas.

**`z.string().uuid().nullable().optional()`** — Validation chain:
- Must be a string
- Must be a valid UUID format (e.g., `"550e8400-e29b-41d4-a716-446655440000"`)
- Can be `null` (for agents without a parent)
- Can be omitted entirely (`undefined`)

```typescript
export const UpdateAgentRequestSchema = KiroAgentConfigSchema.partial();
```

**`.partial()`** — Makes ALL fields optional. For updates, you only send the fields you want to change, not the entire config.

### Interface Types (Not Validated at Runtime)

```typescript
export interface AgentMeta {
  id: string;
  name: string;
  description: string;
  configPath: string;
  parentAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**`interface` vs Zod schema:**
- Zod schemas validate data at runtime (when receiving API requests)
- Interfaces only exist at compile time (TypeScript removes them)
- Use Zod for external data (user input, API requests)
- Use interfaces for internal data structures

---

## 2. config-service.ts — Agent CRUD with File-Based Storage

This is the most complex service file. It manages agent configurations stored as JSON files on disk.

### Storage Architecture

```
.kiro/agents/
├── .agent-index.json          ← UUID → metadata mapping
├── my-agent.json              ← Agent config (name, prompt, tools)
├── devops-agent.json          ← Another agent config
└── prompts/
    └── my-agent.md            ← External prompt file (optional)
```

**Two-file system:**
1. **`.agent-index.json`** — Maps UUIDs to metadata (id, name, description, timestamps, parent)
2. **`<name>.json`** — The actual Kiro agent config (prompt, tools, model)

**Why two files?** The index provides fast lookups by UUID without reading every config file. The config files match the format that `kiro-cli` expects.

### Path Security — Preventing Path Traversal

```typescript
function safePath(name: string): string {
  const resolved = path.resolve(AGENTS_DIR, `${name}.json`);
  if (!resolved.startsWith(path.resolve(AGENTS_DIR) + path.sep)) {
    throw new Error("Invalid agent name: path traversal detected");
  }
  return resolved;
}
```

**Path traversal attack:** If someone sends `name = "../../etc/passwd"`, without this check, the code would try to read `/etc/passwd` instead of an agent config.

**How the check works:**
```typescript
// Normal case:
path.resolve("/project/.kiro/agents", "my-agent.json")
// → "/project/.kiro/agents/my-agent.json"
// Starts with "/project/.kiro/agents/" ✅

// Attack case:
path.resolve("/project/.kiro/agents", "../../etc/passwd.json")
// → "/project/etc/passwd.json"
// Does NOT start with "/project/.kiro/agents/" ❌ → throws error
```

### The Mutex Lock — Preventing Race Conditions

```typescript
let indexLock: Promise<void> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = indexLock;
  let release: () => void;
  indexLock = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}
```

This is a **Promise-based mutex** (mutual exclusion lock). It ensures only one operation writes to the index file at a time.

**The problem it solves:**
```
Request A: Read index → {agent1: ...}
Request B: Read index → {agent1: ...}        ← Same old data!
Request A: Write index → {agent1: ..., agent2: ...}
Request B: Write index → {agent1: ..., agent3: ...}  ← agent2 is LOST!
```

**How the lock works:**
1. `indexLock` starts as a resolved Promise (no one is waiting)
2. When `withIndexLock(fn)` is called:
   - Save the current lock as `prev`
   - Create a NEW Promise and store it as `indexLock`
   - Wait for `prev` to resolve, THEN run `fn`
   - When `fn` finishes, release the lock (resolve the new Promise)
3. Next caller waits for OUR lock before proceeding

**Sequence with lock:**
```
Request A: Acquires lock → Read → Write → Release
Request B: Waits... → Acquires lock → Read (sees A's changes) → Write → Release
```

### Creating an Agent

```typescript
export async function createAgent(
  req: CreateAgentRequest,
  additionalFiles?: Array<{ path: string; content: string }>
): Promise<AgentMeta> {
  await fs.mkdir(AGENTS_DIR, { recursive: true });

  const config = KiroAgentConfigSchema.parse(req);
  const configPath = safePath(config.name);
```

1. Ensure the agents directory exists
2. Validate the request against the schema (throws `ZodError` if invalid)
3. Build a safe file path from the agent name

```typescript
  // Check for name collision
  try {
    await fs.access(configPath);
    throw new Error(`Agent "${config.name}" already exists`);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("already exists")) throw e;
    // File doesn't exist — good, we can create it
  }
```

**`fs.access()`** checks if a file exists. If it does, we throw "already exists." If it throws (file not found), that's actually what we want — the name is available.

This is a common pattern: using a "try to access, catch the error" approach instead of a separate "check then create" approach (which has race conditions).

```typescript
  // Write additional files (prompt files, steering files, etc.)
  if (additionalFiles?.length) {
    for (const file of additionalFiles) {
      const resolved = path.resolve(WORKSPACE_DIR, file.path);
      if (!resolved.startsWith(path.resolve(WORKSPACE_DIR) + path.sep)) continue;
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, file.content);
    }
  }
```

The builder can create extra files alongside the agent config (like prompt markdown files or steering convention files). Each file path is validated against the workspace root to prevent writing outside the project.

```typescript
  return withIndexLock(async () => {
    const index = await readIndex();
    const id = uuidv4();
    const now = new Date().toISOString();
    const meta: AgentMeta = {
      id,
      name: config.name,
      description: config.description,
      configPath: `.kiro/agents/${config.name}.json`,
      parentAgentId: req.parentAgentId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    index[id] = meta;
    await writeIndex(index);
    return meta;
  });
```

Inside the lock:
1. Read the current index
2. Generate a new UUID with `uuidv4()`
3. Create metadata with timestamps
4. Add to the index object
5. Write the updated index back to disk

**`req.parentAgentId ?? null`** — Nullish coalescing: if `parentAgentId` is `undefined`, use `null`. This distinguishes "no parent" (`null`) from "not specified" (`undefined`).

### Updating an Agent

```typescript
export async function updateAgent(
  id: string,
  updates: Partial<KiroAgentConfig>
): Promise<AgentMeta | null> {
  const existing = await getAgent(id);
  if (!existing) return null;

  const merged = KiroAgentConfigSchema.parse({
    ...existing.config,
    ...updates,
  });
```

**Spread merge pattern:**
```typescript
const existing = { name: "old", description: "old desc", tools: ["read"] };
const updates = { description: "new desc" };
const merged = { ...existing, ...updates };
// Result: { name: "old", description: "new desc", tools: ["read"] }
```

The spread operator (`...`) copies all properties. Properties from `updates` overwrite those from `existing`. Then we validate the merged result with Zod.

```typescript
  // If name changed, remove old file
  if (merged.name !== existing.meta.name) {
    const oldPath = safePath(existing.meta.name);
    await fs.unlink(oldPath).catch(() => {});
  }
```

If the agent is renamed, delete the old config file. `.catch(() => {})` silently ignores errors (file might already be gone).

---

## 3. templates.ts — Predefined Agent Configurations

```typescript
export const AGENT_TEMPLATES: Record<
  string,
  { name: string; description: string; prompt: string; tools: string[]; model: string }
> = {
  devops: {
    name: "devops-agent",
    description: "AWS infrastructure and DevOps automation specialist",
    prompt: "You are a DevOps specialist...",
    tools: ["read", "write", "shell", "aws"],
    model: "claude-sonnet-4",
  },
  // ... more templates
};
```

**`Record<string, { ... }>`** — A TypeScript utility type meaning "an object where keys are strings and values match the given shape." It's like a dictionary/map.

Templates provide quick-start configurations. The voice parser and builder can match user descriptions to these templates.

---

## 4. parser.ts — Voice Transcript to Agent Config

This file converts natural language ("create a devops agent") into a structured agent config.

```typescript
const TOOL_KEYWORDS: Record<string, string[]> = {
  aws: ["aws", "amazon", "s3", "lambda", "ec2", ...],
  shell: ["shell", "bash", "terminal", "command", ...],
  "@git": ["git", "github", "version control", ...],
};

export function parseVoiceToAgentConfig(transcript: string): KiroAgentConfig {
  const lower = transcript.toLowerCase();

  // Try to match a template first
  for (const [key, template] of Object.entries(AGENT_TEMPLATES)) {
    if (lower.includes(key) || lower.includes(template.name.replace("-agent", ""))) {
      return KiroAgentConfigSchema.parse({ ...template });
    }
  }
```

**Strategy:** First try to match known templates by keyword. If "devops" appears in the transcript, use the devops template.

```typescript
  // Extract agent name from transcript
  const nameMatch = lower.match(
    /(?:create|build|make|set up|setup)\s+(?:a|an)?\s*(.+?)\s+agent/
  );
```

**Regex breakdown:**
- `(?:create|build|make|set up|setup)` — Match any of these verbs (non-capturing group)
- `\s+` — One or more whitespace characters
- `(?:a|an)?` — Optional article
- `\s*` — Optional whitespace
- `(.+?)` — Capture the agent description (lazy match — as few chars as possible)
- `\s+agent` — Followed by "agent"

Example: `"create a kubernetes deployment agent"` → captures `"kubernetes deployment"`

```typescript
  // Extract tools based on keywords
  const tools = new Set<string>(["read", "write"]);
  for (const [tool, keywords] of Object.entries(TOOL_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      tools.add(tool);
    }
  }
```

**`Set`** — A collection of unique values. `tools.add("aws")` won't create duplicates. If the transcript mentions "terraform" or "s3", the `aws` tool is added.

---

## Key Takeaways

1. **Zod schemas** provide both runtime validation and TypeScript types from a single definition
2. **File-based storage** with a JSON index enables fast lookups without a database
3. **Path traversal prevention** is critical security — always validate file paths
4. **Promise-based mutex** prevents race conditions on concurrent index writes
5. **Spread merge** (`{ ...existing, ...updates }`) is the standard pattern for partial updates
6. **Keyword extraction** from natural language is a simple but effective MVP approach

---

**Next up: Part 5 — ACP Integration**

---
---

# Part 5: ACP Integration — JSON-RPC, stdio, and the Client Architecture

> Files: `src/lib/acp/client.ts`, `src/lib/acp/session-manager.ts`, `src/lib/acp/builder-provider.ts`
>
> This is the heart of the application — how we talk to AI.

---

## 1. What is ACP?

**ACP (Agent Client Protocol)** is how our app communicates with `kiro-cli`. Think of it as a language both sides speak.

```
Our App (client)  ←→  kiro-cli (server)  ←→  Claude (AI model)
     JSON-RPC            stdio                  AWS Bedrock
```

**JSON-RPC 2.0** is the message format — structured JSON messages with an `id`, `method`, and `params`.

**stdio** is the transport — we write to kiro-cli's stdin and read from its stdout.

## 2. client.ts — The ACP Client (Line by Line)

### Class Structure

```typescript
export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private _sessionId: string | null = null;
```

| Field | Purpose |
|-------|---------|
| `process` | The kiro-cli child process |
| `requestId` | Auto-incrementing counter for JSON-RPC message IDs |
| `pending` | Map of request ID → Promise callbacks (waiting for responses) |
| `buffer` | Incomplete data from stdout (messages might arrive in chunks) |
| `_sessionId` | The current ACP session ID |

### Connecting to kiro-cli

```typescript
async connect(opts: AcpClientOptions): Promise<void> {
  this.process = spawn(KIRO_CLI_PATH, ["acp"], {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
```

**`spawn(KIRO_CLI_PATH, ["acp"])`** — Starts `kiro-cli acp` as a child process. The `acp` argument tells kiro-cli to run in ACP mode (accepting JSON-RPC over stdio).

```typescript
  this.process.stdout!.on("data", (chunk: Buffer) => {
    this.buffer += chunk.toString();
    this.processBuffer();
  });
```

**Buffering explained:** Data from stdout arrives in arbitrary chunks. A single JSON message might arrive as:
- Chunk 1: `{"jsonrpc":"2.0","id":1,`
- Chunk 2: `"result":{"sessionId":"abc"}}\n`

We accumulate chunks in `buffer` and process complete lines (delimited by `\n`).

```typescript
  await this.send("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
    clientInfo: { name: "voice-agent-studio", version: "1.0.0" },
  });
```

**Handshake:** The first message tells kiro-cli what our client can do:
- `fs.readTextFile/writeTextFile` — We can handle file read/write requests
- `terminal` — We can execute shell commands
- This is important because kiro-cli will ASK US to perform these operations when the AI agent uses tools

### The send() Method — Request/Response Pattern

```typescript
private async send(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  if (!this.process?.stdin?.writable) throw new Error("ACP process not connected");

  const id = ++this.requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    this.process!.stdin!.write(msg);
  });
}
```

**How request/response works over stdio:**

1. Generate a unique `id` (1, 2, 3, ...)
2. Create a Promise and store its `resolve`/`reject` callbacks in the `pending` Map, keyed by `id`
3. Send the JSON-RPC message to kiro-cli's stdin
4. Start a timeout timer (2 minutes default)
5. When kiro-cli responds with the same `id`, find the pending Promise and resolve it

**JSON-RPC message format:**
```json
// Request (we send):
{"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {"cwd": "/project"}}

// Response (we receive):
{"jsonrpc": "2.0", "id": 1, "result": {"sessionId": "abc-123"}}

// Error response:
{"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "Invalid request"}}

// Notification (no id — we don't respond):
{"jsonrpc": "2.0", "method": "session/update", "params": {"update": {...}}}
```

### Processing the Buffer — Parsing Messages

```typescript
private processBuffer(): void {
  const lines = this.buffer.split("\n");
  this.buffer = lines.pop() || "";  // Keep incomplete last line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if ("id" in msg && "method" in msg) {
        this.handleRequest(msg);      // kiro-cli asking US to do something
      } else if ("id" in msg && this.pending.has(msg.id)) {
        this.handleResponse(msg);     // Response to our request
      } else if ("method" in msg) {
        this.handleNotification(msg); // Streaming update (no id)
      }
    } catch (e) { /* ignore parse errors */ }
  }
}
```

**Three types of messages:**

1. **Request** (has `id` AND `method`) — kiro-cli asking us to read a file, write a file, or run a command
2. **Response** (has `id`, no `method`) — Answer to a request we sent
3. **Notification** (has `method`, no `id`) — Streaming updates (text chunks, tool calls)

**`lines.pop()`** — Removes and returns the last element. If the buffer ends mid-message (no trailing `\n`), the last "line" is incomplete. We keep it in the buffer for the next chunk.

### Handling Streaming Notifications

```typescript
private handleNotification(msg: { method: string; params?: Record<string, unknown> }): void {
  if (msg.method === "session/update") {
    const update = params.update as Record<string, unknown>;
    const sessionUpdate = update.sessionUpdate as string;

    switch (sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content as { type: string; text: string };
        event = { type: "text", content: content?.text || "" };
        break;
      }
      case "tool_use": {
        event = { type: "tool_call", name: update.name, status: update.status };
        break;
      }
      case "tool_result": {
        event = { type: "tool_call_update", name: update.name, content: update.content };
        break;
      }
    }
    this.emit("update", event);
  }
}
```

When the AI is generating a response, kiro-cli sends a stream of `session/update` notifications:
- `agent_message_chunk` — A piece of text (the AI's response arrives word by word)
- `tool_use` — The AI is calling a tool (like reading a file)
- `tool_result` — The tool finished and returned a result

Each notification is converted to a `SessionUpdate` and emitted as an event.

### Handling Incoming Requests (Tool Execution)

```typescript
private handleRequest(msg: { id: number; method: string; params?: Record<string, unknown> }): void {
  switch (msg.method) {
    case "fs/readTextFile": {
      const safe = this.validatePath(filePath);
      fs.readFile(safe, "utf-8", (err, content) => {
        if (err) respondError(-32000, err.message);
        else respond({ content });
      });
      return;
    }
    case "fs/writeTextFile": { /* similar */ }
    case "terminal/execute": {
      exec(command, { timeout: 60000 }, (err, stdout, stderr) => {
        respond({ exitCode: err?.code ?? 0, stdout, stderr });
      });
      return;
    }
    case "fs/listDirectory": { /* similar */ }
  }
}
```

**This is bidirectional communication.** kiro-cli doesn't just respond to us — it also ASKS us to do things. When the AI agent uses the `read` tool, kiro-cli sends us a `fs/readTextFile` request, we read the file, and send the content back.

Every file path is validated with `validatePath()` to prevent the AI from reading files outside the workspace.

---

## 3. session-manager.ts — Connection Pool

### The Pool Pattern

```typescript
class AcpSessionManager {
  private sessions = new Map<string, ManagedSession>();

  async createSession(agentName: string): Promise<{ sessionId: string; client: AcpClient }> {
    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictOldest();
    }
    const client = new AcpClient();
    await client.connect({ cwd: WORKSPACE_DIR });
    const sessionId = await client.createSession(WORKSPACE_DIR);

    if (agentName !== "kiro_default") {
      await client.switchAgent(sessionId, agentName);
    }

    this.sessions.set(sessionId, { client, sessionId, agentName, createdAt: new Date(), lastActivity: new Date() });
    return { sessionId, client };
  }
```

Each chat session gets its own kiro-cli process. The pool limits this to `MAX_SESSIONS` (default 10) to prevent resource exhaustion.

### LRU Eviction

```typescript
private evictOldest(): void {
  let oldest: ManagedSession | null = null;
  for (const session of this.sessions.values()) {
    if (!oldest || session.lastActivity < oldest.lastActivity) {
      oldest = session;
    }
  }
  if (oldest) {
    oldest.client.disconnect();
    this.sessions.delete(oldest.sessionId);
  }
}
```

**LRU = Least Recently Used.** When the pool is full, we kill the session that hasn't been used for the longest time. `lastActivity` is updated every time `getSession()` is called.

### Singleton Export

```typescript
export const sessionManager = new AcpSessionManager();
```

One instance for the entire server. Module-level variables persist across API route invocations in Next.js.

---

## 4. builder-provider.ts — Dedicated Builder Session

The agent creation builder gets its own ACP session, separate from chat sessions.

```typescript
let activeSession: BuilderSession | null = null;

async function getOrCreateSession(): Promise<BuilderSession> {
  if (activeSession) return activeSession;
  const client = new AcpClient();
  await client.connect({ cwd: WORKSPACE_DIR });
  const sessionId = await client.createSession(WORKSPACE_DIR);
  activeSession = { client, sessionId, turnCount: 0 };
  return activeSession;
}
```

**Why a separate session?** The builder has a special system prompt that instructs the AI to gather agent configuration through conversation. This prompt is prepended on the first turn:

```typescript
export async function streamBuilderPrompt(userMessage: string, onChunk: (text: string) => void): Promise<void> {
  const session = await getOrCreateSession();
  let prompt = userMessage;
  if (session.turnCount === 0) {
    prompt = `${BUILDER_SYSTEM_PROMPT}\n\n---\n\nUser's first message: ${userMessage}`;
  }
  session.turnCount++;
```

**First turn:** The system prompt + user message are sent together. ACP is stateful — it remembers the conversation, so subsequent turns only send the new user message.

**The callback pattern:**
```typescript
return new Promise<void>((resolve, reject) => {
  const onUpdate = (update: SessionUpdate) => {
    if (update.type === "text") onChunk(update.content);
  };
  session.client.on("update", onUpdate);
  session.client.prompt(session.sessionId, prompt)
    .then(() => { session.client.removeListener("update", onUpdate); resolve(); })
    .catch((err) => { session.client.removeListener("update", onUpdate); reject(err); });
});
```

1. Register an event listener for streaming updates
2. Send the prompt to kiro-cli
3. As text chunks arrive, call `onChunk()` (which sends them to the browser via SSE)
4. When the prompt completes (AI finishes responding), clean up the listener and resolve

---

## Key Takeaways

1. **JSON-RPC 2.0** provides structured request/response communication over stdio
2. **Buffering** is essential — data arrives in arbitrary chunks, not complete messages
3. **Bidirectional communication** — kiro-cli asks US to read files and run commands
4. **Session pool** with LRU eviction prevents resource exhaustion
5. **Path validation** on every file operation prevents security vulnerabilities
6. **Singleton pattern** ensures one session manager shared across all API routes
7. **The builder** uses a dedicated session with a special system prompt

---

**Next up: Part 6 — API Routes**

---
---

# Part 6: API Routes — Every Endpoint Explained

> All files under `src/app/api/`. This covers SSE streaming, error handling patterns, and the delegation system.

---

## 1. Agent CRUD Routes

### GET/POST `/api/agents` — List and Create

```typescript
// src/app/api/agents/route.ts
export async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents });
}
```

Simplest possible route. Calls the config service, returns JSON.

```typescript
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { additionalFiles, ...agentData } = CreateAgentRequestSchema.parse(body);
    const meta = await createAgent(agentData, additionalFiles);
    return NextResponse.json(meta, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: issues[0]?.message ?? "Validation failed" } },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: { code: status === 409 ? "AGENT_EXISTS" : "INTERNAL_ERROR", message: msg } }, { status });
  }
}
```

**Destructuring with rest:**
```typescript
const { additionalFiles, ...agentData } = parsed;
// additionalFiles = the files array (extracted)
// agentData = everything ELSE (name, description, prompt, tools, etc.)
```

**Error handling pattern used throughout:**
1. Try the operation
2. If `ZodError` → 400 (bad input from client)
3. If "already exists" → 409 (conflict)
4. Anything else → 500 (server error)

### GET/PUT/DELETE `/api/agents/[id]` — Single Agent Operations

```typescript
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
```

**Next.js 16 dynamic route params** are now Promises. The `{ params }` is destructured from the second argument that Next.js passes to route handlers.

**`_req`** — The underscore prefix is a convention meaning "I receive this parameter but don't use it." TypeScript requires you to accept it because `params` is the second argument.

### POST `/api/agents/confirm` — Builder Confirmation

```typescript
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateAgentRequestSchema.parse(body.config || body);
```

**`body.config || body`** — The builder sends `{ config: {...} }` but direct API calls might send the config at the top level. This handles both formats.

---

## 2. The Chat Routes — SSE Streaming

### POST `/api/chat/session` — Create a Chat Session

```typescript
export async function POST(req: NextRequest) {
  const { agentId } = CreateSessionRequestSchema.parse(body);
  const agent = await getAgent(agentId);
  const children = await getChildAgents(agentId);
  const { sessionId } = await sessionManager.createSession(agent.config.name);
  createChatSession(sessionId, agentId, agent.config.name);

  return NextResponse.json({
    sessionId,
    agentName: agent.config.name,
    children: children.map((c) => ({ id: c.id, name: c.name, description: c.description })),
  }, { status: 201 });
}
```

This does three things:
1. Creates an ACP session (spawns a kiro-cli process)
2. Saves the session to SQLite (for history)
3. Returns session info + child agents (for the UI sidebar)

### POST `/api/chat/prompt` — The Streaming Endpoint (Most Complex Route)

This is the most important and complex route. Let's break it down:

```typescript
const encoder = new TextEncoder();
const stream = new ReadableStream({
  start(controller) {
    // ... all the streaming logic
  },
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  },
});
```

**Server-Sent Events (SSE)** is a protocol for streaming data from server to browser:
- `Content-Type: text/event-stream` — Tells the browser this is an SSE stream
- `Cache-Control: no-cache` — Don't cache the response
- `Connection: keep-alive` — Keep the HTTP connection open

**`ReadableStream`** — A Web Streams API object. The `start(controller)` function is called once, and we use `controller.enqueue()` to push data and `controller.close()` to end the stream.

**SSE message format:**
```
data: {"type":"text","content":"Hello"}\n\n
data: {"type":"text","content":" world"}\n\n
data: {"type":"tool_call","name":"read","status":"running"}\n\n
data: {"type":"turn_end"}\n\n
```

Each message is `data: <json>\n\n` (note the double newline — that's the SSE delimiter).

### The Delegation Detection System

```typescript
function parseDelegation(text: string): { agent: string; task: string; before: string } | null {
  const match = text.match(/([\\s\\S]*?)<delegate\\s+to="([^"]+)">([\\s\\S]*?)<\\/delegate>/);
  if (!match) return null;
  return { before: match[1], agent: match[2], task: match[3].trim() };
}
```

When an orchestrator agent wants to delegate to a sub-agent, it outputs XML-like tags:
```
I'll have the backend specialist handle this.
<delegate to="backend-agent">Build a REST API for user management</delegate>
```

The regex captures:
- `match[1]` — Text before the tag ("I'll have the backend specialist handle this.")
- `match[2]` — The agent name ("backend-agent")
- `match[3]` — The task ("Build a REST API for user management")

### The Streaming + Delegation Flow

```typescript
let fullText = "";
let pendingDelegation = null;
let sentLength = 0;

function onUpdate(update: SessionUpdate) {
  if (update.type === "text") {
    fullText += update.content;

    if (isOrchestrator && !pendingDelegation) {
      const delegation = parseDelegation(fullText);
      if (delegation) {
        pendingDelegation = { agent: delegation.agent, task: delegation.task };
        return;  // Don't send the delegation tag to the UI
      }

      // Check if we're in the middle of a <delegate tag
      const delegateStart = fullText.indexOf("<delegate");
      if (delegateStart >= 0) {
        // Send text up to the tag, hold back the rest
        if (delegateStart > sentLength) {
          send({ type: "text", content: fullText.slice(sentLength, delegateStart) });
          sentLength = delegateStart;
        }
        return;
      }
    }

    // Normal text — send what we haven't sent yet
    const unsent = fullText.slice(sentLength);
    if (unsent) {
      send({ type: "text", content: unsent });
      sentLength = fullText.length;
    }
  }
}
```

**The `sentLength` tracking pattern:** Text arrives in small chunks. We accumulate in `fullText` but track how much we've already sent to the browser with `sentLength`. This prevents sending the same text twice.

**The delegation hold-back:** When we see `<delegate` starting, we stop sending text to the browser. The tag might be incomplete (arriving in chunks). We wait until the full `</delegate>` tag arrives, then handle the delegation without showing the raw XML to the user.

### The Delegation Handler

```typescript
async function handleDelegation(agentName: string, task: string) {
  send({ type: "delegation", agent: agentName, task, status: "start" });
  await client.switchAgent(sessionId, agentName);

  let delegatedText = "";
  client.on("update", (update) => {
    if (update.type === "text") delegatedText += update.content;
    send(update);  // Forward to browser
  });

  await client.prompt(sessionId, task);
  saveMessage(sessionId, "assistant", delegatedText, agentName);
  send({ type: "delegation", agent: agentName, task, status: "end" });
  await client.switchAgent(sessionId, orchestratorName);  // Switch back
}
```

1. Tell the browser delegation is starting (UI shows a banner)
2. Switch the ACP session to the sub-agent
3. Send the task to the sub-agent
4. Stream the sub-agent's response to the browser
5. Save the response to the database
6. Tell the browser delegation ended
7. Switch back to the orchestrator

### Client Disconnect Handling

```typescript
const signal = req.signal;
signal.addEventListener("abort", () => {
  closed = true;
  client.removeAllListeners("update");
  client.cancel(sessionId).catch(() => {});
  try { controller.close(); } catch {}
});
```

**`req.signal`** is an `AbortSignal`. When the browser closes the connection (user navigates away, closes tab), this fires. We clean up by:
1. Stopping event listeners
2. Canceling the ACP prompt (tells kiro-cli to stop generating)
3. Closing the stream

---

## 3. Builder Chat Route

```typescript
// src/app/api/builder/chat/route.ts
export async function POST(req: NextRequest) {
  const { messages, action } = await req.json();

  if (action === "reset") {
    await destroyBuilderSession();
    return Response.json({ ok: true });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
```

**`[...messages].reverse()`** — Creates a copy of the array (spread into new array), then reverses it. We don't want to mutate the original. `.find()` gets the first match — which is the LAST user message since we reversed.

**Why only send the last message?** ACP is stateful — it remembers the full conversation. We only need to send the new message, not replay the entire history.

---

## 4. History Route

```typescript
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const agentId = searchParams.get("agentId");

  if (sessionId) {
    const messages = getSessionMessages(sessionId);
    return Response.json({ messages });
  }
  const sessions = agentId ? listChatSessions(agentId) : getRecentChats(30);
  return Response.json({ sessions });
}
```

**One route, multiple behaviors** based on query parameters:
- `GET /api/chat/history?sessionId=abc` → Returns messages for that session
- `GET /api/chat/history?agentId=xyz` → Returns sessions for that agent
- `GET /api/chat/history` → Returns recent sessions across all agents

---

## 5. Health Check Route

```typescript
export async function GET() {
  const checks: Record<string, string> = {};
  try {
    getRecentChats(1);
    checks.database = "ok";
  } catch (e) {
    checks.database = `error: ${(e as Error).message}`;
  }

  const healthy = checks.database === "ok";
  return Response.json(
    { status: healthy ? "healthy" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
```

Health checks are used by load balancers and monitoring systems. Returns 200 if everything works, 503 if degraded.

---

## Key Takeaways

1. **SSE (Server-Sent Events)** enables real-time streaming from server to browser
2. **ReadableStream** + `controller.enqueue()` is how you create streaming responses
3. **Delegation detection** uses regex on accumulated text to find XML tags
4. **The `sentLength` pattern** prevents sending duplicate text in streaming scenarios
5. **`req.signal`** handles client disconnects gracefully
6. **One route, multiple behaviors** via query parameters is a common REST pattern

---

**Next up: Part 7 — Frontend**

---
---

# Part 7: Frontend — React Components, Hooks, and State Management

> Components in `src/components/`, hooks in `src/hooks/`, store in `src/stores/`, pages in `src/app/`

---

## 1. Layout and Pages — Server Components

### layout.tsx — The Shell

```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body>
        <nav className="nav-header sticky top-0 z-50">...</nav>
        <main>{children}</main>
        <footer>...</footer>
      </body>
    </html>
  );
}
```

**`{ children }`** — Every page component is passed as `children` to the layout. The layout wraps ALL pages with the header and footer.

**`sticky top-0 z-50`** — Tailwind classes:
- `sticky` — Sticks to the top when scrolling
- `top-0` — Sticks at 0px from the top
- `z-50` — High z-index so it appears above other content

### page.tsx — Dashboard (Server Component)

```typescript
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const agents = await listAgents();
  const recentChats = getRecentChats(5);
```

This is an `async` Server Component — it directly calls database functions. No `fetch()`, no API calls. The data is available immediately because this code runs on the server.

---

## 2. The Chat Page — Complex Client Component

`src/app/chat/[agentId]/page.tsx` is the most complex component. Let's understand its patterns.

### State Management

```typescript
const [sessionId, setSessionId] = useState<string | null>(null);
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [loading, setLoading] = useState(false);
const [connecting, setConnecting] = useState(true);
const [isResumed, setIsResumed] = useState(false);
const [activeChild, setActiveChild] = useState<string | null>(null);
```

Each `useState` creates a piece of reactive state. When you call `setMessages(newValue)`, React re-renders the component with the new value.

### Session Recovery

```typescript
async function ensureLiveSession(): Promise<string | null> {
  if (!isResumed || !agentId) return sessionId;
  try {
    const res = await fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json();
    setSessionId(data.sessionId);
    setIsResumed(false);
    return data.sessionId;
  } catch { return null; }
}
```

When you resume a chat from history, the ACP session is gone (server might have restarted). `isResumed` tracks this state. On the first new message, `ensureLiveSession()` creates a fresh ACP session transparently.

### SSE Stream Reading

```typescript
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
    processSSELine(line);
  }
}
```

**Reading an SSE stream in the browser:**
1. Get a `ReadableStreamDefaultReader` from the response body
2. Read chunks in a loop until `done` is true
3. Decode bytes to text with `TextDecoder`
4. Split by `\n\n` (SSE message delimiter)
5. Keep incomplete last chunk in buffer
6. Process each complete message

### Updating Messages Immutably

```typescript
setMessages((prev) =>
  prev.map((m) =>
    m.id === currentMsgId ? { ...m, content: m.content + data.content } : m
  )
);
```

**React requires immutable updates.** You can't do `messages[i].content += text` — React won't detect the change. Instead:
1. `setMessages((prev) => ...)` — Use the callback form to get the current state
2. `.map()` — Create a NEW array
3. For the matching message, create a NEW object with `{ ...m, content: m.content + data.content }`
4. For other messages, return them unchanged

### Session Recovery on 404

```typescript
let res = await fetch("/api/chat/prompt", { ... });

if (res.status === 404 && agentId) {
  // Session expired — recreate and retry
  const sessionRes = await fetch("/api/chat/session", { ... });
  const sessionData = await sessionRes.json();
  if (sessionData.sessionId) {
    setSessionId(sessionData.sessionId);
    res = await fetch("/api/chat/prompt", {
      body: JSON.stringify({ sessionId: sessionData.sessionId, message: text }),
    });
  }
}
```

If the server returns 404 (session not found — maybe the server restarted), automatically create a new session and retry. The user never sees the error.

---

## 3. Custom Hooks

### use-voice.ts — Speech Recognition

```typescript
export function useVoice(): UseVoiceReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [provider, setProvider] = useState<VoiceProvider>("none");
```

**Custom hooks** encapsulate reusable stateful logic. `useVoice` handles:
- Detecting whether AWS Transcribe or Web Speech API is available
- Starting/stopping the microphone
- Converting speech to text
- Silence detection (auto-stop after 2 seconds of silence)

**Provider detection (runs once):**
```typescript
useEffect(() => {
  detectProvider().then((p) => {
    setProvider(p);
    setSupported(p !== "none");
  });
}, []);
```

The empty dependency array `[]` means this effect runs once on mount. It calls `/api/voice/capabilities` to check if AWS is available, falls back to checking browser support.

**Web Speech API flow:**
```typescript
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SR();
recognition.continuous = true;
recognition.interimResults = true;

recognition.onresult = (event) => {
  // Accumulate final + interim results
  silenceTimerRef.current = setTimeout(() => recognition.stop(), 2000);
};
recognition.onend = () => {
  setTranscript(accumulatedRef.current.trim());
  setIsListening(false);
};
```

**`useRef` vs `useState`:**
```typescript
const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const accumulatedRef = useRef("");
```

`useRef` stores values that persist across renders but DON'T trigger re-renders when changed. Perfect for:
- Timer IDs (we need to clear them, but changing them shouldn't re-render)
- Accumulated text during recognition (we only want to trigger a re-render when done)

### use-speech.ts — Text-to-Speech

```typescript
export function useSpeech(onEnd?: () => void): UseSpeechReturn {
```

**`onEnd` callback** — Called when speech finishes. The conversation builder uses this to auto-start listening again after the AI finishes speaking (voice conversation loop).

**Queue pattern for Polly TTS:**
```typescript
const queueRef = useRef<string[]>([]);

const playNext = useCallback(() => {
  if (!queueRef.current.length) {
    setIsSpeaking(false);
    onEndRef.current?.();
    return;
  }
  const text = queueRef.current.shift()!;
  fetch("/api/voice/synthesize", { method: "POST", body: JSON.stringify({ text }) })
    .then((r) => r.blob())
    .then((blob) => {
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => playNext();  // Play next in queue
      audio.play();
    });
}, []);
```

Sentences are queued and played one after another. This enables incremental TTS — speaking sentences as they stream in from the AI, rather than waiting for the full response.

---

## 4. Zustand Store — Builder State

```typescript
import { create } from "zustand";

export const useBuilderStore = create<BuilderState>((set) => ({
  messages: [],
  streaming: false,
  streamingText: "",
  pendingConfig: null,

  addMessage: (role, content) =>
    set((s) => ({
      messages: [...s.messages, { id: mkId(), role, content, timestamp: Date.now() }],
    })),
  setStreaming: (v) => set({ streaming: v }),
  appendStreamingText: (chunk) => set((s) => ({ streamingText: s.streamingText + chunk })),
  reset: () => set({ messages: [], streaming: false, streamingText: "", pendingConfig: null, pendingTeam: null, pendingFiles: [], createdAgents: [] }),
}));
```

**Zustand** is a minimal state management library. `create()` defines a store with state and actions.

**Why Zustand instead of `useState`?**
- The builder state is complex (messages, streaming text, pending configs, created agents)
- Multiple functions need to read/write the same state
- `useBuilderStore.getState()` can access state outside React components (in async callbacks)

### Config Parsing from LLM Response

```typescript
export function parseConfigFromResponse(text: string) {
  const singleMatch = text.match(/<agent_config>([\s\S]*?)<\/agent_config>/);
  if (singleMatch) {
    config = sanitizeConfig(JSON.parse(singleMatch[1].trim()));
    displayText = text.replace(/<agent_config>[\s\S]*?<\/agent_config>/, "").trim();
  }
```

The LLM outputs agent configs wrapped in XML tags. This function:
1. Extracts JSON from `<agent_config>` tags
2. Sanitizes it (validates tools, model names)
3. Removes the tags from the display text (user sees clean text, not raw JSON)

---

## 5. Component Patterns

### AgentTree — Recursive Tree Rendering

```typescript
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
```

**Two-pass tree building:**
1. First pass: Create a node for every agent, store in a Map
2. Second pass: Link children to parents. If no parent → it's a root node.

This converts a flat array into a tree structure for hierarchical rendering.

### AgentGrid — Optimistic Delete

```typescript
async function handleDelete(id: string) {
  if (!confirm("Delete this agent?")) return;
  const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
  if (res.ok) {
    setItems((prev) => prev.filter((a) => a.id !== id));
  }
}
```

**`confirm()`** — Browser built-in dialog. Returns `true` if user clicks OK.

After successful deletion, we remove the agent from local state immediately. This is faster than re-fetching the entire list.

---

## Key Takeaways

1. **Server Components** fetch data directly; **Client Components** use `fetch()` to call API routes
2. **Immutable state updates** are required by React — always create new objects/arrays
3. **Custom hooks** (`useVoice`, `useSpeech`) encapsulate complex stateful logic for reuse
4. **`useRef`** stores mutable values without triggering re-renders
5. **Zustand** provides simple global state management with `create()` and `set()`
6. **SSE reading** in the browser uses `ReadableStream` reader + `TextDecoder`
7. **Session recovery** transparently recreates expired sessions on 404

---

**Next up: Part 8 — Advanced Patterns**

---
---

# Part 8: Advanced Patterns — Delegation, Streaming, Error Handling, and Architecture

> This final part covers the cross-cutting patterns that tie everything together.

---

## 1. The Complete Delegation Flow

Here's the full sequence when a user asks an orchestrator to do something:

```
User: "Set up a CI/CD pipeline for my Node.js app"
  │
  ▼
Browser → POST /api/chat/prompt { sessionId, message }
  │
  ▼
Server: Send message to orchestrator via ACP
  │
  ▼
Orchestrator AI responds (streaming):
  "I'll delegate this to the DevOps specialist.
   <delegate to="devops-agent">Set up CI/CD pipeline for Node.js</delegate>"
  │
  ▼
Server: parseDelegation() detects the tag
  ├── Sends text before tag to browser: "I'll delegate this..."
  ├── Sends { type: "delegation", agent: "devops-agent", status: "start" }
  ├── Switches ACP session to devops-agent
  ├── Sends the task to devops-agent
  ├── Streams devops-agent's response to browser
  ├── Saves response to SQLite
  ├── Sends { type: "delegation", status: "end" }
  └── Switches back to orchestrator
  │
  ▼
Browser:
  ├── Shows orchestrator's explanation
  ├── Shows "Delegating to devops-agent" banner (amber, pulsing)
  ├── Highlights devops-agent in sidebar as active
  ├── Shows devops-agent's response (amber border)
  └── Removes active state when delegation ends
```

## 2. The Streaming Architecture

```
kiro-cli stdout → AcpClient.processBuffer() → EventEmitter.emit("update")
                                                        │
                                    ┌───────────────────┤
                                    ▼                   ▼
                            prompt/route.ts      builder/route.ts
                            onUpdate()           onChunk()
                                    │                   │
                                    ▼                   ▼
                            SSE stream              SSE stream
                            controller.enqueue()    controller.enqueue()
                                    │                   │
                                    ▼                   ▼
                            Browser fetch()      Browser fetch()
                            reader.read()        reader.read()
                                    │                   │
                                    ▼                   ▼
                            setMessages()        appendStreamingText()
                            (React state)        (Zustand store)
```

**Key insight:** The same EventEmitter pattern is used everywhere. Data flows from kiro-cli → through events → through SSE → to React state. Each layer only knows about its immediate neighbors.

## 3. Error Handling Strategy

The codebase uses a consistent error handling pattern across all layers:

### Layer 1: Validation (Zod)
```typescript
// Catches bad input BEFORE any processing
const { sessionId, message } = ChatPromptRequestSchema.parse(body);
// Throws ZodError with detailed field-level errors
```

### Layer 2: Business Logic
```typescript
// Catches "not found" cases
const session = sessionManager.getSession(sessionId);
if (!session) {
  return new Response(JSON.stringify({ error: { code: "SESSION_NOT_FOUND" } }), { status: 404 });
}
```

### Layer 3: External Services
```typescript
// Catches kiro-cli failures
try {
  await sessionManager.createSession(agent.config.name);
} catch (e) {
  const msg = e instanceof Error ? e.message : "Failed to create session";
  const code = msg.includes("kiro-cli") ? "ACP_CONNECTION_FAILED" : "INTERNAL_ERROR";
  return NextResponse.json({ error: { code, message: msg } }, { status: code === "ACP_CONNECTION_FAILED" ? 503 : 500 });
}
```

### Layer 4: Stream Errors
```typescript
// Errors during streaming are sent as SSE events
send({ type: "error", message: (err as Error).message });
close();
```

**Consistent error shape:** Every error response follows the same format:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

## 4. The Singleton Pattern (Used Three Times)

```typescript
// 1. Database connection (chat-history.ts)
let _db: Database.Database | null = null;
function getDb() { if (!_db) { _db = new Database(DB_PATH); } return _db; }

// 2. Session manager (session-manager.ts)
export const sessionManager = new AcpSessionManager();

// 3. Builder session (builder-provider.ts)
let activeSession: BuilderSession | null = null;
```

All three use module-level variables that persist across requests in Next.js. This is essential because:
- Database connections are expensive to create
- ACP sessions are long-lived processes
- The builder needs conversation continuity

## 5. The Voice Conversation Loop

The builder supports a full voice conversation:

```
User speaks → useVoice captures → transcript sent to LLM
                                          │
                                          ▼
                                   LLM streams response
                                          │
                                          ▼
                              useSpeech speaks sentences
                              (incremental, as they stream)
                                          │
                                          ▼
                              onEnd callback fires
                                          │
                                          ▼
                              useVoice starts listening again
                                          │
                                          ▼
                              User speaks next message...
```

**Incremental TTS** is the key innovation:
```typescript
useEffect(() => {
  if (!streaming || !voiceMode || !streamingText) return;
  const unspoken = streamingText.slice(spokenLenRef.current);
  const regex = /[.!?]\s+|\n+/g;
  let match;
  while ((match = regex.exec(unspoken)) !== null) {
    const sentence = stripMd(unspoken.slice(lastEnd, match.index + 1));
    if (sentence) enqueue(sentence);
  }
}, [streamingText]);
```

As text streams in character by character, we detect sentence boundaries (`.`, `!`, `?` followed by whitespace) and speak each sentence immediately. The user hears the response while it's still being generated.

## 6. Security Measures

| Threat | Protection | Where |
|--------|-----------|-------|
| SQL Injection | Parameterized queries (`?`) | `chat-history.ts` |
| Path Traversal | `safePath()` / `validatePath()` | `config-service.ts`, `client.ts` |
| XSS | React auto-escapes JSX output | All components |
| Process Injection | No user input in `spawn()` args | `client.ts` |
| Resource Exhaustion | Session pool limit (MAX_SESSIONS) | `session-manager.ts` |
| Stale Data | `force-dynamic` on server pages | All server pages |

## 7. Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA FLOW                                 │
│                                                                   │
│  Agent Configs:                                                   │
│  .kiro/agents/*.json ←→ config-service.ts ←→ API routes ←→ UI   │
│                                                                   │
│  Chat History:                                                    │
│  .kiro/chat-history.db ←→ chat-history.ts ←→ API routes ←→ UI   │
│                                                                   │
│  AI Communication:                                                │
│  kiro-cli (stdio) ←→ AcpClient ←→ SessionManager ←→ API ←→ UI  │
│                                                                   │
│  Builder State:                                                   │
│  Zustand store ←→ ConversationBuilder component                  │
│                                                                   │
│  Voice:                                                           │
│  Microphone → useVoice hook → text → API → AI → useSpeech → 🔊  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Delegation** is detected via XML tags in the AI's streaming response
2. **Streaming** flows through 4 layers: kiro-cli → EventEmitter → SSE → React state
3. **Error handling** is layered: validation → business logic → external services → stream
4. **Singletons** for DB, session manager, and builder persist across requests
5. **Incremental TTS** speaks sentences as they stream in, enabling natural voice conversations
6. **Security** is enforced at every boundary: input validation, path checks, parameterized queries

---
---

# Index — Complete Learning Guide

| Part | Topic | Key Concepts |
|------|-------|-------------|
| **1** | [Foundations](#part-1-foundations--nodejs-typescript-and-nextjs) | Node.js APIs, TypeScript types, Next.js App Router, Server vs Client Components |
| **2** | [Project Configuration](#part-2-project-configuration--every-config-file-explained) | package.json, tsconfig.json, next.config.ts, Tailwind CSS 4, environment variables |
| **3** | [Database Layer](#part-3-database-layer--sqlite-wal-mode-and-chat-historyts) | SQLite, WAL mode, better-sqlite3, singleton pattern, SQL queries, indexes |
| **4** | [Agent System](#part-4-agent-system--schemas-config-service-and-file-based-storage) | Zod validation, file-based storage, UUID index, mutex locks, path security |
| **5** | [ACP Integration](#part-5-acp-integration--json-rpc-stdio-and-the-client-architecture) | JSON-RPC 2.0, child processes, bidirectional communication, session pool, LRU eviction |
| **6** | [API Routes](#part-6-api-routes--every-endpoint-explained) | SSE streaming, ReadableStream, delegation detection, error handling |
| **7** | [Frontend](#part-7-frontend--react-components-hooks-and-state-management) | React hooks, Zustand, SSE reading, immutable updates, custom hooks |
| **8** | [Advanced Patterns](#part-8-advanced-patterns--delegation-streaming-error-handling-and-architecture) | Full delegation flow, streaming architecture, security, voice loop |

---

**Total files covered:** 40+
**Total concepts explained:** 100+

This guide covers every source file in the Voice Agent Studio codebase. Each concept is explained with theory, examples, and context showing exactly where and why it's used in the project.
