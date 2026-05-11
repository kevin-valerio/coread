import crypto from "node:crypto";
import os from "node:os";
import type { Request, Response } from "express";

type VoiceSpeed = "slow" | "normal" | "fast" | "very-fast";
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
  voice: RealtimeVoice;
  voiceSpeed: VoiceSpeed;
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
    .update(`${os.hostname()}:${os.userInfo().username}:realtime-codex-reviewer`)
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

function readRealtimeSessionInput(req: Request): RealtimeSessionInput {
  const body = req.body as unknown;
  const sdp = typeof body === "string" ? body : readBodyString(body, "sdp") ?? "";
  const targetPath = readBodyString(body, "targetPath") ?? readHeader(req.headers["x-target-path"]) ?? "";
  const conversationId =
    readBodyString(body, "conversationId") ?? readHeader(req.headers["x-conversation-id"]) ?? "";
  const reasoningEffort =
    readBodyString(body, "reasoningEffort") ?? readHeader(req.headers["x-codex-reasoning"]) ?? "medium";
  const voiceSpeed = normalizeVoiceSpeed(
    readBodyString(body, "voiceSpeed") ?? readHeader(req.headers["x-voice-speed"])
  );
  const voice = getRealtimeVoice(readBodyString(body, "voice") ?? readHeader(req.headers["x-realtime-voice"]));
  const voiceSystemPrompt =
    readBodyString(body, "voiceSystemPrompt") ?? readHeader(req.headers["x-voice-system-prompt"]) ?? "";

  return {
    sdp,
    targetPath,
    conversationId,
    reasoningEffort,
    voice,
    voiceSpeed,
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
  voice?: string;
  voiceSpeed?: string;
  voiceSystemPrompt?: string;
}): Record<string, unknown> {
  const voice = getRealtimeVoice(input.voice);
  const voiceSpeed = normalizeVoiceSpeed(input.voiceSpeed);
  const customPrompt = input.voiceSystemPrompt?.trim();
  const instructions = [
    "You are a live voice codebase Q&A assistant.",
    getVoiceSpeedInstruction(voiceSpeed),
    "Use simple English. Be concise and direct.",
    "For codebase-specific claims, call the ask_codex tool before answering.",
    "When Codex returns evidence, explain the result in simple engineering language.",
    "Do not say file names, paths, or line numbers aloud.",
    "Keep exact file and line references in the visible Codex output only.",
    "If the user asks where the evidence is, say that the exact references are in the transcript.",
    `Current target path: ${input.targetPath || "not selected"}`,
    `Current conversation id: ${input.conversationId || "not created yet"}`,
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
      effort: process.env.REALTIME_REASONING_EFFORT || "low"
    },
    audio: {
      output: {
        voice
      }
    },
    tools: [
      {
        type: "function",
        name: "ask_codex",
        description:
          "Ask local Codex to inspect the selected codebase and answer a codebase question with file and line references.",
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
      }
    ],
    tool_choice: "auto"
  };
}
