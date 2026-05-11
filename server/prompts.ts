import type { ConversationRecord } from "./types";

export function buildFirstTurnPrompt(conversation: ConversationRecord, question: string): string {
  return [
    "You are the Codex investigation worker for a local voice codebase Q&A app.",
    `Conversation token: ${conversation.token}`,
    `Target codebase: ${conversation.targetPath}`,
    "",
    "Rules:",
    "1. Inspect relevant files before making claims.",
    "2. Do not edit files. This is a read-only investigation.",
    "3. Answer the user's question directly.",
    "4. Include file and line references for evidence.",
    "5. If the code does not show enough evidence, say what you checked.",
    '6. Start with "Short version:" and one short paragraph that is useful for voice playback.',
    "7. After that, include any needed details and file and line references.",
    "8. Use simple English and keep the answer concise enough to be spoken by a voice assistant.",
    "",
    "User question:",
    question
  ].join("\n");
}

export function buildFollowUpPrompt(conversation: ConversationRecord, question: string): string {
  return [
    "Continue the same codebase Q&A conversation.",
    `Conversation token: ${conversation.token}`,
    `Target codebase: ${conversation.targetPath}`,
    "",
    "Rules:",
    "1. Use the previous context when it helps.",
    "2. Inspect any newly relevant files before making claims.",
    "3. Do not edit files. This is a read-only investigation.",
    "4. Include file and line references for evidence.",
    '5. Start with "Short version:" and one short paragraph that is useful for voice playback.',
    "6. After that, include any needed details and file and line references.",
    "7. Use simple English and keep the answer concise enough to be spoken by a voice assistant.",
    "",
    "Follow-up question:",
    question
  ].join("\n");
}
