import { askCodex } from "./codexBridge";
import type { CodexAnswer } from "./types";

export type AuditPresetId = "threat-model" | "user-input" | "useful-skills";

interface AuditPreset {
  id: AuditPresetId;
  title: string;
  question: string;
}

const auditPresets: Record<AuditPresetId, AuditPreset> = {
  "threat-model": {
    id: "threat-model",
    title: "Threat model",
    question: [
      "Build a concise threat model for this codebase. Use a simple English and wording.",
      "",
      "Do not trust README assertions unless the code supports them.",
      "",
      "Output Markdown with these sections or questions:",
      "Short answer",
      "System overview",
      "Trust boundaries",
      "Assets",
      "Entry points",
      "Main attacker-controlled flows",
      "Security assumptions to verify",
      "Most useful next checks",
      "",
      "Every concrete claim must include file and line references when possible. If evidence is missing, say that clearly."
    ].join("\n")
  },
  "user-input": {
    id: "user-input",
    title: "User input",
    question: [
      "Identify what is triggerable by a user or any untrusted actor in this codebase.",
      "",
      "Include direct user actions, network/API inputs, CLI inputs, file uploads, webhooks, scheduled jobs fed by external data, config/env inputs, and other untrusted boundaries if present.",
      "",
      "Inspect the relevant files before making claims. Do not infer triggerability from names only.",
      "",
      "Output Markdown with these sections:",
      "Short answer",
      "Triggerable surfaces",
      "Untrusted data paths",
      "Parsing and validation points",
      "Sensitive sinks reachable from untrusted input",
      "Unknowns / needs more checking",
      "",
      "Every concrete claim must include file and line references when possible. If evidence is missing, say that clearly."
    ].join("\n")
  },
  "useful-skills": {
    id: "useful-skills",
    title: "Useful skills",
    question: [
      "Rank the available skills that are useful for auditing this codebase.",
      "",
      "First, discover the skills that are visible to you through the Codex environment, local skill docs, or repo-local docs. Do not invent skill names. Do not execute or invoke any skill; only inspect metadata/docs and recommend what the user could choose next.",
      "",
      "Answer these questions:",
      "1. Across all available skills, which are best for finding security bugs?",
      "2. Which of those skills apply best to this specific codebase after inspecting its language, framework, architecture, and attacker-controlled surfaces?",
      "",
      "Output Markdown with these sections:",
      "Ranked useful skills",
      "Best security-bug skills",
      "Best fit for this codebase",
      "How to use them here",
      "Unknowns / needs more checking",
      "",
      "Sort the ranking with the best choice first. For each ranked skill, include the skill name, what it is good for, why it fits or does not fit this codebase, and a concrete example prompt the user could run next.",
      "",
      "Every concrete codebase-fit claim must include file and line references when possible. Every skill claim should cite the skill source when readable. If no skill inventory is visible, say that clearly and list only skill categories, not fake skill names."
    ].join("\n")
  }
};

export function isAuditPresetId(value: unknown): value is AuditPresetId {
  return value === "threat-model" || value === "user-input" || value === "useful-skills";
}

export async function runAuditPreset(targetPath: string, presetId: AuditPresetId): Promise<CodexAnswer> {
  const preset = auditPresets[presetId];

  return askCodex({
    targetPath,
    title: preset.title,
    question: preset.question,
    reasoningEffort: "xhigh",
    model: "gpt-5.5"
  });
}
