import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import path from "node:path";
import { expandUserPath, resolveDirectory, resolveFileInsideDirectory } from "./pathUtils";

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
const defaultPathSearchLimit = 40;
const defaultDirectoryDepth = 1;
const defaultDirectoryLimit = 120;
const defaultReadLineCount = 160;
const maxReadLineCount = 260;
const defaultRipgrepLimit = 40;
const maxRipgrepPatternLength = 500;
const ripgrepTimeoutMs = 5000;

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

export interface CodebaseFileSearchResult {
  query: string;
  matches: string[];
  truncated: boolean;
}

export interface CodebaseDirectoryListing {
  path: string;
  entries: Array<{
    path: string;
    name: string;
    type: "directory" | "file";
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

export interface CodebaseRipgrepResult {
  pattern: string;
  path: string;
  matches: Array<{
    path: string;
    line: number;
    column: number;
    text: string;
  }>;
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

export async function findCodebaseFiles(
  rootInput: string,
  queryInput: string,
  maxResultsInput?: number
): Promise<CodebaseFileSearchResult> {
  const query = queryInput.trim();

  if (!query) {
    throw new Error("File search query is required");
  }

  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const limit = clampPositiveInteger(maxResultsInput, defaultPathSearchLimit, 1, 120);
  const lowerQuery = query.toLowerCase();
  const files = await listCodebaseFiles(rootRealPath, 10000);
  const matches: string[] = [];

  for (const relativePath of files) {
    if (!relativePath.toLowerCase().includes(lowerQuery)) {
      continue;
    }

    matches.push(relativePath);

    if (matches.length >= limit) {
      break;
    }
  }

  return {
    query,
    matches,
    truncated: matches.length >= limit
  };
}

export async function listCodebaseDirectory(
  rootInput: string,
  directoryInput?: string,
  depthInput?: number,
  maxResultsInput?: number
): Promise<CodebaseDirectoryListing> {
  const directory = await resolveDirectoryInsideRoot(rootInput, directoryInput ?? ".");
  const depth = clampPositiveInteger(depthInput, defaultDirectoryDepth, 1, 3);
  const limit = clampPositiveInteger(maxResultsInput, defaultDirectoryLimit, 1, 300);
  const entries: CodebaseDirectoryListing["entries"] = [];

  async function walk(currentDirectory: string, remainingDepth: number): Promise<void> {
    if (entries.length >= limit || remainingDepth < 1) {
      return;
    }

    const directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
    directoryEntries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    for (const entry of directoryEntries) {
      if (entries.length >= limit) {
        return;
      }

      if (shouldSkipEntry(entry)) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = path.relative(directory.rootRealPath, absolutePath);

      if (entry.isDirectory()) {
        entries.push({
          path: relativePath,
          name: entry.name,
          type: "directory"
        });
        await walk(absolutePath, remainingDepth - 1);
        continue;
      }

      if (entry.isFile()) {
        entries.push({
          path: relativePath,
          name: entry.name,
          type: "file"
        });
      }
    }
  }

  await walk(directory.absolutePath, depth);

  return {
    path: directory.relativePath,
    entries,
    truncated: entries.length >= limit
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

export async function runRipgrepCodebase(
  rootInput: string,
  patternInput: string,
  options: {
    searchPathInput?: string;
    maxResultsInput?: number;
    fixedStringsInput?: boolean;
    caseSensitiveInput?: boolean;
  } = {}
): Promise<CodebaseRipgrepResult> {
  const pattern = patternInput.trim();

  if (!pattern) {
    throw new Error("Ripgrep pattern is required");
  }

  if (pattern.length > maxRipgrepPatternLength) {
    throw new Error("Ripgrep pattern is too long");
  }

  const target = await resolveExistingPathInsideRoot(rootInput, options.searchPathInput ?? ".");
  const limit = clampPositiveInteger(options.maxResultsInput, defaultRipgrepLimit, 1, 120);
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--no-messages",
    "--max-columns",
    "500",
    "--max-columns-preview"
  ];

  if (options.fixedStringsInput) {
    args.push("--fixed-strings");
  }

  if (!options.caseSensitiveInput) {
    args.push("--ignore-case");
  }

  for (const directoryName of ignoredDirectoryNames) {
    args.push("--glob", `!**/${directoryName}/**`);
  }

  args.push("--", pattern, target.relativePath);

  try {
    return await executeRipgrep(args, target.rootRealPath, pattern, target.relativePath, limit);
  } catch (error) {
    const execError = error as Error & { code?: string };

    if (execError.code === "ENOENT") {
      throw new Error("ripgrep is not installed or not on PATH");
    }

    throw execError;
  }
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

      if (shouldSkipEntry(entry)) {
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

async function resolveDirectoryInsideRoot(rootInput: string, directoryInput: string): Promise<{
  rootRealPath: string;
  absolutePath: string;
  relativePath: string;
}> {
  const resolved = await resolveExistingPathInsideRoot(rootInput, directoryInput);
  const stat = await fs.stat(resolved.absolutePath);

  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory");
  }

  return resolved;
}

async function resolveExistingPathInsideRoot(rootInput: string, inputPath: string): Promise<{
  rootRealPath: string;
  absolutePath: string;
  relativePath: string;
}> {
  const root = await resolveDirectory(rootInput);
  const rootRealPath = await fs.realpath(root);
  const trimmedPath = inputPath.trim() || ".";
  const expandedPath = expandUserPath(trimmedPath);
  const candidatePath = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(rootRealPath, expandedPath);
  const absolutePath = await fs.realpath(candidatePath);
  const relativePath = path.relative(rootRealPath, absolutePath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Path is outside the selected codebase");
  }

  const stat = await fs.stat(absolutePath);

  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error("Path is not a file or directory");
  }

  return {
    rootRealPath,
    absolutePath,
    relativePath: relativePath || "."
  };
}

function shouldSkipEntry(entry: Pick<Dirent, "isDirectory" | "name">): boolean {
  if (entry.name.startsWith(".") && entry.name !== ".github") {
    return true;
  }

  return entry.isDirectory() && ignoredDirectoryNames.has(entry.name);
}

function executeRipgrep(
  args: string[],
  cwd: string,
  pattern: string,
  targetPath: string,
  limit: number
): Promise<CodebaseRipgrepResult> {
  return new Promise((resolve, reject) => {
    const matches: CodebaseRipgrepResult["matches"] = [];
    const child = spawn(
      "rg",
      args,
      {
        cwd,
        windowsHide: true
      }
    );
    let stdoutBuffer = "";
    let stderr = "";
    let stoppedAfterLimit = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      finishWithError(new Error("ripgrep timed out"));
    }, ripgrepTimeoutMs);

    function finishWithError(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    function finish(truncated: boolean): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        pattern,
        path: targetPath,
        matches,
        truncated
      });
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;

      while (stdoutBuffer.includes("\n")) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        appendRipgrepMatch(line, targetPath, matches, limit);

        if (matches.length >= limit && !child.killed) {
          stoppedAfterLimit = true;
          child.kill("SIGTERM");
          break;
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    child.on("error", finishWithError);
    child.on("close", (code, signal) => {
      if (!settled && stdoutBuffer && !stoppedAfterLimit) {
        appendRipgrepMatch(stdoutBuffer.replace(/\r$/, ""), targetPath, matches, limit);
      }

      if (stoppedAfterLimit || matches.length >= limit) {
        finish(true);
        return;
      }

      if (code === 0 || code === 1) {
        finish(false);
        return;
      }

      if (signal === "SIGTERM") {
        finishWithError(new Error("ripgrep timed out"));
        return;
      }

      finishWithError(new Error(stderr.trim() || "ripgrep failed"));
    });
  });
}

function appendRipgrepMatch(
  line: string,
  targetPath: string,
  matches: CodebaseRipgrepResult["matches"],
  limit: number
): void {
  if (!line || matches.length >= limit) {
    return;
  }

  const event = JSON.parse(line) as {
    type?: string;
    data?: {
      path?: { text?: string };
      line_number?: number;
      lines?: { text?: string };
      submatches?: Array<{ start?: number }>;
    };
  };

  if (event.type !== "match" || !event.data) {
    return;
  }

  matches.push({
    path: normalizeRipgrepPath(event.data.path?.text ?? targetPath),
    line: event.data.line_number ?? 1,
    column: (event.data.submatches?.[0]?.start ?? 0) + 1,
    text: (event.data.lines?.text ?? "").trimEnd().slice(0, 500)
  });
}

function normalizeRipgrepPath(inputPath: string): string {
  if (inputPath === ".") {
    return inputPath;
  }

  return path.normalize(inputPath.startsWith("./") ? inputPath.slice(2) : inputPath);
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
