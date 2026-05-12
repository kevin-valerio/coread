import { describe, expect, it } from "vitest";
import type { ConversationRecord } from "./types";
import { buildFirstTurnPrompt, buildFollowUpPrompt } from "./prompts";

const conversation: ConversationRecord = {
  id: "conversation-1",
  title: "Codebase question",
  token: "rtcodex-token",
  targetPath: "/tmp/project",
  reasoningEffort: "low",
  turns: 0,
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z"
};

describe("Codex prompts", () => {
  it("bounds first-turn investigations for fast voice answers", () => {
    const prompt = buildFirstTurnPrompt(conversation, "What does this repo do?");

    expect(prompt).toContain("Fast interactive mode");
    expect(prompt).toContain("Stop once you have enough evidence");
    expect(prompt).toContain("at most three detail bullets");
    expect(prompt).toContain("Assume the user is new to this codebase");
    expect(prompt).toContain('Do not end with generic follow-up offers like "If you want, I can look ..."');
    expect(prompt).toContain("Target codebase: /tmp/project");
  });

  it("keeps follow-up prompts contextual and bounded", () => {
    const prompt = buildFollowUpPrompt(conversation, "Where should I look next?");

    expect(prompt).toContain("Use the previous context when it helps.");
    expect(prompt).toContain("For broad questions, check only high-signal files");
    expect(prompt).toContain("Do not keep searching for completeness.");
  });
});
