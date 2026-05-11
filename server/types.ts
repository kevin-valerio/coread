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

export interface ConversationStoreFile {
  conversations: ConversationRecord[];
}

export interface CodexQuestion {
  conversationId?: string;
  targetPath: string;
  mode: ReviewMode;
  question: string;
  title?: string;
}

export interface CodexAnswer {
  conversationId: string;
  codexSessionId?: string;
  answer: string;
  durationMs: number;
  outputFile: string;
}

