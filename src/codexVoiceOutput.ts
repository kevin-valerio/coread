import type { CodexAnswer } from "./types";

export interface CodexVoiceToolOutput {
  conversation_id: string;
  codex_session_id?: string;
  spoken_summary: string;
  full_answer_visible_in_transcript: true;
  error?: string;
}

const maxSpokenSummaryLength = 360;
const shortSummaryPrefix =
  /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*Short\s+(?:answer|version)\s*(?:\*\*)?\s*[:.-]?\s*/i;
const likelyFileReference =
  /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+(?::[1-9]\d*)?(?::[1-9]\d*)?\b|\b[A-Za-z0-9_.-]+\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|jsx|json|md|py|rs|sol|ts|tsx|toml|yaml|yml)(?::[1-9]\d*)?(?::[1-9]\d*)?\b/g;

export function buildCodexVoiceToolOutput(result: CodexAnswer): CodexVoiceToolOutput {
  return {
    conversation_id: result.conversationId,
    codex_session_id: result.codexSessionId,
    spoken_summary: extractCodexSpokenSummary(result.answer),
    full_answer_visible_in_transcript: true
  };
}

export function buildCodexVoiceToolError(error: string, conversationId: string): CodexVoiceToolOutput {
  return {
    conversation_id: conversationId,
    spoken_summary: "Codex could not complete that check. The error is visible in the transcript.",
    full_answer_visible_in_transcript: true,
    error
  };
}

export function extractCodexSpokenSummary(answer: string): string {
  const paragraphs = answer
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = paragraphs[index].match(shortSummaryPrefix);

    if (!match) {
      continue;
    }

    const inlineSummary = paragraphs[index].slice(match[0].length).trim();
    const candidate = inlineSummary || paragraphs[index + 1] || "";
    const cleaned = cleanSpokenSummary(candidate);

    if (cleaned) {
      return cleaned;
    }
  }

  const cleaned = cleanSpokenSummary(paragraphs[0] || answer);

  if (cleaned) {
    return cleaned;
  }

  return "Codex finished the check. The written answer is in the transcript.";
}

function cleanSpokenSummary(text: string): string {
  const withoutMarkdownLinks = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label) =>
    containsLikelyFileReference(label) ? "" : label
  );

  const cleaned = withoutMarkdownLinks
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(likelyFileReference, "")
    .replace(/\bline\s+[1-9]\d*\b/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s*\b(?:Evidence|References?|See)\s*:?[.?!]?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return truncateSpokenSummary(cleaned);
}

function containsLikelyFileReference(value: string): boolean {
  likelyFileReference.lastIndex = 0;
  return likelyFileReference.test(value);
}

function truncateSpokenSummary(text: string): string {
  if (text.length <= maxSpokenSummaryLength) {
    return text;
  }

  const sliced = text.slice(0, maxSpokenSummaryLength);
  const sentenceBoundary = Math.max(sliced.lastIndexOf("."), sliced.lastIndexOf("?"), sliced.lastIndexOf("!"));

  if (sentenceBoundary > 200) {
    return sliced.slice(0, sentenceBoundary + 1).trim();
  }

  return `${sliced.trimEnd()}.`;
}
