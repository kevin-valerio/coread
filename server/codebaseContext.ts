import fs from "node:fs/promises";
import path from "node:path";
import { resolveDirectory, resolveFileInsideDirectory } from "./pathUtils";

const ignoredDirectoryNames = new Set([
  ".data",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target"
]);
const keyFileNames = ["README.md", "readme.md", "AGENTS.md", "package.json", "Cargo.toml", "pyproject.toml"];
const maxSearchFileBytes = 250_000;
const defaultTreeLimit = 160;
const defaultSearchLimit = 30;
const defaultReadLineCount = 160;
const maxReadLineCount = 260;

export interface CodebaseOverview {
  targetPath: string;
  files: string[];
  keyFiles: Array<{
    path: string;
    content: string;
    truncated: boolean;
  }>;
}

export interface CodebaseSearchResult {
  query: string;
  matches: Array<{
    path: string;
    line: number;
    column: number;
    text: string;
  }>;
  truncated: boolean;
}

export interface CodebaseFileExcerpt {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  truncated: boolean;
}

export async function getCodebaseOverview(rootInput: string): Promise<CodebaseOverview> {
  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const files = await listCodebaseFiles(rootRealPath, defaultTreeLimit);
  const keyFiles = await readKeyFiles(rootRealPath, files);

  return {
    targetPath: rootRealPath,
    files,
    keyFiles
  };
}

export async function searchCodebase(
  rootInput: string,
  queryInput: string,
  maxResultsInput?: number
): Promise<CodebaseSearchResult> {
  const query = queryInput.trim();

  if (!query) {
    throw new Error("Search query is required");
  }

  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const limit = clampPositiveInteger(maxResultsInput, defaultSearchLimit, 1, 80);
  const files = await listCodebaseFiles(rootRealPath, 5000);
  const lowerQuery = query.toLowerCase();
  const matches: CodebaseSearchResult["matches"] = [];

  for (const relativePath of files) {
    if (matches.length >= limit) {
      break;
    }

    const absolutePath = path.join(rootRealPath, relativePath);
    const stat = await fs.stat(absolutePath);

    if (stat.size > maxSearchFileBytes) {
      continue;
    }

    const content = await readTextFile(absolutePath);

    if (content === undefined) {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const column = line.toLowerCase().indexOf(lowerQuery);

      if (column === -1) {
        continue;
      }

      matches.push({
        path: relativePath,
        line: index + 1,
        column: column + 1,
        text: line.trim().slice(0, 500)
      });

      if (matches.length >= limit) {
        break;
      }
    }
  }

  return {
    query,
    matches,
    truncated: matches.length >= limit
  };
}

export async function readCodebaseFileExcerpt(
  rootInput: string,
  fileInput: string,
  startLineInput?: number,
  lineCountInput?: number
): Promise<CodebaseFileExcerpt> {
  const filePath = await resolveFileInsideDirectory(rootInput, fileInput);
  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const relativePath = path.relative(rootRealPath, filePath);
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = clampPositiveInteger(startLineInput, 1, 1, Math.max(totalLines, 1));
  const lineCount = clampPositiveInteger(lineCountInput, defaultReadLineCount, 1, maxReadLineCount);
  const endLine = Math.min(totalLines, startLine + lineCount - 1);
  const excerptLines = lines.slice(startLine - 1, endLine);

  return {
    path: relativePath,
    startLine,
    endLine,
    totalLines,
    content: excerptLines.map((line, index) => `${startLine + index}: ${line}`).join("\n"),
    truncated: endLine < totalLines
  };
}

async function listCodebaseFiles(rootRealPath: string, limit: number): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    if (files.length >= limit) {
      return;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      if (files.length >= limit) {
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".github") {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootRealPath, absolutePath);

      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          await walk(absolutePath);
        }

        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await walk(rootRealPath);
  return files;
}

async function readKeyFiles(
  rootRealPath: string,
  files: string[]
): Promise<CodebaseOverview["keyFiles"]> {
  const selected = files.filter((file) => keyFileNames.includes(path.basename(file))).slice(0, 8);
  const keyFiles: CodebaseOverview["keyFiles"] = [];

  for (const relativePath of selected) {
    const absolutePath = path.join(rootRealPath, relativePath);
    const content = await readTextFile(absolutePath);

    if (content === undefined) {
      continue;
    }

    keyFiles.push({
      path: relativePath,
      content: content.slice(0, 4000),
      truncated: content.length > 4000
    });
  }

  return keyFiles;
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  const content = await fs.readFile(filePath);

  if (content.includes(0)) {
    return undefined;
  }

  return content.toString("utf8");
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
