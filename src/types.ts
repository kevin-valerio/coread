export type ReviewMode = "security" | "bug" | "architecture";

export interface ConversationRecord {
  id: string;
  title: string;
  token: string;
  targetPath: string;
  mode: ReviewMode;
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
}

export interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "tool" | "status" | "error";
  text: string;
  createdAt: string;
  streaming?: boolean;
}
