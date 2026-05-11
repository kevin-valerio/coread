import type { Request, Response } from "express";
import { normalizeRealtimeVoice } from "./realtime";

const previewText = "This is a voice preview for your local codebase assistant.";

export async function createVoicePreview(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown> | undefined;
  const voice = normalizeRealtimeVoice(typeof body?.voice === "string" ? body.voice : undefined);

  if (!voice) {
    res.status(400).json({ ok: false, error: "Invalid voice." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).send("OPENAI_API_KEY is not set in the local server environment.");
    return;
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.VOICE_PREVIEW_MODEL || "gpt-4o-mini-tts",
      voice,
      input: previewText,
      instructions: "Speak quickly, clearly, and with a neutral engineering tone."
    })
  });
  const audio = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    res.status(response.status).type("text/plain").send(audio.toString("utf8"));
    return;
  }

  res.type("audio/mpeg").send(audio);
}
