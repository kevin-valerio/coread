import { describe, expect, it } from "vitest";
import { buildRealtimeSessionConfig } from "./realtime";

describe("buildRealtimeSessionConfig", () => {
  it("includes voice speed and custom voice instructions", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "high",
      voiceSpeed: "very-fast",
      voiceSystemPrompt: "Answer in one sentence."
    });

    const instructions = String(config.instructions);

    expect(instructions).toContain("Voice speed: very fast");
    expect(instructions).toContain("Answer in one sentence.");
    expect(instructions).toContain("Do not say file names, paths, or line numbers aloud.");
    expect(instructions).toContain("Codex reasoning amount selected by the user: high");
  });

  it("falls back to fast voice speed", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "medium",
      voiceSpeed: "unsupported"
    });

    expect(String(config.instructions)).toContain("Voice speed: fast.");
  });
});
