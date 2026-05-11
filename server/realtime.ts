import crypto from "node:crypto";
import os from "node:os";
import type { Request, Response } from "express";
import type { ReviewMode } from "./types";
import { getModeGuidance } from "./prompts";

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

function readMode(value: string | undefined): ReviewMode {
  if (value === "bug" || value === "architecture") {
    return value;
  }

  return "security";
}

export async function createRealtimeSession(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).send("OPENAI_API_KEY is not set in the local server environment.");
    return;
  }

  const sdp = typeof req.body === "string" ? req.body : "";

  if (!sdp.trim()) {
    res.status(400).send("Missing SDP offer body.");
    return;
  }

  const targetPath = readHeader(req.headers["x-target-path"]) ?? "";
  const conversationId = readHeader(req.headers["x-conversation-id"]) ?? "";
  const mode = readMode(readHeader(req.headers["x-review-mode"]));
  const session = buildRealtimeSessionConfig({ targetPath, conversationId, mode });
  const formData = new FormData();
  formData.set("sdp", sdp);
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
  mode: ReviewMode;
}): Record<string, unknown> {
  return {
    type: "realtime",
    model: getRealtimeModel(),
    instructions: [
      "You are a live voice code-review assistant.",
      "The user is speaking. Keep spoken answers concise.",
      "For codebase-specific claims, call the ask_codex tool before answering.",
      "When Codex returns evidence, explain the result in simple engineering language.",
      "Preserve file and line references in the text transcript when present.",
      `Current target path: ${input.targetPath || "not selected"}`,
      `Current conversation id: ${input.conversationId || "not created yet"}`,
      `Current review mode: ${input.mode}`,
      getModeGuidance(input.mode)
    ].join("\n"),
    reasoning: {
      effort: process.env.REALTIME_REASONING_EFFORT || "low"
    },
    audio: {
      output: {
        voice: process.env.REALTIME_VOICE || "marin"
      }
    },
    tools: [
      {
        type: "function",
        name: "ask_codex",
        description:
          "Ask local Codex to inspect the selected codebase and answer a review question with file and line references.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description: "The code-review question to investigate."
            },
            mode: {
              type: "string",
              enum: ["security", "bug", "architecture"]
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

