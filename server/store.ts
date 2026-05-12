import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CodexReasoningEffort, ConversationRecord, ConversationStoreFile } from "./types";

const dataDir = path.resolve(".data");
const storePath = path.join(dataDir, "conversations.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    const initial: ConversationStoreFile = { conversations: [] };
    await fs.writeFile(storePath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
}

async function readStore(): Promise<ConversationStoreFile> {
  await ensureStore();
  const raw = await fs.readFile(storePath, "utf8");
  return JSON.parse(raw) as ConversationStoreFile;
}

async function writeStore(store: ConversationStoreFile): Promise<void> {
  await ensureStore();
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function listConversations(targetPath?: string): Promise<ConversationRecord[]> {
  const store = await readStore();
  const filtered = targetPath
    ? store.conversations.filter((conversation) => conversation.targetPath === targetPath)
    : store.conversations;

  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const store = await readStore();
  return store.conversations.find((conversation) => conversation.id === id);
}

export async function createConversation(input: {
  targetPath: string;
  title?: string;
  reasoningEffort?: CodexReasoningEffort;
}): Promise<ConversationRecord> {
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    id: crypto.randomUUID(),
    title: input.title?.trim() || "Codebase question",
    token: `rtcodex-${crypto.randomUUID()}`,
    targetPath: input.targetPath,
    reasoningEffort: input.reasoningEffort ?? "low",
    turns: 0,
    createdAt: now,
    updatedAt: now
  };

  const store = await readStore();
  store.conversations.push(record);
  await writeStore(store);
  return record;
}

export async function updateConversation(record: ConversationRecord): Promise<void> {
  const store = await readStore();
  const index = store.conversations.findIndex((conversation) => conversation.id === record.id);

  if (index === -1) {
    store.conversations.push(record);
  } else {
    store.conversations[index] = record;
  }

  await writeStore(store);
}
