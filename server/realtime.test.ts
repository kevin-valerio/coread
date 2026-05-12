import { describe, expect, it } from "vitest";
import { buildRealtimeSessionConfig } from "./realtime";

describe("buildRealtimeSessionConfig", () => {
  it("includes voice speed and custom voice instructions", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "high",
      realtimeReasoningEffort: "medium",
      voice: "cedar",
      voiceSpeed: "very-fast",
      turnDetectionMode: "semantic-low",
      truncationMode: "cost",
      voiceSystemPrompt: "Answer in one sentence."
    });

    const instructions = String(config.instructions);

    expect(instructions).toContain("Voice speed: very fast");
    expect(instructions).toContain("Answer in one sentence.");
    expect(instructions).toContain(
      'Example: say "Let me check that", not "Let me check that quickly so I can give you the exact folder name."'
    );
    expect(instructions).toContain("This is a fast interactive conversation");
    expect(instructions).toContain("# Role and Objective");
    expect(instructions).toContain("# Unclear Audio");
    expect(instructions).toContain("Only act on clear audio or text.");
    expect(instructions).toContain("Do not guess file names, symbols, commands, or error text from unclear audio.");
    expect(instructions).toContain("Do not give extra still-running status messages");
    expect(instructions).toContain("For normal codebase questions, use the fast codebase tools");
    expect(instructions).toContain("Use find_codebase_files for path/name discovery");
    expect(instructions).toContain("Do not call ask_codex for normal orientation");
    expect(instructions).toContain("ask the user if they want a deep Codex pass before calling ask_codex");
    expect(instructions).toContain("Call ask_codex only after the user clearly confirms");
    expect(instructions).not.toContain("Use only tools explicitly provided in the current tool list.");
    expect(instructions).not.toContain("Fast codebase tools are read-only and proactive.");
    expect(instructions).toContain("If a tool fails, explain the failure briefly");
    expect(instructions).toContain("Use one final assistant answer for each user turn.");
    expect(instructions).toContain("When ask_codex returns a spoken_summary field");
    expect(instructions).toContain("If ask_codex returns an error field");
    expect(instructions).toContain("Do not read the full Codex answer aloud.");
    expect(instructions).toContain("Assume the user is new to this codebase");
    expect(instructions).toContain('Do not end with generic follow-up offers like "If you want, I can look ..."');
    expect(instructions).toContain("After saying the summary once, stop and wait.");
    expect(instructions).toContain("Treat file paths, symbols, function names, package names, commands, and error strings as high precision.");
    expect(instructions).toContain("If unsure, ask the user to repeat or spell the value.");
    expect(instructions).toContain("Do not say file names, paths, or line numbers aloud.");
    expect(instructions).toContain("Keep exact file and line references in visible text only.");
    expect(instructions).toContain("Realtime reasoning amount selected by the user: medium");
    expect(instructions).toContain("Codex reasoning amount selected by the user: high");
    expect(config.reasoning).toEqual({ effort: "medium" });
    expect(config.truncation).toEqual({
      type: "retention_ratio",
      retention_ratio: 0.8,
      token_limits: {
        post_instructions: 8000
      }
    });
    expect(config.audio).toEqual({
      input: {
        transcription: {
          model: "gpt-4o-transcribe"
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: "cedar",
        speed: 1.25
      }
    });
    expect(JSON.stringify(config.tools)).toContain("get_codebase_overview");
    expect(JSON.stringify(config.tools)).toContain("find_codebase_files");
    expect(JSON.stringify(config.tools)).toContain("list_codebase_directory");
    expect(JSON.stringify(config.tools)).toContain("search_codebase");
    expect(JSON.stringify(config.tools)).toContain("run_ripgrep");
    expect(JSON.stringify(config.tools)).toContain("read_codebase_file");
    expect(JSON.stringify(config.tools)).toContain("grade_quiz_answer");
  });

  it("falls back to very fast voice speed and marin voice", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "low",
      realtimeReasoningEffort: "unsupported",
      voice: "unsupported",
      voiceSpeed: "unsupported",
      turnDetectionMode: "unsupported",
      truncationMode: "unsupported"
    });

    expect(String(config.instructions)).toContain("Voice speed: very fast.");
    expect(String(config.instructions)).toContain("Realtime reasoning amount selected by the user: medium");
    expect(config.reasoning).toEqual({ effort: "medium" });
    expect(config.truncation).toBe("auto");
    expect(config.audio).toEqual({
      input: {
        transcription: {
          model: "gpt-4o-transcribe"
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: "marin",
        speed: 1.25
      }
    });
  });

  it("supports server VAD and disabled truncation", () => {
    const config = buildRealtimeSessionConfig({
      targetPath: "/tmp/project",
      conversationId: "conversation-1",
      reasoningEffort: "low",
      realtimeReasoningEffort: "xhigh",
      turnDetectionMode: "server-fast",
      truncationMode: "disabled"
    });

    expect(config.reasoning).toEqual({ effort: "xhigh" });
    expect(config.truncation).toBe("disabled");
    expect(config.audio).toMatchObject({
      input: {
        turn_detection: {
          type: "server_vad",
          silence_duration_ms: 300
        }
      }
    });
  });
});
