import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexAnswer, CodexQuestion, ConversationRecord } from "./types";
import { buildFirstTurnPrompt, buildFollowUpPrompt } from "./prompts";
import { createConversation, getConversation, updateConversation } from "./store";
import { resolveDirectory } from "./pathUtils";

const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS ?? 900000);
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface CodexRunResult {
  answer: string;
  stdout: string;
  stderr: string;
  outputFile: string;
}

export function extractSessionIdFromText(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const found = findSessionIdInJson(parsed);
      if (found) {
        return found;
      }
    } catch {
      const sessionMatch = line.match(/(?:session|thread|rollout)[^0-9a-f]+([0-9a-f-]{36})/i);
      if (sessionMatch?.[1] && uuidPattern.test(sessionMatch[1])) {
        return sessionMatch[1];
      }
    }
  }

  return undefined;
}

function findSessionIdInJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSessionIdInJson(item);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  const object = value as Record<string, unknown>;

  for (const [key, nested] of Object.entries(object)) {
    if (
      typeof nested === "string" &&
      uuidPattern.test(nested) &&
      /session|thread|rollout|conversation/i.test(key)
    ) {
      return nested.match(uuidPattern)?.[0];
    }
  }

  for (const nested of Object.values(object)) {
    const found = findSessionIdInJson(nested);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export async function askCodex(input: CodexQuestion): Promise<CodexAnswer> {
  const targetPath = await resolveDirectory(input.targetPath);
  const conversation = await loadOrCreateConversation(input, targetPath);
  const isFirstTurn = !conversation.codexSessionId;
  const prompt = isFirstTurn
    ? buildFirstTurnPrompt(conversation, input.question)
    : buildFollowUpPrompt(conversation, input.question);

  const startedAt = Date.now();
  const run = await runCodex(conversation, prompt, isFirstTurn);
  const detectedSessionId =
    conversation.codexSessionId ??
    extractSessionIdFromText(run.stdout) ??
    (await findSessionIdByToken(conversation.token, startedAt));

  conversation.codexSessionId = detectedSessionId;
  conversation.turns += 1;
  conversation.updatedAt = new Date().toISOString();
  await updateConversation(conversation);

  return {
    conversationId: conversation.id,
    codexSessionId: conversation.codexSessionId,
    answer: run.answer,
    durationMs: Date.now() - startedAt,
    outputFile: run.outputFile
  };
}

async function loadOrCreateConversation(
  input: CodexQuestion,
  targetPath: string
): Promise<ConversationRecord> {
  if (input.conversationId) {
    const existing = await getConversation(input.conversationId);

    if (!existing) {
      throw new Error("Conversation not found");
    }

    return existing;
  }

  return createConversation({
    targetPath,
    mode: input.mode,
    title: input.title
  });
}

async function runCodex(
  conversation: ConversationRecord,
  prompt: string,
  isFirstTurn: boolean
): Promise<CodexRunResult> {
  const outputDir = path.resolve(".data", "codex-output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${conversation.id}-${Date.now()}.md`);
  const args = isFirstTurn
    ? [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        conversation.targetPath,
        "-o",
        outputFile,
        "-"
      ]
    : [
        "exec",
        "resume",
        conversation.codexSessionId ?? "",
        "--json",
        "--skip-git-repo-check",
        "-c",
        'sandbox_mode="read-only"',
        "-o",
        outputFile,
        "-"
      ];

  const { stdout, stderr } = await runProcess("codex", args, prompt, conversation.targetPath);
  const answer = await readOutputAnswer(outputFile, stdout);

  if (!answer.trim()) {
    throw new Error(`Codex returned no answer. stderr: ${stderr.slice(-1000)}`);
  }

  return { answer, stdout, stderr, outputFile };
}

function runProcess(
  command: string,
  args: string[],
  stdin: string,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(new Error(`Codex timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }

      settled = true;

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Codex exited with code ${code}. stderr: ${stderr.slice(-2000)}`));
      }
    });

    child.stdin.end(stdin);
  });
}

async function readOutputAnswer(outputFile: string, stdout: string): Promise<string> {
  try {
    return await fs.readFile(outputFile, "utf8");
  } catch {
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]) as { msg?: string; message?: string; text?: string };
        const value = parsed.msg ?? parsed.message ?? parsed.text;
        if (value) {
          return value;
        }
      } catch {
        continue;
      }
    }
  }

  return "";
}

async function findSessionIdByToken(token: string, startedAt: number): Promise<string | undefined> {
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  const candidateFiles = await listRecentSessionFiles(sessionsRoot, startedAt - 5000);

  for (const file of candidateFiles) {
    const content = await fs.readFile(file, "utf8");

    if (content.includes(token)) {
      const filenameMatch = path.basename(file).match(uuidPattern);
      return filenameMatch?.[0] ?? extractSessionIdFromText(content);
    }
  }

  return undefined;
}

async function listRecentSessionFiles(root: string, minMtimeMs: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
          return;
        }

        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs >= minMtimeMs) {
          results.push(fullPath);
        }
      })
    );
  }

  await walk(root);
  return results.sort();
}

