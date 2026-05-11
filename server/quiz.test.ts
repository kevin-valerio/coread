import { describe, expect, it } from "vitest";
import {
  extractJsonObjectText,
  normalizeQuestionCount,
  parseQuizComponentsAnswer,
  parseQuizGradeAnswer,
  parseQuizQuestionsAnswer
} from "./quiz";

describe("quiz JSON parsing", () => {
  it("extracts JSON from a fenced block", () => {
    expect(extractJsonObjectText('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("parses component choices with stable ids", () => {
    const components = parseQuizComponentsAnswer(
      JSON.stringify({
        components: [
          {
            title: "Realtime bridge",
            description: "WebRTC session setup."
          },
          {
            title: "Realtime bridge",
            description: "Tool calls."
          }
        ]
      })
    );

    expect(components).toEqual([
      {
        id: "realtime-bridge",
        title: "Realtime bridge",
        description: "WebRTC session setup."
      },
      {
        id: "realtime-bridge-2",
        title: "Realtime bridge",
        description: "Tool calls."
      }
    ]);
  });

  it("parses quiz questions from snake_case JSON", () => {
    const questions = parseQuizQuestionsAnswer(
      JSON.stringify({
        questions: [
          {
            question: "What validates the selected path?",
            expected_answer: "The server resolves the directory before saving it.",
            evidence_markdown: "See [server/index.ts:47](server/index.ts:47)."
          }
        ]
      }),
      "Path validation",
      "easy"
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      question: "What validates the selected path?",
      expectedAnswer: "The server resolves the directory before saving it.",
      evidenceMarkdown: "See [server/index.ts:47](server/index.ts:47).",
      componentTitle: "Path validation",
      difficulty: "easy"
    });
  });

  it("parses and clamps quiz grades", () => {
    const grade = parseQuizGradeAnswer(
      JSON.stringify({
        status: "partial",
        grade: 12,
        markdown: "**Partial.** Missing one key point.",
        spoken_summary: "Partly right, but one key point is missing."
      })
    );

    expect(grade).toEqual({
      status: "partial",
      grade: 10,
      markdown: "**Partial.** Missing one key point.",
      spokenSummary: "Partly right, but one key point is missing."
    });
  });
});

describe("normalizeQuestionCount", () => {
  it("keeps question counts within the supported range", () => {
    expect(normalizeQuestionCount(0)).toBe(1);
    expect(normalizeQuestionCount(10)).toBe(10);
    expect(normalizeQuestionCount(99)).toBe(20);
  });
});
