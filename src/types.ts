import type { CodexUsageRecord } from "../shared/cost";

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ConversationRecord {
  id: string;
  title: string;
  token: string;
  targetPath: string;
  reasoningEffort?: CodexReasoningEffort;
  codexSessionId?: string;
  turns: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodexAnswer {
  conversationId: string;
  codexSessionId?: string;
  answer: string;
  durationMs: number;
  outputFile: string;
  usage?: CodexUsageRecord;
}

export interface CodexProgressEvent {
  type: "status" | "stdout" | "stderr" | "usage";
  text: string;
  usage?: CodexUsageRecord;
}

export interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "status" | "error";
  text: string;
  createdAt: string;
  streaming?: boolean;
}
