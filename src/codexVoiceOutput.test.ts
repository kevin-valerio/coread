import { describe, expect, it } from "vitest";
import {
  buildCodexVoiceToolError,
  buildCodexVoiceToolOutput,
  extractCodexSpokenSummary
} from "./codexVoiceOutput";

describe("extractCodexSpokenSummary", () => {
  it("uses the short version paragraph and strips file references", () => {
    const answer = [
      "**Short version:** The voice should speak the small summary while the detailed answer stays visible. Evidence: [src/App.tsx:975](src/App.tsx:975).",
      "",
      "Details stay in the transcript."
    ].join("\n");

    expect(extractCodexSpokenSummary(answer)).toBe(
      "The voice should speak the small summary while the detailed answer stays visible."
    );
  });

  it("uses the paragraph after a short answer label", () => {
    const answer = [
      "Short answer:",
      "",
      "The bridge now sends a compact voice payload.",
      "",
      "The full answer is still stored."
    ].join("\n");

    expect(extractCodexSpokenSummary(answer)).toBe("The bridge now sends a compact voice payload.");
  });

  it("falls back to the first paragraph", () => {
    expect(extractCodexSpokenSummary("Codex found the issue.\n\nMore detail follows.")).toBe(
      "Codex found the issue."
    );
  });
});

describe("buildCodexVoiceToolOutput", () => {
  it("keeps only the spoken summary for Realtime", () => {
    const output = buildCodexVoiceToolOutput({
      conversationId: "conversation-1",
      codexSessionId: "session-1",
      answer: "Short version: The fix is in the bridge.\n\nFull detailed answer.",
      durationMs: 100,
      outputFile: ".data/codex-output/result.md"
    });

    expect(output).toEqual({
      conversation_id: "conversation-1",
      codex_session_id: "session-1",
      spoken_summary: "The fix is in the bridge.",
      full_answer_visible_in_transcript: true
    });
    expect(JSON.stringify(output)).not.toContain("Full detailed answer");
  });

  it("builds a compact error payload for Realtime", () => {
    expect(buildCodexVoiceToolError("Codex turn failed: Unsupported model", "conversation-1")).toEqual({
      conversation_id: "conversation-1",
      spoken_summary: "Codex could not complete that check. The error is visible in the transcript.",
      full_answer_visible_in_transcript: true,
      error: "Codex turn failed: Unsupported model"
    });
  });
});
