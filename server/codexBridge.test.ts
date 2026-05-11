import { describe, expect, it } from "vitest";
import {
  extractCodexModelFromJsonLine,
  extractCodexUsageFromJsonLine,
  extractSessionIdFromText,
  summarizeCodexJsonLine
} from "./codexBridge";

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
        aggregated_output: "coread\n",
        exit_code: 0
      }
    });

    expect(summarizeCodexJsonLine(line)).toContain("coread");
  });

  it("summarizes turn usage", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 2 }
    });

    expect(summarizeCodexJsonLine(line)).toBe("Codex turn completed. Tokens: 10 input, 2 output.");
  });
});

describe("extractCodexUsageFromJsonLine", () => {
  it("extracts usage from turn.completed events", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      model: "gpt-5.5",
      usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, total_tokens: 12 }
    });

    expect(extractCodexUsageFromJsonLine(line, undefined)).toEqual({
      source: "codex",
      model: "gpt-5.5",
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 2,
      reasoningOutputTokens: 0,
      totalTokens: 12
    });
  });

  it("extracts model and usage from token_count events", () => {
    const modelLine = JSON.stringify({
      type: "turn_context",
      payload: { model: "gpt-5.3-codex" }
    });
    const usageLine = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            output_tokens: 5,
            reasoning_output_tokens: 2,
            total_tokens: 105
          }
        }
      }
    });

    const model = extractCodexModelFromJsonLine(modelLine);

    expect(extractCodexUsageFromJsonLine(usageLine, model)).toEqual({
      source: "codex",
      model: "gpt-5.3-codex",
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 5,
      reasoningOutputTokens: 2,
      totalTokens: 105
    });
  });
});
