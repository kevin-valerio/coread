import fs from "node:fs/promises";
import path from "node:path";

interface SystemPromptStoreFile {
  voiceSystemPrompt?: string;
  updatedAt?: string;
}

const dataDir = path.resolve(".data");
const storePath = path.join(dataDir, "system-prompts.json");

async function readStore(): Promise<SystemPromptStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("System prompt store must be a JSON object.");
    }

    return parsed as SystemPromptStoreFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: SystemPromptStoreFile): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function readVoiceSystemPromptRecord(): Promise<{
  voiceSystemPrompt?: string;
  updatedAt?: string;
}> {
  const store = await readStore();

  return {
    voiceSystemPrompt:
      typeof store.voiceSystemPrompt === "string" ? store.voiceSystemPrompt : undefined,
    updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : undefined
  };
}

export async function writeVoiceSystemPrompt(
  voiceSystemPrompt: string,
  updatedAt = new Date().toISOString()
): Promise<{
  voiceSystemPrompt: string;
  updatedAt: string;
}> {
  const store = await readStore();

  if (store.updatedAt && store.updatedAt > updatedAt) {
    return {
      voiceSystemPrompt:
        typeof store.voiceSystemPrompt === "string" ? store.voiceSystemPrompt : "",
      updatedAt: store.updatedAt
    };
  }

  const nextStore = {
    ...store,
    voiceSystemPrompt,
    updatedAt
  };

  await writeStore(nextStore);
  return { voiceSystemPrompt, updatedAt };
}
