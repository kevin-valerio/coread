import fs from "node:fs/promises";
import path from "node:path";

interface UiSettingsStoreFile {
  settings?: Record<string, unknown>;
  updatedAt?: string;
}

const dataDir = path.resolve(".data");
const storePath = path.join(dataDir, "ui-settings.json");

async function readStore(): Promise<UiSettingsStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("UI settings store must be a JSON object.");
    }

    return parsed as UiSettingsStoreFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: UiSettingsStoreFile): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function readUiSettingsRecord(): Promise<{
  settings?: Record<string, unknown>;
  updatedAt?: string;
}> {
  const store = await readStore();

  return {
    settings:
      store.settings && typeof store.settings === "object" && !Array.isArray(store.settings)
        ? store.settings
        : undefined,
    updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : undefined
  };
}

export async function writeUiSettings(
  settings: Record<string, unknown>,
  updatedAt = new Date().toISOString()
): Promise<{
  settings: Record<string, unknown>;
  updatedAt: string;
}> {
  const store = await readStore();

  if (store.updatedAt && store.updatedAt >= updatedAt) {
    return {
      settings:
        store.settings && typeof store.settings === "object" && !Array.isArray(store.settings)
          ? store.settings
          : {},
      updatedAt: store.updatedAt
    };
  }

  const nextStore = {
    settings,
    updatedAt
  };

  await writeStore(nextStore);
  return nextStore;
}
