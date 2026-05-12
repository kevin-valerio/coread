import type { ConversationRecord } from "./types";

const fastInteractiveRules = [
  "Fast interactive mode: answer the next useful thing, not a complete audit.",
  "Inspect relevant files before making codebase claims.",
  "Keep the investigation bounded. For broad questions, check only high-signal files like README/docs, package or project manifests, the top-level tree, and obvious entrypoints.",
  "For narrow questions, inspect only the directly relevant files. Do not run broad searches unless the question needs it.",
  "Stop once you have enough evidence for a useful answer. Do not keep searching for completeness.",
  "Do not edit files. This is a read-only investigation.",
  "Start with \"Short version:\" and one or two short sentences for voice playback. Do not include file names, paths, or line numbers in this paragraph.",
  "Then include at most three detail bullets with file and line references for evidence.",
  "If the question is broad or ambiguous, end with one short follow-up question instead of expanding the search.",
  "If a deeper pass is needed, say what you checked and ask whether to go deeper."
];

function numberedRules(start: number, rules: string[]): string[] {
  return rules.map((rule, index) => `${start + index}. ${rule}`);
}

export function buildFirstTurnPrompt(conversation: ConversationRecord, question: string): string {
  return [
    "You are the Codex investigation worker for a local voice codebase Q&A app.",
    `Conversation token: ${conversation.token}`,
    `Target codebase: ${conversation.targetPath}`,
    "",
    "Rules:",
    ...numberedRules(1, fastInteractiveRules),
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
    ...numberedRules(2, fastInteractiveRules),
    "",
    "Follow-up question:",
    question
  ].join("\n");
}
