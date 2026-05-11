import { describe, expect, it } from "vitest";
import { extractSessionIdFromText } from "./codexBridge";

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

