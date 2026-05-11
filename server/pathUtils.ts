import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export function expandUserPath(input: string): string {
  const trimmed = input.trim();

  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

export async function resolveDirectory(input: string): Promise<string> {
  const expanded = expandUserPath(input);
  const resolved = path.resolve(expanded);
  const stat = await fs.stat(resolved);

  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory");
  }

  return resolved;
}

