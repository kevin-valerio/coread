import { useCallback, useMemo, useRef, useState } from "react";
import {
  FolderCheck,
  Mic,
  MicOff,
  Square,
  Volume2
} from "lucide-react";
import type { CodexAnswer, CodexReasoningEffort, ConversationRecord, TranscriptItem } from "./types";

const reasoningOptions: Array<{ value: CodexReasoningEffort; label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" }
];

type VoiceSpeed = "slow" | "normal" | "fast" | "very-fast";

const voiceSpeedOptions: Array<{ value: VoiceSpeed; label: string }> = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
  { value: "very-fast", label: "Very fast" }
];

type VoiceState = "idle" | "connecting" | "connected";

interface PendingToolCall {
  callId: string;
  name: string;
  argumentsText: string;
}

export function App() {
  const [targetPath, setTargetPath] = useState("~/Desktop");
  const [validatedPath, setValidatedPath] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>("medium");
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>("fast");
  const [voiceSystemPrompt, setVoiceSystemPrompt] = useState(
    "When speaking, do not mention file names or line numbers. Keep exact references in the visible Codex output."
  );
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isAskingCodex, setIsAskingCodex] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const statusText = useMemo(() => {
    if (!validatedPath) {
      return "Choose a codebase";
    }

    if (voiceState === "connected") {
      return "Voice connected";
    }

    if (voiceState === "connecting") {
      return "Connecting voice";
    }

    return "Voice ready";
  }, [validatedPath, voiceState]);

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

      const payload = await readCodexStream(response);

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
    dataChannelRef.current?.close();
    peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current = null;
    setVoiceState("idle");
  }

  async function handleRealtimeEvent(raw: string, activeConversation: ConversationRecord) {
    const event = JSON.parse(raw) as Record<string, unknown>;
    const type = String(event.type ?? "");

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptText = String(event.transcript ?? "");
      if (transcriptText) {
        addTranscript("user", transcriptText);
      }
      return;
    }

    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      const delta = String(event.delta ?? "");
      if (delta) {
        appendAssistantDelta(delta);
      }
      return;
    }

    if (type === "response.done") {
      finishAssistantStream();
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
              <p className="eyebrow">Local voice Q&amp;A</p>
              <h1>Realtime Codex Reviewer</h1>
            </div>
            <span className={`state-pill ${voiceState}`}>{statusText}</span>
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
            <div className="voice-meter" aria-label="Voice status">
              <Volume2 size={18} />
              <span>{voiceState === "connected" ? "Live" : "Standby"}</span>
            </div>
          </div>

          <div className="session-meta">
            <span>Codebase</span>
            <strong>{validatedPath || "Not selected"}</strong>
            <span>Codex session</span>
            <strong>{conversation?.codexSessionId || "Created after first question"}</strong>
            <span>Reasoning</span>
            <strong>{reasoningOptions.find((option) => option.value === reasoningEffort)?.label}</strong>
            <span>Voice speed</span>
            <strong>{voiceSpeedOptions.find((option) => option.value === voiceSpeed)?.label}</strong>
          </div>
        </aside>

        <section className="review-panel" aria-label="Question transcript">
          <div className="transcript-header">
            <div>
              <p className="eyebrow">Transcript</p>
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
                  <pre>{item.text}</pre>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

async function readCodexStream(response: Response): Promise<CodexAnswer> {
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
