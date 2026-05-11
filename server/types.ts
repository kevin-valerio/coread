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

export interface ConversationStoreFile {
  conversations: ConversationRecord[];
}

export interface CodexQuestion {
  conversationId?: string;
  targetPath: string;
  question: string;
  title?: string;
  reasoningEffort?: CodexReasoningEffort;
}

export interface CodexAnswer {
  conversationId: string;
  codexSessionId?: string;
  answer: string;
  durationMs: number;
  outputFile: string;
  usage?: CodexUsageRecord;
}
