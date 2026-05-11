export type CostSource = "realtime" | "codex";

export interface TokenPrice {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  inputCreditsPerMillion?: number;
  cachedInputCreditsPerMillion?: number;
  outputCreditsPerMillion?: number;
}

export interface RealtimeUsageRecord {
  source: "realtime";
  model: string;
  textInputTokens: number;
  cachedTextInputTokens: number;
  audioInputTokens: number;
  cachedAudioInputTokens: number;
  imageInputTokens: number;
  cachedImageInputTokens: number;
  textOutputTokens: number;
  audioOutputTokens: number;
  totalTokens: number;
}

export interface CodexUsageRecord {
  source: "codex";
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  cumulativeTotalTokens?: number;
}

export interface CostLineItem {
  label: string;
  tokens: number;
  usd: number;
  credits?: number;
}

export interface CostCalculation {
  source: CostSource;
  model: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costCredits: number;
  unpricedTokens: number;
  lineItems: CostLineItem[];
}

export interface CostEntry extends CostCalculation {
  id: string;
  createdAt: string;
}

export interface CostSummary {
  totalUsd: number;
  realtimeUsd: number;
  codexUsd: number;
  totalCredits: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  unpricedTokens: number;
}

export const pricingMetadata = {
  checkedAt: "2026-05-11",
  sources: [
    "https://openai.com/api/pricing/",
    "https://developers.openai.com/api/docs/models/gpt-realtime-2",
    "https://developers.openai.com/api/docs/models/gpt-5.3-codex"
  ]
};

const textModelPrices: Record<string, TokenPrice> = {
  "gpt-5.5": {
    inputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 30,
    inputCreditsPerMillion: 125,
    cachedInputCreditsPerMillion: 12.5,
    outputCreditsPerMillion: 750
  },
  "gpt-5.4": {
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
    inputCreditsPerMillion: 62.5,
    cachedInputCreditsPerMillion: 6.25,
    outputCreditsPerMillion: 375
  },
  "gpt-5.4-mini": {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
    inputCreditsPerMillion: 18.75,
    cachedInputCreditsPerMillion: 1.875,
    outputCreditsPerMillion: 113
  },
  "gpt-5.3-codex": {
    inputUsdPerMillion: 1.75,
    cachedInputUsdPerMillion: 0.175,
    outputUsdPerMillion: 14,
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350
  },
  "gpt-5.2-codex": {
    inputUsdPerMillion: 1.75,
    cachedInputUsdPerMillion: 0.175,
    outputUsdPerMillion: 14,
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350
  },
  "gpt-5.2": {
    inputUsdPerMillion: 1.75,
    cachedInputUsdPerMillion: 0.175,
    outputUsdPerMillion: 14,
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350
  },
  "gpt-5-codex": {
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10
  },
  "gpt-5.1-codex": {
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10
  },
  "gpt-5": {
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10
  }
};

const realtimeTextPrice: TokenPrice = {
  inputUsdPerMillion: 4,
  cachedInputUsdPerMillion: 0.4,
  outputUsdPerMillion: 24
};

const realtimeAudioPrice: TokenPrice = {
  inputUsdPerMillion: 32,
  cachedInputUsdPerMillion: 0.4,
  outputUsdPerMillion: 64
};

const realtimeImagePrice = {
  inputUsdPerMillion: 5,
  cachedInputUsdPerMillion: 0.5
};

export function calculateRealtimeCost(usage: RealtimeUsageRecord): CostCalculation {
  if (usage.model !== "gpt-realtime-2") {
    return unpricedCalculation(usage.source, usage.model, "Realtime response", usage.totalTokens);
  }

  const lineItems: CostLineItem[] = [];
  addInputLine(lineItems, "Realtime text input", usage.textInputTokens, usage.cachedTextInputTokens, realtimeTextPrice);
  addInputLine(lineItems, "Realtime audio input", usage.audioInputTokens, usage.cachedAudioInputTokens, realtimeAudioPrice);
  addInputLine(lineItems, "Realtime image input", usage.imageInputTokens, usage.cachedImageInputTokens, {
    ...realtimeImagePrice,
    outputUsdPerMillion: 0
  });
  addOutputLine(lineItems, "Realtime text output", usage.textOutputTokens, realtimeTextPrice);
  addOutputLine(lineItems, "Realtime audio output", usage.audioOutputTokens, realtimeAudioPrice);

  return buildCalculation({
    source: usage.source,
    model: usage.model,
    label: "Realtime response",
    inputTokens: usage.textInputTokens + usage.audioInputTokens + usage.imageInputTokens,
    cachedInputTokens: usage.cachedTextInputTokens + usage.cachedAudioInputTokens + usage.cachedImageInputTokens,
    outputTokens: usage.textOutputTokens + usage.audioOutputTokens,
    totalTokens: usage.totalTokens,
    lineItems
  });
}

export function calculateCodexCost(usage: CodexUsageRecord): CostCalculation {
  const price = textModelPrices[usage.model];

  if (!price) {
    return unpricedCalculation(usage.source, usage.model, "Codex model call", usage.totalTokens);
  }

  const lineItems: CostLineItem[] = [];
  addInputLine(lineItems, "Codex input", usage.inputTokens, usage.cachedInputTokens, price);
  addOutputLine(lineItems, "Codex output", usage.outputTokens, price);

  return buildCalculation({
    source: usage.source,
    model: usage.model,
    label: "Codex model call",
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    lineItems
  });
}

export function summarizeCostEntries(entries: CostEntry[]): CostSummary {
  return entries.reduce(
    (summary, entry) => ({
      totalUsd: summary.totalUsd + entry.costUsd,
      realtimeUsd: summary.realtimeUsd + (entry.source === "realtime" ? entry.costUsd : 0),
      codexUsd: summary.codexUsd + (entry.source === "codex" ? entry.costUsd : 0),
      totalCredits: summary.totalCredits + entry.costCredits,
      inputTokens: summary.inputTokens + entry.inputTokens,
      cachedInputTokens: summary.cachedInputTokens + entry.cachedInputTokens,
      outputTokens: summary.outputTokens + entry.outputTokens,
      totalTokens: summary.totalTokens + entry.totalTokens,
      unpricedTokens: summary.unpricedTokens + entry.unpricedTokens
    }),
    {
      totalUsd: 0,
      realtimeUsd: 0,
      codexUsd: 0,
      totalCredits: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      unpricedTokens: 0
    }
  );
}

export function extractRealtimeUsageFromEvent(event: Record<string, unknown>): RealtimeUsageRecord | undefined {
  if (event.type !== "response.done") {
    return undefined;
  }

  const response = readObject(event.response);
  const usage = readObject(response?.usage);

  if (!response || !usage) {
    return undefined;
  }

  const inputDetails = readObject(usage.input_token_details);
  const outputDetails = readObject(usage.output_token_details);

  if (!inputDetails || !outputDetails) {
    return {
      source: "realtime",
      model: readString(response.model) || "gpt-realtime-2",
      textInputTokens: 0,
      cachedTextInputTokens: 0,
      audioInputTokens: 0,
      cachedAudioInputTokens: 0,
      imageInputTokens: 0,
      cachedImageInputTokens: 0,
      textOutputTokens: 0,
      audioOutputTokens: 0,
      totalTokens: readNumber(usage.total_tokens)
    };
  }

  const cachedDetails = readObject(inputDetails.cached_tokens_details);

  return {
    source: "realtime",
    model: readString(response.model) || "gpt-realtime-2",
    textInputTokens: readNumber(inputDetails.text_tokens),
    cachedTextInputTokens: readNumber(cachedDetails?.text_tokens),
    audioInputTokens: readNumber(inputDetails.audio_tokens),
    cachedAudioInputTokens: readNumber(cachedDetails?.audio_tokens),
    imageInputTokens: readNumber(inputDetails.image_tokens),
    cachedImageInputTokens: readNumber(cachedDetails?.image_tokens),
    textOutputTokens: readNumber(outputDetails.text_tokens),
    audioOutputTokens: readNumber(outputDetails.audio_tokens),
    totalTokens: readNumber(usage.total_tokens)
  };
}

function buildCalculation(input: {
  source: CostSource;
  model: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lineItems: CostLineItem[];
}): CostCalculation {
  const costUsd = input.lineItems.reduce((total, item) => total + item.usd, 0);
  const costCredits = input.lineItems.reduce((total, item) => total + (item.credits ?? 0), 0);
  const pricedTokens = input.lineItems.reduce((total, item) => total + item.tokens, 0);

  return {
    source: input.source,
    model: input.model,
    label: input.label,
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    costUsd,
    costCredits,
    unpricedTokens: Math.max(0, input.totalTokens - pricedTokens),
    lineItems: input.lineItems
  };
}

function unpricedCalculation(
  source: CostSource,
  model: string,
  label: string,
  totalTokens: number
): CostCalculation {
  return {
    source,
    model,
    label,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens,
    costUsd: 0,
    costCredits: 0,
    unpricedTokens: totalTokens,
    lineItems: []
  };
}

function addInputLine(
  lineItems: CostLineItem[],
  label: string,
  inputTokens: number,
  cachedInputTokens: number,
  price: TokenPrice
): void {
  const billableCachedTokens = Math.min(inputTokens, cachedInputTokens);
  const billableInputTokens = Math.max(0, inputTokens - billableCachedTokens);

  addLine(lineItems, label, billableInputTokens, price.inputUsdPerMillion, price.inputCreditsPerMillion);
  addLine(
    lineItems,
    `${label} cached`,
    billableCachedTokens,
    price.cachedInputUsdPerMillion,
    price.cachedInputCreditsPerMillion
  );
}

function addOutputLine(lineItems: CostLineItem[], label: string, outputTokens: number, price: TokenPrice): void {
  addLine(lineItems, label, outputTokens, price.outputUsdPerMillion, price.outputCreditsPerMillion);
}

function addLine(
  lineItems: CostLineItem[],
  label: string,
  tokens: number,
  usdPerMillion: number,
  creditsPerMillion?: number
): void {
  if (tokens <= 0) {
    return;
  }

  lineItems.push({
    label,
    tokens,
    usd: (tokens / 1_000_000) * usdPerMillion,
    credits: creditsPerMillion === undefined ? undefined : (tokens / 1_000_000) * creditsPerMillion
  });
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
