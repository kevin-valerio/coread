import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import {
  Bug,
  FolderCheck,
  Mic,
  MicOff,
  Network,
  ShieldCheck,
  Square,
  Send,
  Volume2
} from "lucide-react";
import type { CodexAnswer, ConversationRecord, ReviewMode, TranscriptItem } from "./types";

const modeOptions: Array<{
  mode: ReviewMode;
  label: string;
  icon: typeof ShieldCheck;
}> = [
  { mode: "security", label: "Security", icon: ShieldCheck },
  { mode: "bug", label: "Bugs", icon: Bug },
  { mode: "architecture", label: "Architecture", icon: Network }
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
  const [mode, setMode] = useState<ReviewMode>("security");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [title, setTitle] = useState("New review topic");
  const [question, setQuestion] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isAskingCodex, setIsAskingCodex] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canAsk = Boolean(validatedPath && question.trim() && !isAskingCodex);
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

    return "Text review ready";
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
      body: JSON.stringify({ targetPath: validatedPath, mode, title })
    });
    const payload = (await response.json()) as { conversation: ConversationRecord };
    setConversation(payload.conversation);
    return payload.conversation;
  }

  async function askCodex(text: string, callConversation?: ConversationRecord): Promise<CodexAnswer> {
    const activeConversation = callConversation ?? (await ensureConversation());
    setIsAskingCodex(true);
    addTranscript("tool", "Codex is inspecting the codebase.");

    try {
      const response = await fetch("/api/codex/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: validatedPath,
          mode,
          question: text,
          title
        })
      });
      const payload = (await response.json()) as CodexAnswer | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Codex request failed.");
      }

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

  async function submitTextQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canAsk) {
      return;
    }

    const text = question.trim();
    setQuestion("");
    addTranscript("user", text);

    try {
      await askCodex(text);
    } catch (error) {
      addTranscript("error", error instanceof Error ? error.message : "Codex request failed.");
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

      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          "X-Target-Path": validatedPath,
          "X-Conversation-Id": activeConversation.id,
          "X-Review-Mode": mode
        },
        body: offer.sdp
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
      mode?: ReviewMode;
      conversation_id?: string;
    };
    const toolQuestion = args.question?.trim() || "Review the selected codebase.";
    const result = await askCodex(toolQuestion, {
      ...activeConversation,
      id: args.conversation_id || activeConversation.id,
      mode: args.mode || activeConversation.mode
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
        <aside className="control-panel" aria-label="Review controls">
          <div className="brand-row">
            <div>
              <p className="eyebrow">Local voice review</p>
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
            <span>Conversation title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <div className="field">
            <span>Review mode</span>
            <div className="segmented">
              {modeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.mode}
                    className={mode === option.mode ? "active" : ""}
                    type="button"
                    onClick={() => setMode(option.mode)}
                  >
                    <Icon size={16} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

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
          </div>
        </aside>

        <section className="review-panel" aria-label="Review transcript">
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
                <p>Validate a codebase, then ask a review question.</p>
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

          <form className="question-form" onSubmit={submitTextQuestion}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a review question. Example: where can untrusted input reach file system writes?"
            />
            <button className="icon-button send-button" type="submit" disabled={!canAsk} title="Ask Codex">
              <Send size={18} />
            </button>
          </form>
        </section>
      </section>
    </main>
  );
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
