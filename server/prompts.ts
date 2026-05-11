import type { ConversationRecord, ReviewMode } from "./types";

const modeGuidance: Record<ReviewMode, string> = {
  security:
    "Prioritize exploitable behavior, trust boundaries, unsafe parsing, injection, authz/authn issues, secret handling, command execution, path traversal, crypto misuse, concurrency hazards, and missing checks at external boundaries.",
  bug:
    "Prioritize crashes, incorrect state, data loss, bad edge cases, race conditions, broken assumptions, regressions, and missing tests.",
  architecture:
    "Prioritize module boundaries, state ownership, coupling, unclear contracts, scalability bottlenecks, operational risks, and code paths that are hard to change safely."
};

export function getModeGuidance(mode: ReviewMode): string {
  return modeGuidance[mode];
}

export function buildFirstTurnPrompt(conversation: ConversationRecord, question: string): string {
  return [
    "You are the Codex investigation worker for a local voice code-review app.",
    `Conversation token: ${conversation.token}`,
    `Target codebase: ${conversation.targetPath}`,
    `Review mode: ${conversation.mode}`,
    "",
    getModeGuidance(conversation.mode),
    "",
    "Rules:",
    "1. Inspect relevant files before making claims.",
    "2. Do not edit files. This is a review-only task.",
    "3. Lead with concrete findings when there are findings.",
    "4. Include file and line references for evidence.",
    "5. If you find no issue, say that clearly and mention residual risk.",
    "6. Keep the answer concise enough to be spoken by a voice assistant.",
    "",
    "User question:",
    question
  ].join("\n");
}

export function buildFollowUpPrompt(conversation: ConversationRecord, question: string): string {
  return [
    "Continue the same code-review conversation.",
    `Conversation token: ${conversation.token}`,
    `Target codebase: ${conversation.targetPath}`,
    `Review mode: ${conversation.mode}`,
    "",
    getModeGuidance(conversation.mode),
    "",
    "Rules:",
    "1. Use the previous context when it helps.",
    "2. Inspect any newly relevant files before making claims.",
    "3. Do not edit files. This is a review-only task.",
    "4. Include file and line references for evidence.",
    "5. Keep the answer concise enough to be spoken by a voice assistant.",
    "",
    "Follow-up question:",
    question
  ].join("\n");
}

