import { useCallback, useMemo, useRef, useState } from "react";
import {
  FolderCheck,
  Mic,
  MicOff,
  Play,
  Square,
  Volume2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  calculateCodexCost,
  calculateRealtimeCost,
  extractRealtimeUsageFromEvent,
  pricingMetadata,
  summarizeCostEntries
} from "../shared/cost";
import type { CostCalculation, CostEntry } from "../shared/cost";
import type {
  CodexAnswer,
  CodexProgressEvent,
  CodexReasoningEffort,
  ConversationRecord,
  TranscriptItem
} from "./types";

const reasoningOptions: Array<{ value: CodexReasoningEffort; label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" }
];

type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";
type VoiceSpeed = "slow" | "normal" | "fast" | "very-fast";

const voiceOptions: Array<{ value: RealtimeVoice; label: string }> = [
  { value: "marin", label: "Marin" },
  { value: "cedar", label: "Cedar" },
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
  { value: "verse", label: "Verse" }
];

const voiceSpeedOptions: Array<{ value: VoiceSpeed; label: string }> = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
  { value: "very-fast", label: "Very Fast" }
];

type VoiceState = "idle" | "connecting" | "connected";
type VoiceActivity = "idle" | "connecting" | "waiting" | "listening" | "thinking" | "speaking" | "researching";

const defaultVoiceSystemPrompt = [
  "- When speaking, do not mention file names or line numbers.",
  "- Keep exact references in the visible Codex output.",
  "- Use simple English, go straight to the point. Don't be fluffy."
].join("\n");

interface PendingToolCall {
  callId: string;
  name: string;
  argumentsText: string;
}

export function App() {
  const [targetPath, setTargetPath] = useState("~/Desktop");
  const [validatedPath, setValidatedPath] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>("medium");
  const [voice, setVoice] = useState<RealtimeVoice>("marin");
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>("very-fast");
  const [voiceSystemPrompt, setVoiceSystemPrompt] = useState(defaultVoiceSystemPrompt);
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity>("idle");
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const [isAskingCodex, setIsAskingCodex] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const activity = useMemo<VoiceActivity>(() => {
    if (isAskingCodex) {
      return "researching";
    }

    if (voiceState === "connecting") {
      return "connecting";
    }

    if (voiceState === "connected") {
      return voiceActivity === "idle" ? "waiting" : voiceActivity;
    }

    return "idle";
  }, [isAskingCodex, voiceActivity, voiceState]);
  const activityLabel = getActivityLabel(activity);
  const costSummary = useMemo(() => summarizeCostEntries(costEntries), [costEntries]);
  const latestCostEntries = useMemo(() => costEntries.slice(-3).reverse(), [costEntries]);

  const addTranscript = useCallback((role: TranscriptItem["role"], text: string) => {
    setTranscript((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        role,
        text,
        createdAt: new Date().toLocaleTimeString()
      }
    ]);
  }, []);

  const stopVoicePreview = useCallback(() => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setIsPreviewingVoice(false);
  }, []);

  const appendAssistantDelta = useCallback((text: string) => {
    setTranscript((items) => {
      const last = items.at(-1);

      if (last?.role === "assistant" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      }

      return [
        ...items,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          createdAt: new Date().toLocaleTimeString(),
          streaming: true
        }
      ];
    });
  }, []);

  const finishAssistantStream = useCallback(() => {
    setTranscript((items) => {
      const last = items.at(-1);

      if (last?.role !== "assistant" || !last.streaming) {
        return items;
      }

      return [...items.slice(0, -1), { ...last, streaming: false }];
    });
  }, []);

  const addCostCalculation = useCallback((calculation: CostCalculation) => {
    setCostEntries((items) => [
      ...items,
      {
        ...calculation,
        id: crypto.randomUUID(),
        createdAt: new Date().toLocaleTimeString()
      }
    ]);
  }, []);

  async function validatePath() {
    const response = await fetch("/api/codebase/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath })
    });
    const payload = (await response.json()) as { ok: boolean; targetPath?: string; error?: string };

    if (!response.ok || !payload.ok || !payload.targetPath) {
      setValidatedPath("");
      addTranscript("error", payload.error || "Codebase path is invalid.");
      return;
    }

    setValidatedPath(payload.targetPath);
    setConversation(null);
    setCostEntries([]);
    addTranscript("status", `Using codebase: ${payload.targetPath}`);
  }

  async function ensureConversation(): Promise<ConversationRecord> {
    if (conversation) {
      return conversation;
    }

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPath: validatedPath, reasoningEffort })
    });
    const payload = (await response.json()) as { conversation: ConversationRecord };
    setConversation(payload.conversation);
    return payload.conversation;
  }

  async function askCodex(text: string, callConversation?: ConversationRecord): Promise<CodexAnswer> {
    const activeConversation = callConversation ?? (await ensureConversation());
    setIsAskingCodex(true);

    try {
      const response = await fetch("/api/codex/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: validatedPath,
          question: text,
          reasoningEffort
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await readCodexStream(response, (event) => {
        if (event.usage) {
          addCostCalculation(calculateCodexCost(event.usage));
        }
      });

      setConversation((current) => {
        const base = current ?? activeConversation;
        return { ...base, codexSessionId: payload.codexSessionId, turns: base.turns + 1 };
      });
      addTranscript("assistant", payload.answer);
      return payload;
    } finally {
      setIsAskingCodex(false);
    }
  }

  async function connectVoice() {
    if (!validatedPath || voiceState !== "idle") {
      return;
    }

    setVoiceState("connecting");

    try {
      const activeConversation = await ensureConversation();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      peer.ontrack = (event) => {
        if (!audioRef.current) {
          return;
        }

        audioRef.current.srcObject = event.streams[0];
      };

      const dataChannel = peer.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        setVoiceState("connected");
        setVoiceActivity("waiting");
        addTranscript("status", "Voice session connected.");
      };
      dataChannel.onmessage = (event) => {
        handleRealtimeEvent(event.data, activeConversation).catch((error) => {
          addTranscript("error", error instanceof Error ? error.message : "Realtime event failed.");
        });
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const response = await fetch("/api/realtime/session/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: offer.sdp,
          targetPath: validatedPath,
          conversationId: activeConversation.id,
          reasoningEffort,
          voice,
          voiceSpeed,
          voiceSystemPrompt
        })
      });
      const answerSdp = await response.text();

      if (!response.ok) {
        throw new Error(answerSdp || "Realtime session failed.");
      }

      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      disconnectVoice();
      addTranscript("error", error instanceof Error ? error.message : "Voice connection failed.");
    }
  }

  function disconnectVoice() {
    stopVoicePreview();
    dataChannelRef.current?.close();
    peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current = null;
    setVoiceState("idle");
    setVoiceActivity("idle");
  }

  async function previewVoice() {
    stopVoicePreview();
    setIsPreviewingVoice(true);

    try {
      const response = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      previewUrlRef.current = audioUrl;
      previewAudioRef.current = audio;
      audio.onended = stopVoicePreview;
      audio.onerror = stopVoicePreview;
      await audio.play();
    } catch (error) {
      stopVoicePreview();
      addTranscript("error", error instanceof Error ? error.message : "Voice preview failed.");
    }
  }

  async function handleRealtimeEvent(raw: string, activeConversation: ConversationRecord) {
    const event = JSON.parse(raw) as Record<string, unknown>;
    const type = String(event.type ?? "");

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptText = String(event.transcript ?? "");
      if (transcriptText) {
        addTranscript("user", transcriptText);
      }
      setVoiceActivity("thinking");
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      setVoiceActivity("listening");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      setVoiceActivity("thinking");
      return;
    }

    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      const delta = String(event.delta ?? "");
      if (delta) {
        setVoiceActivity("speaking");
        appendAssistantDelta(delta);
      }
      return;
    }

    if (type === "response.done") {
      const usage = extractRealtimeUsageFromEvent(event);

      if (usage) {
        addCostCalculation(calculateRealtimeCost(usage));
      }

      finishAssistantStream();
      setVoiceActivity("waiting");
      return;
    }

    const toolCall = extractToolCall(event);

    if (!toolCall || toolCall.name !== "ask_codex") {
      return;
    }

    await answerToolCall(toolCall, activeConversation);
  }

  async function answerToolCall(toolCall: PendingToolCall, activeConversation: ConversationRecord) {
    const args = JSON.parse(toolCall.argumentsText || "{}") as {
      question?: string;
      conversation_id?: string;
    };
    const toolQuestion = args.question?.trim() || "Investigate the selected codebase.";
    const result = await askCodex(toolQuestion, {
      ...activeConversation,
      id: args.conversation_id || activeConversation.id
    });
    const channel = dataChannelRef.current;

    if (!channel || channel.readyState !== "open") {
      return;
    }

    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: toolCall.callId,
          output: JSON.stringify(result)
        }
      })
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }

  return (
    <main className="app-shell">
      <audio ref={audioRef} autoPlay />
      <section className="workspace">
        <aside className="control-panel" aria-label="Question controls">
          <div className="brand-row">
            <div>
              <h1>Realtime Codex Reviewer</h1>
            </div>
          </div>

          <label className="field">
            <span>Codebase path</span>
            <div className="path-row">
              <input
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder="~/src/project"
              />
              <button className="icon-button" type="button" onClick={validatePath} title="Validate path">
                <FolderCheck size={18} />
              </button>
            </div>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Codex reasoning</span>
              <select
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)}
              >
                {reasoningOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Voice speed</span>
              <select
                value={voiceSpeed}
                onChange={(event) => setVoiceSpeed(event.target.value as VoiceSpeed)}
              >
                {voiceSpeedOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Voice</span>
            <div className="voice-select-row">
              <select
                value={voice}
                onChange={(event) => {
                  stopVoicePreview();
                  setVoice(event.target.value as RealtimeVoice);
                }}
              >
                {voiceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                type="button"
                onClick={previewVoice}
                disabled={isPreviewingVoice}
                title="Preview voice"
                aria-label="Preview voice"
              >
                <Play size={18} />
              </button>
            </div>
          </label>

          <label className="field">
            <span>System prompt</span>
            <textarea
              value={voiceSystemPrompt}
              onChange={(event) => setVoiceSystemPrompt(event.target.value)}
              placeholder="Extra voice instructions. Example: answer in very short bullets."
            />
          </label>

          <div className="voice-actions">
            {voiceState === "idle" ? (
              <button className="primary-action" type="button" disabled={!validatedPath} onClick={connectVoice}>
                <Mic size={18} />
                Start voice
              </button>
            ) : (
              <button className="danger-action" type="button" onClick={disconnectVoice}>
                {voiceState === "connecting" ? <MicOff size={18} /> : <Square size={18} />}
                Stop voice
              </button>
            )}
            <div
              className="voice-meter"
              aria-label={voiceState === "connected" ? "Voice live" : "Voice off"}
            >
              <Volume2 size={18} />
            </div>
          </div>

          <div className={`activity-card ${activity}`} aria-live="polite">
            <div className="activity-visual" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <span className="activity-eyebrow">Current state</span>
              <strong>{activityLabel}</strong>
            </div>
          </div>

          <div className="cost-card" aria-live="polite">
            <div className="cost-card-header">
              <div>
                <span className="activity-eyebrow">API cost</span>
                <strong>{formatUsd(costSummary.totalUsd)}</strong>
              </div>
              <span>Checked {pricingMetadata.checkedAt}</span>
            </div>

            <div className="cost-grid">
              <span>Realtime</span>
              <strong>{formatUsd(costSummary.realtimeUsd)}</strong>
              <span>Codex</span>
              <strong>{formatUsd(costSummary.codexUsd)}</strong>
              {costSummary.totalCredits > 0 ? (
                <>
                  <span>Codex credits</span>
                  <strong>{formatCredits(costSummary.totalCredits)}</strong>
                </>
              ) : null}
              <span>Input tokens</span>
              <strong>{formatTokens(costSummary.inputTokens)}</strong>
              <span>Cached input</span>
              <strong>{formatTokens(costSummary.cachedInputTokens)}</strong>
              <span>Output tokens</span>
              <strong>{formatTokens(costSummary.outputTokens)}</strong>
            </div>

            {costSummary.unpricedTokens > 0 ? (
              <div className="cost-warning">{formatTokens(costSummary.unpricedTokens)} unpriced tokens</div>
            ) : null}

            <div className="cost-events">
              {latestCostEntries.length === 0 ? (
                <span>No usage yet</span>
              ) : (
                latestCostEntries.map((entry) => (
                  <div key={entry.id} className="cost-event">
                    <span>
                      {entry.source} · {entry.model}
                    </span>
                    <strong>{formatUsd(entry.costUsd)}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="session-meta">
            <span>Codebase</span>
            <strong>{validatedPath || "Not selected"}</strong>
            <span>Codex session</span>
            <strong>{conversation?.codexSessionId || "Created after first question"}</strong>
          </div>
        </aside>

        <section className="review-panel" aria-label="Question transcript">
          <div className="transcript-header">
            <div>
              <h2>Voice and Codex output</h2>
            </div>
            {isAskingCodex ? <span className="busy-dot">Codex running</span> : null}
          </div>

          <div className="transcript-list">
            {transcript.length === 0 ? (
              <div className="empty-state">
                <p>Validate a codebase, then start voice.</p>
              </div>
            ) : (
              transcript.map((item) => (
                <article key={item.id} className={`message ${item.role}`}>
                  <div className="message-top">
                    <span>{item.role}</span>
                    <time>{item.createdAt}</time>
                  </div>
                  {item.role === "assistant" ? (
                    <MarkdownContent text={item.text} />
                  ) : (
                    <pre className="message-plain">{item.text}</pre>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function getActivityLabel(activity: VoiceActivity): string {
  if (activity === "connecting") {
    return "Connecting voice";
  }

  if (activity === "waiting") {
    return "Waiting for you";
  }

  if (activity === "listening") {
    return "Listening to you";
  }

  if (activity === "thinking") {
    return "Preparing answer";
  }

  if (activity === "speaking") {
    return "Voice is speaking";
  }

  if (activity === "researching") {
    return "Codex is researching";
  }

  return "Voice is idle";
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

async function readCodexStream(
  response: Response,
  onProgress?: (event: CodexProgressEvent) => void
): Promise<CodexAnswer> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Codex stream is not available.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalAnswer: CodexAnswer | undefined;
  let streamError: string | undefined;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = drainSseBuffer(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event.event === "final") {
        finalAnswer = JSON.parse(event.data) as CodexAnswer;
      } else if (event.event === "error") {
        const payload = JSON.parse(event.data) as { error?: string };
        streamError = payload.error || "Codex request failed.";
      } else if (event.event === "progress") {
        onProgress?.(JSON.parse(event.data) as CodexProgressEvent);
      }
    }
  }

  const parsed = drainSseBuffer(buffer);
  for (const event of parsed.events) {
    if (event.event === "final") {
      finalAnswer = JSON.parse(event.data) as CodexAnswer;
    } else if (event.event === "error") {
      const payload = JSON.parse(event.data) as { error?: string };
      streamError = payload.error || "Codex request failed.";
    } else if (event.event === "progress") {
      onProgress?.(JSON.parse(event.data) as CodexProgressEvent);
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!finalAnswer) {
    throw new Error("Codex stream ended without a final answer.");
  }

  return finalAnswer;
}

function drainSseBuffer(buffer: string): {
  events: Array<{ event: string; data: string }>;
  remainder: string;
} {
  const events: Array<{ event: string; data: string }> = [];
  let cursor = buffer.indexOf("\n\n");

  while (cursor !== -1) {
    const block = buffer.slice(0, cursor);
    buffer = buffer.slice(cursor + 2);
    const parsed = parseSseBlock(block);

    if (parsed) {
      events.push(parsed);
    }

    cursor = buffer.indexOf("\n\n");
  }

  return { events, remainder: buffer };
}

function parseSseBlock(block: string): { event: string; data: string } | undefined {
  const lines = block.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return { event, data: dataLines.join("\n") };
}

function extractToolCall(event: Record<string, unknown>): PendingToolCall | undefined {
  if (event.type === "response.function_call_arguments.done") {
    return {
      callId: String(event.call_id ?? ""),
      name: String(event.name ?? ""),
      argumentsText: String(event.arguments ?? "{}")
    };
  }

  if (event.type === "response.output_item.done") {
    const item = event.item as Record<string, unknown> | undefined;

    if (item?.type !== "function_call") {
      return undefined;
    }

    return {
      callId: String(item.call_id ?? ""),
      name: String(item.name ?? ""),
      argumentsText: String(item.arguments ?? "{}")
    };
  }

  return undefined;
}

function formatUsd(value: number): string {
  if (value === 0) {
    return "$0.000000";
  }

  if (value < 0.000001) {
    return "<$0.000001";
  }

  if (value < 0.01) {
    return `$${value.toFixed(6)}`;
  }

  if (value < 1) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

function formatCredits(value: number): string {
  if (value < 0.001) {
    return value.toFixed(6);
  }

  if (value < 1) {
    return value.toFixed(3);
  }

  return value.toFixed(2);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
