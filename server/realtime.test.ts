import { describe, expect, it } from "vitest";
import { buildRealtimeSessionConfig } from "./realtime";

describe("buildRealtimeSessionConfig", () => {
  it("includes voice speed and custom voice instructions", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "high",
      voice: "cedar",
      voiceSpeed: "very-fast",
      voiceSystemPrompt: "Answer in one sentence."
    });

    const instructions = String(config.instructions);

    expect(instructions).toContain("Voice speed: very fast");
    expect(instructions).toContain("Answer in one sentence.");
    expect(instructions).toContain(
      'Example: say "Let me check that", not "Let me check that quickly so I can give you the exact folder name."'
    );
    expect(instructions).toContain("This is a fast interactive conversation");
    expect(instructions).toContain("Do not give extra still-running status messages");
    expect(instructions).toContain(
      "For normal codebase questions, call get_codebase_overview, search_codebase, or read_codebase_file"
    );
    expect(instructions).toContain("Do not call ask_codex for normal orientation");
    expect(instructions).toContain("Only call ask_codex when the user explicitly asks for a deep pass");
    expect(instructions).toContain("Use one final assistant answer for each user turn.");
    expect(instructions).toContain("When ask_codex returns a spoken_summary field");
    expect(instructions).toContain("If ask_codex returns an error field");
    expect(instructions).toContain("Do not read the full Codex answer aloud.");
    expect(instructions).toContain("After saying the summary once, ask at most one short follow-up question");
    expect(instructions).toContain("Do not say file names, paths, or line numbers aloud.");
    expect(instructions).toContain("Keep exact file and line references in visible text only.");
    expect(instructions).toContain("Codex reasoning amount selected by the user: high");
    expect(config.audio).toEqual({ output: { voice: "cedar" } });
    expect(JSON.stringify(config.tools)).toContain("get_codebase_overview");
    expect(JSON.stringify(config.tools)).toContain("search_codebase");
    expect(JSON.stringify(config.tools)).toContain("read_codebase_file");
    expect(JSON.stringify(config.tools)).toContain("grade_quiz_answer");
  });

  it("falls back to very fast voice speed and marin voice", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "low",
      voice: "unsupported",
      voiceSpeed: "unsupported"
    });

    expect(String(config.instructions)).toContain("Voice speed: very fast.");
    expect(config.audio).toEqual({ output: { voice: "marin" } });
  });
});
