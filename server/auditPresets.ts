import { askCodex } from "./codexBridge";
import type { CodexAnswer } from "./types";

export type AuditPresetId = "threat-model" | "user-input";

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
      "Build a concise threat model for this codebase.",
      "",
      "Inspect the relevant files before making claims. Do not trust README assertions unless the code supports them.",
      "",
      "Output Markdown with these sections:",
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
  }
};

export function isAuditPresetId(value: unknown): value is AuditPresetId {
  return value === "threat-model" || value === "user-input";
}

export async function runAuditPreset(targetPath: string, presetId: AuditPresetId): Promise<CodexAnswer> {
  const preset = auditPresets[presetId];

  return askCodex({
    targetPath,
    title: preset.title,
    question: preset.question,
    reasoningEffort: "high",
    model: "gpt-5.5"
  });
}
