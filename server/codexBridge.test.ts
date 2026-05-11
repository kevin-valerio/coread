import { describe, expect, it } from "vitest";
import { extractSessionIdFromText, summarizeCodexJsonLine } from "./codexBridge";

describe("extractSessionIdFromText", () => {
  it("reads a session id from JSON event text", () => {
    const id = "019e1646-6911-77c0-afd2-52ae5ed426d4";
    const text = JSON.stringify({ type: "thread.started", session_id: id });

    expect(extractSessionIdFromText(text)).toBe(id);
  });

  it("returns undefined when no session id is present", () => {
    expect(extractSessionIdFromText('{"type":"note","message":"hello"}')).toBeUndefined();
  });
});

describe("summarizeCodexJsonLine", () => {
  it("summarizes command execution output", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        aggregated_output: "realtime-codex-reviewer\n",
        exit_code: 0
      }
    });

    expect(summarizeCodexJsonLine(line)).toContain("realtime-codex-reviewer");
  });

  it("summarizes turn usage", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 2 }
    });

    expect(summarizeCodexJsonLine(line)).toBe("Codex turn completed. Tokens: 10 input, 2 output.");
  });
});
