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
      "**What could be the worse scenario for this codebase?** (here you can mention data breaches, DoS, account takeovers, remote code execution, etc. The most important is to be specific to the codebase and its functionality)",
      "**What are the entrypoints for an attacker to break everything?** (be specific to the codebase as usual but for example it can be a specific API route, a file upload feature, via a transaction call, a malicious EVM bytecode, a malicious peer)",
      "**Who are the actors we trust** (here you say for example admin, deployer, multisig, treausry etc, be specific to the codebase)",
      "**Who are the actors we do not trust** (here you say for arbitrageurs etc, again typical to the codebase)",
      "",
    ].join("\n")
  },
  "user-input": {
    id: "user-input",
    title: "MISC",
    question: [
      "Investigate these questions. Reply in a simple English and wording.",
      "",
      "Do not trust README assertions unless the code supports them.",
      "",
      "**What are the explicit security invariants that should always hold?**",
      "",
      "**What is the most smart to fuzz if fuzzable ?**",
      ""
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
      "** Top ranked and best fit and useful skills**",
      "** Top best and accurate security-bug skills**",
      "",
      "Sort the ranking with the best choice first. For each ranked skill, include the skill name, what it is good for, why it fits or does not fit this codebase, and a concrete example prompt the user could run next.",
      "",
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
