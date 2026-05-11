import cors from "cors";
import express from "express";
import { askCodex } from "./codexBridge";
import { createRealtimeSession } from "./realtime";
import { createConversation, listConversations } from "./store";
import { resolveDirectory } from "./pathUtils";
import type { ReviewMode } from "./types";

const app = express();
const port = Number(process.env.SERVER_PORT ?? 8787);

app.use(cors({ origin: "http://127.0.0.1:5173" }));

app.post(
  "/api/realtime/session",
  express.text({ type: ["application/sdp", "text/plain", "*/*"], limit: "2mb" }),
  (req, res, next) => {
    createRealtimeSession(req, res).catch(next);
  }
);

app.use(express.json({ limit: "1mb" }));

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
    const mode = parseMode(req.body?.mode);
    const targetPath = await resolveDirectory(String(req.body?.targetPath ?? ""));
    const conversation = await createConversation({
      targetPath,
      mode,
      title: typeof req.body?.title === "string" ? req.body.title : undefined
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
      mode: parseMode(req.body?.mode),
      question: String(req.body?.question ?? ""),
      title: typeof req.body?.title === "string" ? req.body.title : undefined
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(500).json({ ok: false, error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Realtime Codex Reviewer server listening on http://127.0.0.1:${port}`);
});

function parseMode(value: unknown): ReviewMode {
  if (value === "bug" || value === "architecture") {
    return value;
  }

  return "security";
}

