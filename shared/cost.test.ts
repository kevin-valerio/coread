import { describe, expect, it } from "vitest";
import { calculateCodexCost, calculateRealtimeCost, summarizeCostEntries } from "./cost";
import type { CostEntry } from "./cost";

describe("calculateRealtimeCost", () => {
  it("prices realtime text, audio, and cached input tokens", () => {
    const cost = calculateRealtimeCost({
      source: "realtime",
      model: "gpt-realtime-2",
      textInputTokens: 119,
      cachedTextInputTokens: 64,
      audioInputTokens: 13,
      cachedAudioInputTokens: 0,
      imageInputTokens: 0,
      cachedImageInputTokens: 0,
      textOutputTokens: 30,
      audioOutputTokens: 91,
      totalTokens: 253
    });

    expect(cost.costUsd).toBeCloseTo(0.0072056);
    expect(cost.unpricedTokens).toBe(0);
  });
});

describe("calculateCodexCost", () => {
  it("prices codex usage with cached input tokens", () => {
    const cost = calculateCodexCost({
      source: "codex",
      model: "gpt-5.5",
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 10,
      reasoningOutputTokens: 4,
      totalTokens: 1010
    });

    expect(cost.costUsd).toBeCloseTo(0.0044);
    expect(cost.costCredits).toBeCloseTo(0.11);
    expect(cost.unpricedTokens).toBe(0);
  });

  it("prices gpt-5.1-codex usage", () => {
    const cost = calculateCodexCost({
      source: "codex",
      model: "gpt-5.1-codex",
      inputTokens: 2000,
      cachedInputTokens: 500,
      outputTokens: 100,
      reasoningOutputTokens: 0,
      totalTokens: 2100
    });

    expect(cost.costUsd).toBeCloseTo(0.0029375);
    expect(cost.unpricedTokens).toBe(0);
  });

  it("does not guess costs for unknown models", () => {
    const cost = calculateCodexCost({
      source: "codex",
      model: "unknown-model",
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningOutputTokens: 0,
      totalTokens: 1100
    });

    expect(cost.costUsd).toBe(0);
    expect(cost.unpricedTokens).toBe(1100);
  });
});

describe("summarizeCostEntries", () => {
  it("sums realtime and codex entries separately", () => {
    const entries: CostEntry[] = [
      {
        ...calculateRealtimeCost({
          source: "realtime",
          model: "gpt-realtime-2",
          textInputTokens: 10,
          cachedTextInputTokens: 0,
          audioInputTokens: 0,
          cachedAudioInputTokens: 0,
          imageInputTokens: 0,
          cachedImageInputTokens: 0,
          textOutputTokens: 5,
          audioOutputTokens: 0,
          totalTokens: 15
        }),
        id: "1",
        createdAt: "now"
      },
      {
        ...calculateCodexCost({
          source: "codex",
          model: "gpt-5.3-codex",
          inputTokens: 20,
          cachedInputTokens: 10,
          outputTokens: 5,
          reasoningOutputTokens: 0,
          totalTokens: 25
        }),
        id: "2",
        createdAt: "now"
      }
    ];

    const summary = summarizeCostEntries(entries);

    expect(summary.totalUsd).toBeCloseTo(summary.realtimeUsd + summary.codexUsd);
    expect(summary.totalTokens).toBe(40);
    expect(summary.cachedInputTokens).toBe(10);
  });
});
