import crypto from "node:crypto";
import { askCodex } from "./codexBridge";
import type { CodexReasoningEffort } from "./types";
import type { CodexUsageRecord } from "../shared/cost";

export type QuizDifficulty = "easy" | "medium" | "hard";
export type QuizGradeStatus = "correct" | "partial" | "incorrect";

export interface QuizComponent {
  id: string;
  title: string;
  description: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
  evidenceMarkdown: string;
  componentTitle: string;
  difficulty: QuizDifficulty;
}

export interface QuizGrade {
  status: QuizGradeStatus;
  grade: number;
  markdown: string;
  spokenSummary: string;
}

interface QuizCodexInput {
  conversationId?: string;
  targetPath: string;
  reasoningEffort?: CodexReasoningEffort;
  model?: string;
}

interface QuizCodexResult {
  conversationId: string;
  codexSessionId?: string;
  usage?: CodexUsageRecord;
}

export async function proposeQuizComponents(
  input: QuizCodexInput
): Promise<QuizCodexResult & { components: QuizComponent[] }> {
  const result = await askCodex({
    conversationId: input.conversationId,
    targetPath: input.targetPath,
    title: "Quiz components",
    reasoningEffort: input.reasoningEffort,
    model: input.model,
    question: buildComponentsPrompt()
  });

  return {
    conversationId: result.conversationId,
    codexSessionId: result.codexSessionId,
    usage: result.usage,
    components: parseQuizComponentsAnswer(result.answer)
  };
}

export async function generateQuizQuestions(input: QuizCodexInput & {
  component: QuizComponent;
  difficulty: QuizDifficulty;
  count: number;
}): Promise<QuizCodexResult & { questions: QuizQuestion[] }> {
  const result = await askCodex({
    conversationId: input.conversationId,
    targetPath: input.targetPath,
    title: "Quiz questions",
    reasoningEffort: input.reasoningEffort,
    model: input.model,
    question: buildQuestionsPrompt(input.component, input.difficulty, input.count)
  });

  return {
    conversationId: result.conversationId,
    codexSessionId: result.codexSessionId,
    usage: result.usage,
    questions: parseQuizQuestionsAnswer(result.answer, input.component.title, input.difficulty)
  };
}

export async function gradeQuizAnswer(input: QuizCodexInput & {
  question: QuizQuestion;
  answer: string;
}): Promise<QuizCodexResult & { grade: QuizGrade }> {
  const result = await askCodex({
    conversationId: input.conversationId,
    targetPath: input.targetPath,
    title: "Quiz grading",
    reasoningEffort: input.reasoningEffort,
    model: input.model,
    question: buildGradingPrompt(input.question, input.answer)
  });

  return {
    conversationId: result.conversationId,
    codexSessionId: result.codexSessionId,
    usage: result.usage,
    grade: parseQuizGradeAnswer(result.answer)
  };
}

export function normalizeQuizDifficulty(value: unknown): QuizDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }

  return "medium";
}

export function normalizeQuestionCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(20, Math.max(1, Math.trunc(parsed)));
}

export function parseQuizComponentsAnswer(answer: string): QuizComponent[] {
  const parsed = parseJsonObject(answer);
  const rawComponents = Array.isArray(parsed.components) ? parsed.components : [];
  const ids = new Set<string>();

  return rawComponents
    .map((item, index) => {
      const object = readObject(item);
      const title = readString(object?.title);

      if (!title) {
        return undefined;
      }

      const baseId = slugify(title) || `component-${index + 1}`;
      const id = uniqueId(baseId, ids);

      return {
        id,
        title,
        description: readString(object?.description) || "Codebase component"
      };
    })
    .filter((component): component is QuizComponent => Boolean(component));
}

export function parseQuizQuestionsAnswer(
  answer: string,
  componentTitle: string,
  difficulty: QuizDifficulty
): QuizQuestion[] {
  const parsed = parseJsonObject(answer);
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

  return rawQuestions
    .map((item, index) => {
      const object = readObject(item);
      const question = readString(object?.question);
      const expectedAnswer = readString(object?.expected_answer ?? object?.expectedAnswer);

      if (!question || !expectedAnswer) {
        return undefined;
      }

      return {
        id: `q-${index + 1}-${crypto.randomUUID().slice(0, 8)}`,
        question,
        expectedAnswer,
        evidenceMarkdown:
          readString(object?.evidence_markdown ?? object?.evidenceMarkdown) ||
          "Codex did not provide evidence for this question.",
        componentTitle,
        difficulty
      };
    })
    .filter((question): question is QuizQuestion => Boolean(question));
}

export function parseQuizGradeAnswer(answer: string): QuizGrade {
  const parsed = parseJsonObject(answer);
  const grade = Number(parsed.grade);
  const markdown = readString(parsed.markdown);
  const spokenSummary = readString(parsed.spoken_summary ?? parsed.spokenSummary);

  return {
    status: normalizeGradeStatus(parsed.status),
    grade: Number.isFinite(grade) ? Math.min(10, Math.max(0, Math.round(grade))) : 0,
    markdown: markdown || "No grading explanation was returned.",
    spokenSummary: spokenSummary || "I graded the answer. Check the card for details."
  };
}

export function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Codex did not return a JSON object.");
  }

  return trimmed.slice(start, end + 1);
}

function buildComponentsPrompt(): string {
  return [
    "Task: inspect this repo and propose component choices for a codebase quiz.",
    "",
    "Return only valid JSON with this shape:",
    '{"components":[{"title":"Backend Codex bridge","description":"How the server runs Codex and resumes sessions."}]}',
    "",
    "Rules:",
    "1. Inspect the repository before choosing components.",
    "2. Return 5 to 8 meaningful components or subsystems.",
    "3. Do not include a whole-codebase option. The UI adds that itself.",
    "4. Keep each description under 140 characters.",
    "5. Do not include Markdown or prose outside the JSON object."
  ].join("\n");
}

function buildQuestionsPrompt(
  component: QuizComponent,
  difficulty: QuizDifficulty,
  count: number
): string {
  return [
    "Task: inspect this repo and generate codebase quiz questions.",
    "",
    `Component: ${component.title}`,
    `Component description: ${component.description}`,
    `Difficulty: ${difficulty}`,
    `Question count: ${count}`,
    "",
    "Difficulty rules:",
    "easy: high-level responsibilities, main files, and obvious control flow.",
    "medium: interactions between modules, important data flow, and behavior details.",
    "hard: architecture, data flow, and tradeoffs. Avoid trivia that only asks for exact names.",
    "",
    "Return only valid JSON with this shape:",
    '{"questions":[{"question":"What starts the local Realtime session?","expected_answer":"The Express route receives SDP and calls createRealtimeSession, which posts to the Realtime API.","evidence_markdown":"See [server/index.ts:14](server/index.ts:14) and [server/realtime.ts:129](server/realtime.ts:129)."}]}',
    "",
    "Rules:",
    "1. Inspect relevant files before writing questions.",
    "2. Questions must not reveal their answers.",
    "3. Each expected answer should be clear enough for grading a spoken answer.",
    "4. Each evidence_markdown must include at least one file and line reference as a Markdown link like [path:line](path:line).",
    "5. Do not include Markdown or prose outside the JSON object."
  ].join("\n");
}

function buildGradingPrompt(question: QuizQuestion, answer: string): string {
  return [
    "Task: grade a spoken answer to a codebase quiz question.",
    "",
    `Component: ${question.componentTitle}`,
    `Difficulty: ${question.difficulty}`,
    `Question: ${question.question}`,
    `Expected answer: ${question.expectedAnswer}`,
    `Evidence Markdown: ${question.evidenceMarkdown}`,
    `User answer transcript: ${answer}`,
    "",
    "Rubric:",
    "1. Be a friendly teacher. Do not require exact wording.",
    "2. Accept answers that show the correct idea, even if they miss exact names.",
    "3. Mark partial when the answer is directionally right but misses important behavior.",
    "4. Mark incorrect when the answer is mostly wrong or not about the question.",
    "5. Grade out of 10. Correct is usually 8-10, partial is usually 4-7, incorrect is usually 0-3.",
    "6. The Markdown explanation must include code evidence with file and line references.",
    "7. The spoken_summary must be at most two sentences and must not include file names, paths, or line numbers.",
    "",
    "Return only valid JSON with this shape:",
    '{"status":"partial","grade":6,"markdown":"**Partial, 6/10.** You got the main flow right, but missed that the browser returns the function output to Realtime. Evidence: [src/App.tsx:525](src/App.tsx:525).","spoken_summary":"That is partly right. You got the main flow, but missed one important bridge step."}'
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const jsonText = extractJsonObjectText(text);
  const parsed = JSON.parse(jsonText) as unknown;
  const object = readObject(parsed);

  if (!object) {
    throw new Error("Codex JSON response was not an object.");
  }

  return object;
}

function normalizeGradeStatus(value: unknown): QuizGradeStatus {
  if (value === "correct" || value === "partial" || value === "incorrect") {
    return value;
  }

  return "incorrect";
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function uniqueId(baseId: string, usedIds: Set<string>): string {
  let id = baseId;
  let suffix = 2;

  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(id);
  return id;
}
