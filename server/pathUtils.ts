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

export async function resolveFileInsideDirectory(rootInput: string, fileInput: string): Promise<string> {
  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const trimmedFile = fileInput.trim();

  if (!trimmedFile) {
    throw new Error("File path is required");
  }

  const expandedFile = expandUserPath(trimmedFile);
  const candidate = path.isAbsolute(expandedFile)
    ? path.resolve(expandedFile)
    : path.resolve(root, expandedFile);
  const fileRealPath = await fs.realpath(candidate);
  const relativePath = path.relative(rootRealPath, fileRealPath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("File is outside the selected codebase");
  }

  const stat = await fs.stat(fileRealPath);

  if (!stat.isFile()) {
    throw new Error("Path is not a file");
  }

  return fileRealPath;
}
