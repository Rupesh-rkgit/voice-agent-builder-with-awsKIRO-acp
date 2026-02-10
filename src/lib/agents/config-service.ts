import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  KiroAgentConfigSchema,
  type KiroAgentConfig,
  type AgentMeta,
  type CreateAgentRequest,
} from "./schema";

const WORKSPACE_DIR =
  process.env.KIRO_WORKSPACE_DIR || process.cwd();
const AGENTS_DIR = path.join(WORKSPACE_DIR, ".kiro", "agents");
const INDEX_FILE = path.join(AGENTS_DIR, ".agent-index.json");

// Simple mutex for index file writes to prevent race conditions
let indexLock: Promise<void> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = indexLock;
  let release: () => void;
  indexLock = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}

/**
 * Validate that a resolved path stays within AGENTS_DIR.
 */
function safePath(name: string): string {
  const resolved = path.resolve(AGENTS_DIR, `${name}.json`);
  if (!resolved.startsWith(path.resolve(AGENTS_DIR) + path.sep)) {
    throw new Error("Invalid agent name: path traversal detected");
  }
  return resolved;
}

// --- Index persistence (maps UUID → agent metadata) ---

async function readIndex(): Promise<Record<string, AgentMeta>> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    // ENOENT is expected on first run; anything else is worth logging
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[config-service] Failed to read agent index:", (e as Error).message);
    }
    return {};
  }
}

async function writeIndex(index: Record<string, AgentMeta>): Promise<void> {
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

// --- Public API ---

export async function listAgents(): Promise<AgentMeta[]> {
  const index = await readIndex();
  return Object.values(index).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getAgent(
  id: string
): Promise<{ meta: AgentMeta; config: KiroAgentConfig } | null> {
  const index = await readIndex();
  const meta = index[id];
  if (!meta) return null;

  try {
    const configPath = safePath(meta.name);
    const raw = await fs.readFile(configPath, "utf-8");
    const config = KiroAgentConfigSchema.parse(JSON.parse(raw));
    return { meta, config };
  } catch (e) {
    console.error(`[config-service] Failed to read agent ${meta.name}:`, (e as Error).message);
    return null;
  }
}

export async function createAgent(
  req: CreateAgentRequest
): Promise<AgentMeta> {
  await fs.mkdir(AGENTS_DIR, { recursive: true });

  const config = KiroAgentConfigSchema.parse(req);
  const configPath = safePath(config.name);

  // Check for name collision
  try {
    await fs.access(configPath);
    throw new Error(`Agent "${config.name}" already exists`);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("already exists")) throw e;
    // File doesn't exist — good
  }

  // Write the Kiro agent config JSON
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  // Update index (with lock to prevent race conditions)
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
}

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

  const configPath = safePath(merged.name);

  // If name changed, remove old file
  if (merged.name !== existing.meta.name) {
    const oldPath = safePath(existing.meta.name);
    await fs.unlink(oldPath).catch(() => {});
  }

  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));

  return withIndexLock(async () => {
    const index = await readIndex();
    index[id] = {
      ...index[id],
      name: merged.name,
      description: merged.description,
      configPath: `.kiro/agents/${merged.name}.json`,
      updatedAt: new Date().toISOString(),
    };
    await writeIndex(index);
    return index[id];
  });
}

export async function deleteAgent(id: string): Promise<boolean> {
  return withIndexLock(async () => {
    const index = await readIndex();
    const meta = index[id];
    if (!meta) return false;

    const configPath = safePath(meta.name);
    await fs.unlink(configPath).catch(() => {});

    delete index[id];
    await writeIndex(index);
    return true;
  });
}

export async function getChildAgents(parentId: string): Promise<AgentMeta[]> {
  const all = await listAgents();
  return all.filter((a) => a.parentAgentId === parentId);
}
