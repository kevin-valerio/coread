import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexAnswer, CodexQuestion, CodexReasoningEffort, ConversationRecord } from "./types";
import type { CodexUsageRecord } from "../shared/cost";
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
  usage?: CodexUsageRecord;
}

export interface CodexProgressEvent {
  type: "status" | "stdout" | "stderr" | "usage";
  text: string;
  usage?: CodexUsageRecord;
}

type CodexProgressHandler = (event: CodexProgressEvent) => void;

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

export function summarizeCodexJsonLine(line: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return line.trim() || undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const event = parsed as Record<string, unknown>;
  const type = String(event.type ?? "");

  if (type === "thread.started") {
    return `Codex thread started: ${String(event.thread_id ?? "unknown")}`;
  }

  if (type === "turn.started") {
    return "Codex turn started.";
  }

  if (type === "turn.completed") {
    const usage = event.usage as Record<string, unknown> | undefined;
    const outputTokens = usage?.output_tokens;
    const inputTokens = usage?.input_tokens;

    if (typeof inputTokens === "number" && typeof outputTokens === "number") {
      return `Codex turn completed. Tokens: ${inputTokens} input, ${outputTokens} output.`;
    }

    return "Codex turn completed.";
  }

  if (type === "error") {
    const message = readErrorMessage(event.message);
    return message ? `Codex error: ${message}` : "Codex error.";
  }

  if (type === "turn.failed") {
    const error = event.error as Record<string, unknown> | undefined;
    const message = readErrorMessage(error?.message);
    return message ? `Codex turn failed: ${message}` : "Codex turn failed.";
  }

  const payload = event.payload as Record<string, unknown> | undefined;

  if (type === "event_msg" && payload?.type === "task_complete") {
    return typeof payload.last_agent_message === "string" && payload.last_agent_message.trim()
      ? "Codex task completed."
      : "Codex task completed without a final answer.";
  }

  const item = event.item as Record<string, unknown> | undefined;

  if (!item) {
    return type || undefined;
  }

  if (item.type === "command_execution") {
    const command = String(item.command ?? "").trim();

    if (type === "item.started") {
      return command ? `$ ${command}` : "Codex started a command.";
    }

    const exitCode = item.exit_code;
    const output = String(item.aggregated_output ?? "").trim();
    const status = typeof exitCode === "number" ? `Command exited ${exitCode}.` : "Command completed.";

    return output ? `${status}\n${output}` : status;
  }

  if (item.type === "agent_message" && type === "item.completed") {
    return "Codex final answer is ready.";
  }

  return type || undefined;
}

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const nested = findErrorMessageInJson(parsed);
    return nested ?? value;
  } catch {
    return value;
  }
}

function findErrorMessageInJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findErrorMessageInJson(item);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  const object = value as Record<string, unknown>;
  if (typeof object.message === "string" && object.message.trim()) {
    return object.message;
  }

  for (const nested of Object.values(object)) {
    const found = findErrorMessageInJson(nested);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export function extractCodexModelFromJsonLine(line: string): string | undefined {
  const parsed = parseJsonLine(line);

  if (!parsed) {
    return undefined;
  }

  const event = parsed as Record<string, unknown>;
  const payload = event.payload as Record<string, unknown> | undefined;
  const model = event.model ?? payload?.model;

  if (typeof model === "string" && model.trim()) {
    return model;
  }

  if (event.type === "turn_context") {
    const contextModel = payload?.model;
    return typeof contextModel === "string" && contextModel.trim() ? contextModel : undefined;
  }

  return undefined;
}

export function formatCodexExitError(code: number | null, stdout: string, stderr: string): string {
  const exitCode = code ?? "unknown";
  const stderrText = stderr.trim();

  if (stderrText) {
    return `Codex exited with code ${exitCode}. stderr: ${stderrText.slice(-2000)}`;
  }

  const stdoutSummary = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => summarizeCodexJsonLine(line))
    .filter((line): line is string => Boolean(line))
    .slice(-6)
    .join("\n");

  if (stdoutSummary) {
    return `Codex exited with code ${exitCode} and did not write to stderr. Last stdout events:\n${stdoutSummary}`;
  }

  return `Codex exited with code ${exitCode} and did not write to stderr or stdout.`;
}

export function extractCodexUsageFromJsonLine(
  line: string,
  model: string | undefined
): CodexUsageRecord | undefined {
  const parsed = parseJsonLine(line);

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const event = parsed as Record<string, unknown>;

  if (event.type === "turn.completed") {
    const usage = readObject(event.usage);

    if (!usage) {
      return undefined;
    }

    return buildCodexUsage(usage, readModel(event, model));
  }

  const payload = readObject(event.payload);

  if (event.type === "event_msg" && payload?.type === "token_count") {
    const info = readObject(payload.info);
    const usage = readObject(info?.last_token_usage);
    const totalUsage = readObject(info?.total_token_usage);

    if (!usage) {
      return undefined;
    }

    return buildCodexUsage(usage, readModel(event, model), readNumber(totalUsage?.total_tokens));
  }

  return undefined;
}

export async function askCodex(
  input: CodexQuestion,
  onProgress?: CodexProgressHandler
): Promise<CodexAnswer> {
  const targetPath = await resolveDirectory(input.targetPath);
  const conversation = await loadOrCreateConversation(input, targetPath);
  const isFirstTurn = !conversation.codexSessionId;
  const prompt = isFirstTurn
    ? buildFirstTurnPrompt(conversation, input.question)
    : buildFollowUpPrompt(conversation, input.question);

  const startedAt = Date.now();
  const run = await runCodex(conversation, prompt, isFirstTurn, onProgress);
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
    outputFile: run.outputFile,
    usage: run.usage
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

    return {
      ...existing,
      reasoningEffort: input.reasoningEffort ?? existing.reasoningEffort ?? "low"
    };
  }

  return createConversation({
    targetPath,
    title: input.title,
    reasoningEffort: input.reasoningEffort
  });
}

async function runCodex(
  conversation: ConversationRecord,
  prompt: string,
  isFirstTurn: boolean,
  onProgress?: CodexProgressHandler
): Promise<CodexRunResult> {
  const outputDir = path.resolve(".data", "codex-output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${conversation.id}-${Date.now()}.md`);
  const reasoningConfig = `model_reasoning_effort="${getReasoningEffort(conversation.reasoningEffort)}"`;
  const args = isFirstTurn
    ? [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        reasoningConfig,
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
        "-c",
        reasoningConfig,
        "-o",
        outputFile,
        "-"
      ];

  onProgress?.({
    type: "status",
    text: isFirstTurn ? "Starting a new Codex session." : "Resuming the Codex session."
  });

  const { stdout, stderr, usage } = await runProcess(
    "codex",
    args,
    prompt,
    conversation.targetPath,
    onProgress
  );
  const answer = await readOutputAnswer(outputFile, stdout);

  if (!answer.trim()) {
    throw new Error(`Codex returned no answer. stderr: ${stderr.slice(-1000)}`);
  }

  return { answer, stdout, stderr, outputFile, usage };
}

function getReasoningEffort(value: CodexReasoningEffort | undefined): CodexReasoningEffort {
  return value ?? "low";
}

function runProcess(
  command: string,
  args: string[],
  stdin: string,
  cwd: string,
  onProgress?: CodexProgressHandler
): Promise<{ stdout: string; stderr: string; usage?: CodexUsageRecord }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let currentModel: string | undefined;
    let lastUsage: CodexUsageRecord | undefined;
    const emittedUsageKeys = new Set<string>();
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
      stdoutBuffer = emitCompleteLines(stdoutBuffer + chunk, (line) => {
        currentModel = extractCodexModelFromJsonLine(line) ?? currentModel;
        const text = summarizeCodexJsonLine(line);
        const usage = extractCodexUsageFromJsonLine(line, currentModel);

        if (text) {
          onProgress?.({ type: "stdout", text });
        }

        if (usage) {
          const usageKey = getCodexUsageKey(usage);

          if (!emittedUsageKeys.has(usageKey)) {
            emittedUsageKeys.add(usageKey);
            lastUsage = usage;
            onProgress?.({ type: "usage", text: "Codex token usage updated.", usage });
          }
        }
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      stderrBuffer = emitCompleteLines(stderrBuffer + chunk, (line) => {
        const text = line.trim();

        if (text) {
          onProgress?.({ type: "stderr", text });
        }
      });
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
        flushLineBuffer(stdoutBuffer, (line) => {
          currentModel = extractCodexModelFromJsonLine(line) ?? currentModel;
          const text = summarizeCodexJsonLine(line);
          const usage = extractCodexUsageFromJsonLine(line, currentModel);

          if (text) {
            onProgress?.({ type: "stdout", text });
          }

          if (usage) {
            const usageKey = getCodexUsageKey(usage);

            if (!emittedUsageKeys.has(usageKey)) {
              emittedUsageKeys.add(usageKey);
              lastUsage = usage;
              onProgress?.({ type: "usage", text: "Codex token usage updated.", usage });
            }
          }
        });
        flushLineBuffer(stderrBuffer, (line) => {
          const text = line.trim();

          if (text) {
            onProgress?.({ type: "stderr", text });
          }
        });
        resolve({ stdout, stderr, usage: lastUsage });
      } else {
        reject(new Error(formatCodexExitError(code, stdout, stderr)));
      }
    });

    child.stdin.end(stdin);
  });
}

function parseJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function buildCodexUsage(
  usage: Record<string, unknown>,
  model: string,
  cumulativeTotalTokens = 0
): CodexUsageRecord | undefined {
  const inputTokens = readNumber(usage.input_tokens);
  const outputTokens = readNumber(usage.output_tokens);
  const totalTokens = readNumber(usage.total_tokens) || inputTokens + outputTokens;

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return undefined;
  }

  return {
    source: "codex",
    model,
    inputTokens,
    cachedInputTokens: readNumber(usage.cached_input_tokens),
    outputTokens,
    reasoningOutputTokens: readNumber(usage.reasoning_output_tokens),
    totalTokens,
    cumulativeTotalTokens: cumulativeTotalTokens || undefined
  };
}

function readModel(event: Record<string, unknown>, fallback: string | undefined): string {
  const payload = readObject(event.payload);
  const eventModel = event.model ?? payload?.model;

  return typeof eventModel === "string" && eventModel.trim() ? eventModel : fallback ?? "unknown";
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getCodexUsageKey(usage: CodexUsageRecord): string {
  return [
    usage.model,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningOutputTokens,
    usage.totalTokens,
    usage.cumulativeTotalTokens ?? ""
  ].join(":");
}

function emitCompleteLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (line.trim()) {
      onLine(line);
    }
  }

  return remainder;
}

function flushLineBuffer(buffer: string, onLine: (line: string) => void): void {
  if (buffer.trim()) {
    onLine(buffer);
  }
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
