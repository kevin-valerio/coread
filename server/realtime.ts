import crypto from "node:crypto";
import os from "node:os";
import type { Request, Response } from "express";

type VoiceSpeed = "slow" | "normal" | "fast" | "very-fast";
type RealtimeReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
type TurnDetectionMode =
  | "semantic-auto"
  | "semantic-low"
  | "semantic-high"
  | "server-balanced"
  | "server-fast";
type RealtimeTruncationMode = "auto" | "cost" | "short" | "disabled";
export type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";

interface RealtimeSessionInput {
  sdp: string;
  targetPath: string;
  conversationId: string;
  reasoningEffort: string;
  realtimeReasoningEffort: RealtimeReasoningEffort;
  voice: RealtimeVoice;
  voiceSpeed: VoiceSpeed;
  turnDetectionMode: TurnDetectionMode;
  truncationMode: RealtimeTruncationMode;
  voiceSystemPrompt: string;
}

function getRealtimeModel(): string {
  return process.env.REALTIME_MODEL || "gpt-realtime-2";
}

function getSafetyIdentifier(): string {
  if (process.env.OPENAI_SAFETY_IDENTIFIER) {
    return process.env.OPENAI_SAFETY_IDENTIFIER;
  }

  return crypto
    .createHash("sha256")
    .update(`${os.hostname()}:${os.userInfo().username}:coread`)
    .digest("hex");
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readBodyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object" || Buffer.isBuffer(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeVoiceSpeed(value: string | undefined): VoiceSpeed {
  if (value === "slow" || value === "normal" || value === "fast" || value === "very-fast") {
    return value;
  }

  return "very-fast";
}

function normalizeRealtimeReasoningEffort(value: string | undefined): RealtimeReasoningEffort {
  if (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return "medium";
}

function normalizeTurnDetectionMode(value: string | undefined): TurnDetectionMode {
  if (
    value === "semantic-auto" ||
    value === "semantic-low" ||
    value === "semantic-high" ||
    value === "server-balanced" ||
    value === "server-fast"
  ) {
    return value;
  }

  return "semantic-auto";
}

function normalizeTruncationMode(value: string | undefined): RealtimeTruncationMode {
  if (value === "auto" || value === "cost" || value === "short" || value === "disabled") {
    return value;
  }

  return "auto";
}

export function normalizeRealtimeVoice(value: string | undefined): RealtimeVoice | undefined {
  if (
    value === "alloy" ||
    value === "ash" ||
    value === "ballad" ||
    value === "coral" ||
    value === "echo" ||
    value === "sage" ||
    value === "shimmer" ||
    value === "verse" ||
    value === "marin" ||
    value === "cedar"
  ) {
    return value;
  }

  return undefined;
}

function getRealtimeVoice(value: string | undefined): RealtimeVoice {
  return normalizeRealtimeVoice(value) ?? normalizeRealtimeVoice(process.env.REALTIME_VOICE) ?? "marin";
}

function getVoiceSpeedInstruction(speed: VoiceSpeed): string {
  if (speed === "slow") {
    return "Voice speed: slow. Speak clearly and leave short pauses between ideas.";
  }

  if (speed === "normal") {
    return "Voice speed: normal. Speak at a natural conversation pace.";
  }

  if (speed === "very-fast") {
    return "Voice speed: very fast. Speak as quickly as you can while staying understandable.";
  }

  return "Voice speed: fast. Speak faster than normal while staying understandable.";
}

function getVoicePlaybackSpeed(speed: VoiceSpeed): number {
  if (speed === "slow") {
    return 0.9;
  }

  if (speed === "normal") {
    return 1;
  }

  if (speed === "fast") {
    return 1.15;
  }

  return 1.25;
}

function getTurnDetection(mode: TurnDetectionMode): Record<string, unknown> {
  if (mode === "server-balanced" || mode === "server-fast") {
    return {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: mode === "server-fast" ? 300 : 500,
      create_response: true,
      interrupt_response: true
    };
  }

  return {
    type: "semantic_vad",
    eagerness: mode === "semantic-low" ? "low" : mode === "semantic-high" ? "high" : "auto",
    create_response: true,
    interrupt_response: true
  };
}

function getTruncation(mode: RealtimeTruncationMode): string | Record<string, unknown> {
  if (mode === "disabled") {
    return "disabled";
  }

  if (mode === "cost") {
    return {
      type: "retention_ratio",
      retention_ratio: 0.8,
      token_limits: {
        post_instructions: 8000
      }
    };
  }

  if (mode === "short") {
    return {
      type: "retention_ratio",
      retention_ratio: 0.7,
      token_limits: {
        post_instructions: 4000
      }
    };
  }

  return "auto";
}

function readRealtimeSessionInput(req: Request): RealtimeSessionInput {
  const body = req.body as unknown;
  const sdp = typeof body === "string" ? body : readBodyString(body, "sdp") ?? "";
  const targetPath = readBodyString(body, "targetPath") ?? readHeader(req.headers["x-target-path"]) ?? "";
  const conversationId =
    readBodyString(body, "conversationId") ?? readHeader(req.headers["x-conversation-id"]) ?? "";
  const reasoningEffort =
    readBodyString(body, "reasoningEffort") ?? readHeader(req.headers["x-codex-reasoning"]) ?? "low";
  const realtimeReasoningEffort = normalizeRealtimeReasoningEffort(
    readBodyString(body, "realtimeReasoningEffort") ??
      readHeader(req.headers["x-realtime-reasoning"]) ??
      process.env.REALTIME_REASONING_EFFORT
  );
  const voiceSpeed = normalizeVoiceSpeed(
    readBodyString(body, "voiceSpeed") ?? readHeader(req.headers["x-voice-speed"])
  );
  const turnDetectionMode = normalizeTurnDetectionMode(
    readBodyString(body, "turnDetectionMode") ?? readHeader(req.headers["x-turn-detection-mode"])
  );
  const truncationMode = normalizeTruncationMode(
    readBodyString(body, "truncationMode") ?? readHeader(req.headers["x-truncation-mode"])
  );
  const voice = getRealtimeVoice(readBodyString(body, "voice") ?? readHeader(req.headers["x-realtime-voice"]));
  const voiceSystemPrompt =
    readBodyString(body, "voiceSystemPrompt") ?? readHeader(req.headers["x-voice-system-prompt"]) ?? "";

  return {
    sdp,
    targetPath,
    conversationId,
    reasoningEffort,
    realtimeReasoningEffort,
    voice,
    voiceSpeed,
    turnDetectionMode,
    truncationMode,
    voiceSystemPrompt
  };
}

export async function createRealtimeSession(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).send("OPENAI_API_KEY is not set in the local server environment.");
    return;
  }

  const input = readRealtimeSessionInput(req);

  if (!input.sdp.trim()) {
    res.status(400).send("Missing SDP offer body.");
    return;
  }

  const session = buildRealtimeSessionConfig(input);
  const formData = new FormData();
  formData.set("sdp", input.sdp);
  formData.set("session", JSON.stringify(session));

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": getSafetyIdentifier()
    },
    body: formData
  });

  const answer = await response.text();

  if (!response.ok) {
    res.status(response.status).send(answer);
    return;
  }

  res.type("application/sdp").send(answer);
}

export function buildRealtimeSessionConfig(input: {
  targetPath: string;
  conversationId: string;
  reasoningEffort: string;
  realtimeReasoningEffort?: string;
  voice?: string;
  voiceSpeed?: string;
  turnDetectionMode?: string;
  truncationMode?: string;
  voiceSystemPrompt?: string;
}): Record<string, unknown> {
  const voice = getRealtimeVoice(input.voice);
  const voiceSpeed = normalizeVoiceSpeed(input.voiceSpeed);
  const realtimeReasoningEffort = normalizeRealtimeReasoningEffort(
    input.realtimeReasoningEffort ?? process.env.REALTIME_REASONING_EFFORT
  );
  const turnDetectionMode = normalizeTurnDetectionMode(input.turnDetectionMode);
  const truncationMode = normalizeTruncationMode(input.truncationMode);
  const customPrompt = input.voiceSystemPrompt?.trim();
  const instructions = [
    "You are a live voice codebase Q&A assistant.",
    getVoiceSpeedInstruction(voiceSpeed),
    "This is a fast interactive conversation, not a complete code review by default.",
    "Use simple English. Be concise and direct.",
    "Assume the user is new to this codebase and does not understand much yet.",
    'Keep spoken filler short. Example: say "Let me check that", not "Let me check that quickly so I can give you the exact folder name."',
    "For normal codebase questions, use the fast codebase tools and answer directly from those tool results.",
    "Use find_codebase_files for path/name discovery, list_codebase_directory to inspect nearby files, search_codebase for exact text search, run_ripgrep for regex search, and read_codebase_file for bounded file excerpts.",
    "Do not call ask_codex for normal orientation, navigation, or small exact-behavior questions.",
    "Only call ask_codex when the user explicitly asks for a deep pass, a bug hunt, a security review, or says to go deeper.",
    "After calling any tool, wait for the tool output. Do not give extra still-running status messages.",
    "Use one final assistant answer for each user turn.",
    "When ask_codex returns a spoken_summary field, say that summary or a close paraphrase.",
    "If ask_codex returns an error field, say the check failed in one short sentence. Do not say it is still running.",
    "Do not read the full Codex answer aloud. The full answer is already visible in the transcript.",
    'Do not end with generic follow-up offers like "If you want, I can look ...".',
    "After saying the summary once, stop and wait.",
    "When the app sends quiz instructions, ask the exact quiz question aloud. After the user answers, call grade_quiz_answer with the question id and the user's answer. Do not grade quiz answers yourself before that tool returns.",
    "After grade_quiz_answer returns, say the status and grade in simple English.",
    "Do not say file names, paths, or line numbers aloud.",
    "Keep exact file and line references in visible text only.",
    "Do not add lines like 'If you want exact evidence, the references are in the transcript.' unless the user asks.",
    "If the user asks where the evidence is, say that the exact references are in the transcript.",
    `Current target path: ${input.targetPath || "not selected"}`,
    `Current conversation id: ${input.conversationId || "not created yet"}`,
    `Realtime reasoning amount selected by the user: ${realtimeReasoningEffort}`,
    `Codex reasoning amount selected by the user: ${input.reasoningEffort}`
  ];

  if (customPrompt) {
    instructions.push(`Extra voice system prompt from the user:\n${customPrompt}`);
  }

  return {
    type: "realtime",
    model: getRealtimeModel(),
    instructions: instructions.join("\n"),
    reasoning: {
      effort: realtimeReasoningEffort
    },
    truncation: getTruncation(truncationMode),
    audio: {
      input: {
        transcription: {
          model: "gpt-4o-transcribe"
        },
        turn_detection: getTurnDetection(turnDetectionMode)
      },
      output: {
        voice,
        speed: getVoicePlaybackSpeed(voiceSpeed)
      }
    },
    tools: [
      {
        type: "function",
        name: "get_codebase_overview",
        description:
          "Get a fast local overview of the selected codebase: bounded file tree plus key README/package/config snippets.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
          required: []
        }
      },
      {
        type: "function",
        name: "find_codebase_files",
        description:
          "Find files by path or filename substring inside the selected codebase. Use this before reading when a likely directory, feature, or filename is known.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "Case-insensitive substring to match against relative file paths."
            },
            max_results: {
              type: "number",
              description: "Maximum file paths to return. Defaults to 40."
            }
          },
          required: ["query"]
        }
      },
      {
        type: "function",
        name: "list_codebase_directory",
        description:
          "List files and subdirectories under a relative directory in the selected codebase, with bounded depth.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            directory_path: {
              type: "string",
              description: "Relative directory path inside the selected codebase. Defaults to the repo root."
            },
            depth: {
              type: "number",
              description: "Directory depth to list. Defaults to 1, maximum 3."
            },
            max_results: {
              type: "number",
              description: "Maximum entries to return. Defaults to 120."
            }
          },
          required: []
        }
      },
      {
        type: "function",
        name: "search_codebase",
        description:
          "Search the selected codebase for an exact string. Use this to find files, symbols, routes, or config names before answering.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "The exact string to search for."
            },
            max_results: {
              type: "number",
              description: "Maximum matches to return. Defaults to 30."
            }
          },
          required: ["query"]
        }
      },
      {
        type: "function",
        name: "run_ripgrep",
        description:
          "Run a bounded ripgrep search inside the selected codebase. Use for regex search or when exact text search is too weak. This does not execute arbitrary shell commands.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pattern: {
              type: "string",
              description: "Ripgrep search pattern. Treated as a regex unless fixed_strings is true."
            },
            search_path: {
              type: "string",
              description: "Relative file or directory path to search. Defaults to the repo root."
            },
            max_results: {
              type: "number",
              description: "Maximum matches to return. Defaults to 40."
            },
            fixed_strings: {
              type: "boolean",
              description: "Use ripgrep fixed-string mode instead of regex mode."
            },
            case_sensitive: {
              type: "boolean",
              description: "Use case-sensitive matching. Defaults to false."
            }
          },
          required: ["pattern"]
        }
      },
      {
        type: "function",
        name: "read_codebase_file",
        description:
          "Read a bounded line window from a file in the selected codebase. Use paths returned by overview or search.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            file_path: {
              type: "string",
              description: "Relative file path inside the selected codebase."
            },
            start_line: {
              type: "number",
              description: "First line to read. Defaults to 1."
            },
            line_count: {
              type: "number",
              description: "Number of lines to read. Defaults to 160."
            }
          },
          required: ["file_path"]
        }
      },
      {
        type: "function",
        name: "ask_codex",
        description:
          "Run a slower local Codex read-only investigation. Use only for explicit deep passes, bug hunts, security reviews, or go-deeper requests.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description: "The codebase question to investigate."
            },
            conversation_id: {
              type: "string",
              description: "The local conversation id to resume."
            }
          },
          required: ["question"]
        }
      },
      {
        type: "function",
        name: "grade_quiz_answer",
        description:
          "Grade a spoken answer for the active codebase quiz question. The app has the expected answer and code evidence.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            question_id: {
              type: "string",
              description: "The quiz question id provided by the app."
            },
            answer: {
              type: "string",
              description: "The user's spoken answer transcript."
            }
          },
          required: ["question_id", "answer"]
        }
      }
    ],
    tool_choice: "auto"
  };
}
