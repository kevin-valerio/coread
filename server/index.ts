import cors from "cors";
import express from "express";
import { askCodex } from "./codexBridge";
import { createRealtimeSession } from "./realtime";
import { createVoicePreview } from "./voicePreview";
import { createConversation, listConversations } from "./store";
import { resolveDirectory } from "./pathUtils";
import type { CodexReasoningEffort } from "./types";

const app = express();
const port = Number(process.env.SERVER_PORT ?? 8787);

app.use(cors({ origin: "http://127.0.0.1:5173" }));

app.post(
  "/api/realtime/session/json",
  express.json({ limit: "2mb" }),
  (req, res, next) => {
    createRealtimeSession(req, res).catch(next);
  }
);

app.post(
  "/api/realtime/session",
  express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" }),
  (req, res, next) => {
    createRealtimeSession(req, res).catch(next);
  }
);

app.use(express.json({ limit: "1mb" }));

app.post("/api/voice/preview", (req, res, next) => {
  createVoicePreview(req, res).catch(next);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    realtimeModel: process.env.REALTIME_MODEL || "gpt-realtime-2",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post("/api/codebase/validate", async (req, res, next) => {
  try {
    const targetPath = await resolveDirectory(String(req.body?.path ?? ""));
    res.json({ ok: true, targetPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid path";
    res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/conversations", async (req, res, next) => {
  try {
    const targetPath = typeof req.query.targetPath === "string" ? req.query.targetPath : undefined;
    res.json({ conversations: await listConversations(targetPath) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations", async (req, res, next) => {
  try {
    const targetPath = await resolveDirectory(String(req.body?.targetPath ?? ""));
    const conversation = await createConversation({
      targetPath,
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      reasoningEffort: parseReasoningEffort(req.body?.reasoningEffort)
    });

    res.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.post("/api/codex/ask", async (req, res, next) => {
  try {
    const result = await askCodex({
      conversationId:
        typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined,
      targetPath: String(req.body?.targetPath ?? ""),
      question: String(req.body?.question ?? ""),
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      reasoningEffort: parseReasoningEffort(req.body?.reasoningEffort)
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/codex/ask/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await askCodex(
      {
        conversationId:
          typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined,
        targetPath: String(req.body?.targetPath ?? ""),
        question: String(req.body?.question ?? ""),
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        reasoningEffort: parseReasoningEffort(req.body?.reasoningEffort)
      },
      (event) => send("progress", event)
    );

    send("final", result);
  } catch (error) {
    send("error", {
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  } finally {
    res.end();
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(500).json({ ok: false, error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Realtime Codex Reviewer server listening on http://127.0.0.1:${port}`);
});

function parseReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  if (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return undefined;
}
