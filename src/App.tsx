import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  BookOpen,
  CheckCircle2,
  FolderCheck,
  HelpCircle,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Square,
  X
} from "lucide-react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  calculateCodexCost,
  calculateRealtimeCost,
  extractRealtimeUsageFromEvent,
  pricingMetadata,
  summarizeCostEntries
} from "../shared/cost";
import type { CodexUsageRecord, CostCalculation, CostEntry } from "../shared/cost";
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

const defaultCodeViewerWidth = 720;
const minCodeViewerWidth = 360;
const codeViewerWorkspaceReserve = 620;

type VoiceState = "idle" | "connecting" | "connected";
type VoiceActivity = "idle" | "connecting" | "waiting" | "listening" | "thinking" | "speaking" | "researching";
type ActiveTab = "review" | "quiz";
type QuizDifficulty = "easy" | "medium" | "hard";
type QuizQuestionStatus = "pending" | "asking" | "listening" | "grading" | "graded";
type QuizGradeStatus = "correct" | "partial" | "incorrect";

const quizDifficultyOptions: Array<{ value: QuizDifficulty; label: string }> = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" }
];

const wholeCodebaseComponent: QuizComponent = {
  id: "whole-codebase",
  title: "Whole codebase",
  description: "Questions can cover any part of the selected repo."
};

const defaultVoiceSystemPrompt = [
  "- When speaking, do not mention file names or line numbers.",
  "- Keep exact references in the visible Codex output.",
  "- Use simple English, go straight to the point. Don't be fluffy.",
  '- Keep spoken filler short. Example: say "Let me check that", not "Let me check that quickly so I can give you the exact folder name."'
].join("\n");

interface PendingToolCall {
  callId: string;
  name: string;
  argumentsText: string;
}

interface FileReference {
  filePath: string;
  line: number;
}

interface CodeViewerState {
  requestedPath: string;
  displayPath: string;
  content: string;
  targetLine: number;
  loading: boolean;
  error?: string;
}

interface QuizComponent {
  id: string;
  title: string;
  description: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
  evidenceMarkdown: string;
  componentTitle: string;
  difficulty: QuizDifficulty;
  status: QuizQuestionStatus;
  answer?: string;
  resultStatus?: QuizGradeStatus;
  grade?: number;
  resultMarkdown?: string;
  spokenSummary?: string;
}

interface QuizCodexPayload {
  conversationId: string;
  codexSessionId?: string;
  usage?: CodexUsageRecord;
}

export function App() {
  const [targetPath, setTargetPath] = useState("~/Desktop");
  const [validatedPath, setValidatedPath] = useState("");
  const [validatedPathInput, setValidatedPathInput] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("review");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>("medium");
  const [voice, setVoice] = useState<RealtimeVoice>("marin");
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>("very-fast");
  const [voiceSystemPrompt, setVoiceSystemPrompt] = useState(defaultVoiceSystemPrompt);
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity>("idle");
  const [isValidatingPath, setIsValidatingPath] = useState(false);
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const [isAskingCodex, setIsAskingCodex] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [codeViewer, setCodeViewer] = useState<CodeViewerState | null>(null);
  const [codeViewerWidth, setCodeViewerWidth] = useState(defaultCodeViewerWidth);
  const [quizComponents, setQuizComponents] = useState<QuizComponent[]>([]);
  const [selectedQuizComponentId, setSelectedQuizComponentId] = useState(wholeCodebaseComponent.id);
  const [quizDifficulty, setQuizDifficulty] = useState<QuizDifficulty>("medium");
  const [quizQuestionCount, setQuizQuestionCount] = useState(10);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [activeQuizQuestionId, setActiveQuizQuestionId] = useState<string | null>(null);
  const [isLoadingQuizComponents, setIsLoadingQuizComponents] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [isGradingQuiz, setIsGradingQuiz] = useState(false);
  const [quizError, setQuizError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const quizQuestionsRef = useRef<QuizQuestion[]>([]);
  const activeQuizQuestionIdRef = useRef<string | null>(null);
  const handledToolCallIdsRef = useRef<Set<string>>(new Set());
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
  const quizComponentOptions = useMemo(
    () => [wholeCodebaseComponent, ...quizComponents],
    [quizComponents]
  );
  const workspaceStyle = codeViewer
    ? ({
        "--code-viewer-width": `${codeViewerWidth}px`
      } as CSSProperties)
    : undefined;

  useEffect(() => {
    quizQuestionsRef.current = quizQuestions;
  }, [quizQuestions]);

  useEffect(() => {
    activeQuizQuestionIdRef.current = activeQuizQuestionId;
  }, [activeQuizQuestionId]);

  useEffect(() => {
    if (!codeViewer) {
      return;
    }

    const syncCodeViewerWidth = () => {
      setCodeViewerWidth((width) => clampCodeViewerWidth(width));
    };

    syncCodeViewerWidth();
    window.addEventListener("resize", syncCodeViewerWidth);

    return () => window.removeEventListener("resize", syncCodeViewerWidth);
  }, [codeViewer]);

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

  async function validatePath(): Promise<string | null> {
    const requestedPath = targetPath.trim();

    if (!requestedPath) {
      setValidatedPath("");
      setValidatedPathInput("");
      setCodeViewer(null);
      addTranscript("error", "Codebase path is required.");
      return null;
    }

    setIsValidatingPath(true);

    try {
      const response = await fetch("/api/codebase/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: requestedPath })
      });
      const payload = (await response.json()) as { ok: boolean; targetPath?: string; error?: string };

      if (!response.ok || !payload.ok || !payload.targetPath) {
        setValidatedPath("");
        setValidatedPathInput("");
        setCodeViewer(null);
        addTranscript("error", payload.error || "Codebase path is invalid.");
        return null;
      }

      setValidatedPath(payload.targetPath);
      setValidatedPathInput(requestedPath);
      setConversation(null);
      setCostEntries([]);
      setCodeViewer(null);
      setQuizComponents([]);
      setSelectedQuizComponentId(wholeCodebaseComponent.id);
      setQuizQuestions([]);
      setActiveQuizQuestionId(null);
      setQuizError("");
      handledToolCallIdsRef.current.clear();
      addTranscript("status", `Using codebase: ${payload.targetPath}`);
      return payload.targetPath;
    } catch (error) {
      setValidatedPath("");
      setValidatedPathInput("");
      setCodeViewer(null);
      addTranscript("error", error instanceof Error ? error.message : "Codebase path is invalid.");
      return null;
    } finally {
      setIsValidatingPath(false);
    }
  }

  async function ensureConversation(activeTargetPath = validatedPath): Promise<ConversationRecord> {
    if (!activeTargetPath) {
      throw new Error("Validate a codebase before starting voice.");
    }

    if (conversation?.targetPath === activeTargetPath) {
      return conversation;
    }

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPath: activeTargetPath, reasoningEffort })
    });
    const payload = (await response.json()) as { conversation: ConversationRecord };
    setConversation(payload.conversation);
    return payload.conversation;
  }

  async function askCodex(text: string, callConversation?: ConversationRecord): Promise<CodexAnswer> {
    const activeConversation = callConversation ?? (await ensureConversation());
    const activeTargetPath = activeConversation.targetPath || validatedPath;
    setIsAskingCodex(true);

    try {
      const response = await fetch("/api/codex/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: activeTargetPath,
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

  function recordQuizCodexResult(payload: QuizCodexPayload, activeConversation: ConversationRecord) {
    if (payload.usage) {
      addCostCalculation(calculateCodexCost(payload.usage));
    }

    setConversation((current) => {
      const base = current ?? activeConversation;

      return {
        ...base,
        codexSessionId: payload.codexSessionId ?? base.codexSessionId,
        turns: base.turns + 1
      };
    });
  }

  async function loadQuizComponents() {
    if (!validatedPath) {
      return;
    }

    const activeConversation = await ensureConversation();
    setActiveTab("quiz");
    setIsLoadingQuizComponents(true);
    setIsAskingCodex(true);
    setQuizError("");

    try {
      const response = await fetch("/api/quiz/components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: validatedPath,
          reasoningEffort
        })
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as QuizCodexPayload & {
        components: QuizComponent[];
      };

      recordQuizCodexResult(payload, activeConversation);
      setQuizComponents(payload.components);
      setSelectedQuizComponentId((current) =>
        current === wholeCodebaseComponent.id || payload.components.some((component) => component.id === current)
          ? current
          : wholeCodebaseComponent.id
      );
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : "Quiz components could not be generated.");
    } finally {
      setIsLoadingQuizComponents(false);
      setIsAskingCodex(false);
    }
  }

  async function generateQuizRound() {
    if (!validatedPath) {
      return;
    }

    const activeConversation = await ensureConversation();
    const component =
      quizComponentOptions.find((option) => option.id === selectedQuizComponentId) ?? wholeCodebaseComponent;

    setActiveTab("quiz");
    setIsGeneratingQuiz(true);
    setIsAskingCodex(true);
    setQuizError("");
    setQuizQuestions([]);
    setActiveQuizQuestionId(null);

    try {
      const response = await fetch("/api/quiz/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: validatedPath,
          component,
          difficulty: quizDifficulty,
          count: quizQuestionCount,
          reasoningEffort
        })
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as QuizCodexPayload & {
        questions: Array<Omit<QuizQuestion, "status">>;
      };

      recordQuizCodexResult(payload, activeConversation);
      setQuizQuestions(payload.questions.map((question) => ({ ...question, status: "pending" })));
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : "Quiz questions could not be generated.");
    } finally {
      setIsGeneratingQuiz(false);
      setIsAskingCodex(false);
    }
  }

  async function gradeQuizQuestion(
    questionId: string,
    answer: string,
    activeConversation: ConversationRecord
  ): Promise<{
    status: QuizGradeStatus;
    grade: number;
    spokenSummary: string;
  }> {
    const question = quizQuestionsRef.current.find((item) => item.id === questionId);

    if (!question) {
      throw new Error("Quiz question was not found.");
    }

    setIsGradingQuiz(true);
    setIsAskingCodex(true);
    setQuizError("");
    updateQuizQuestion(questionId, { answer, status: "grading" });

    try {
      const response = await fetch("/api/quiz/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation.id,
          targetPath: activeConversation.targetPath,
          question,
          answer,
          reasoningEffort
        })
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as QuizCodexPayload & {
        grade: {
          status: QuizGradeStatus;
          grade: number;
          markdown: string;
          spokenSummary: string;
        };
      };

      recordQuizCodexResult(payload, activeConversation);
      updateQuizQuestion(questionId, {
        answer,
        status: "graded",
        resultStatus: payload.grade.status,
        grade: payload.grade.grade,
        resultMarkdown: payload.grade.markdown,
        spokenSummary: payload.grade.spokenSummary
      });

      return {
        status: payload.grade.status,
        grade: payload.grade.grade,
        spokenSummary: payload.grade.spokenSummary
      };
    } catch (error) {
      updateQuizQuestion(questionId, { status: "listening" });
      throw error;
    } finally {
      setIsGradingQuiz(false);
      setIsAskingCodex(false);
    }
  }

  function updateQuizQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    setQuizQuestions((questions) =>
      questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question))
    );
  }

  async function askQuizQuestionByVoice(question: QuizQuestion, index: number) {
    let channel = dataChannelRef.current;

    if (!channel || channel.readyState !== "open") {
      if (voiceState === "connecting") {
        setQuizError("Voice is still connecting.");
        return;
      }

      channel = await connectVoice();
    }

    if (!channel || channel.readyState !== "open") {
      setQuizError("Voice could not start. Check microphone permission and try again.");
      return;
    }

    setActiveQuizQuestionId(question.id);
    updateQuizQuestion(question.id, { status: "asking" });
    setQuizError("");

    const prompt = [
      "Quiz mode.",
      `Question id: ${question.id}`,
      `Question ${index + 1} of ${quizQuestionsRef.current.length}: ${question.question}`,
      "",
      "Ask this exact question aloud. Do not answer it.",
      "After the user answers, call grade_quiz_answer with the question_id and the user's spoken answer transcript.",
      "Do not decide correctness yourself before grade_quiz_answer returns."
    ].join("\n");

    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      })
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }

  const openFileReference = useCallback(
    async (reference: FileReference) => {
      if (!validatedPath) {
        setCodeViewer({
          requestedPath: reference.filePath,
          displayPath: reference.filePath,
          content: "",
          targetLine: reference.line,
          loading: false,
          error: "Validate a codebase before opening file references."
        });
        return;
      }

      setCodeViewer({
        requestedPath: reference.filePath,
        displayPath: reference.filePath,
        content: "",
        targetLine: reference.line,
        loading: true
      });

      try {
        const response = await fetch("/api/codebase/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetPath: validatedPath,
            filePath: reference.filePath
          })
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response));
        }

        const payload = (await response.json()) as {
          ok: true;
          filePath: string;
          relativePath: string;
          content: string;
        };

        setCodeViewer({
          requestedPath: reference.filePath,
          displayPath: payload.relativePath || payload.filePath,
          content: payload.content,
          targetLine: reference.line,
          loading: false
        });
      } catch (error) {
        setCodeViewer({
          requestedPath: reference.filePath,
          displayPath: reference.filePath,
          content: "",
          targetLine: reference.line,
          loading: false,
          error: error instanceof Error ? error.message : "File could not be opened."
        });
      }
    },
    [validatedPath]
  );

  async function connectVoice(): Promise<RTCDataChannel | null> {
    const currentChannel = dataChannelRef.current;

    if (voiceState !== "idle") {
      return currentChannel?.readyState === "open" ? currentChannel : null;
    }

    const currentPathIsValidated = validatedPath && validatedPathInput === targetPath.trim();
    const activeTargetPath = currentPathIsValidated ? validatedPath : await validatePath();

    if (!activeTargetPath) {
      return null;
    }

    setVoiceState("connecting");

    try {
      const activeConversation = await ensureConversation(activeTargetPath);
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
      const channelReady = new Promise<RTCDataChannel | null>((resolve) => {
        dataChannel.onopen = () => {
          setVoiceState("connected");
          setVoiceActivity("waiting");
          addTranscript("status", "Voice session connected.");
          resolve(dataChannel);
        };
        dataChannel.onclose = () => resolve(null);
        dataChannel.onerror = () => resolve(null);
      });
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
          targetPath: activeTargetPath,
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
      const openedChannel = await channelReady;

      if (!openedChannel) {
        throw new Error("Voice data channel failed to open.");
      }

      return openedChannel;
    } catch (error) {
      disconnectVoice();
      addTranscript("error", error instanceof Error ? error.message : "Voice connection failed.");
      return null;
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

    if (type === "error" || type.endsWith("_error")) {
      addTranscript("error", readRealtimeErrorMessage(event));
      setVoiceActivity("waiting");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptText = String(event.transcript ?? "");
      if (transcriptText) {
        addTranscript("user", transcriptText);
        const questionId = activeQuizQuestionIdRef.current;

        if (questionId) {
          updateQuizQuestion(questionId, { answer: transcriptText, status: "listening" });
        }
      }
      setVoiceActivity("thinking");
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      const questionId = activeQuizQuestionIdRef.current;

      if (questionId) {
        updateQuizQuestion(questionId, { status: "listening" });
      }

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
      type === "response.audio_transcript.delta" ||
      type === "response.output_audio_transcript.delta"
    ) {
      const delta = String(event.delta ?? "");
      if (delta) {
        setVoiceActivity("speaking");
        appendAssistantDelta(delta);
      }
      return;
    }

    const toolCall = extractToolCall(event);

    if (toolCall) {
      await answerToolCallOnce(toolCall, activeConversation);
    }

    if (type === "response.done") {
      const responseDetails = readRealtimeResponseDetails(event);

      if (responseDetails) {
        addTranscript("error", responseDetails);
      }

      const usage = extractRealtimeUsageFromEvent(event);

      if (usage) {
        addCostCalculation(calculateRealtimeCost(usage));
      }

      finishAssistantStream();
      const questionId = activeQuizQuestionIdRef.current;

      if (questionId) {
        const question = quizQuestionsRef.current.find((item) => item.id === questionId);

        if (question?.status === "asking") {
          updateQuizQuestion(questionId, { status: "listening" });
        }
      }

      setVoiceActivity("waiting");
      return;
    }
  }

  async function answerToolCallOnce(toolCall: PendingToolCall, activeConversation: ConversationRecord) {
    if (!toolCall.callId || handledToolCallIdsRef.current.has(toolCall.callId)) {
      return;
    }

    handledToolCallIdsRef.current.add(toolCall.callId);
    await answerToolCall(toolCall, activeConversation);
  }

  async function answerToolCall(toolCall: PendingToolCall, activeConversation: ConversationRecord) {
    if (toolCall.name === "grade_quiz_answer") {
      await answerQuizGradeToolCall(toolCall, activeConversation);
      return;
    }

    if (toolCall.name !== "ask_codex") {
      return;
    }

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

  async function answerQuizGradeToolCall(
    toolCall: PendingToolCall,
    activeConversation: ConversationRecord
  ) {
    const args = JSON.parse(toolCall.argumentsText || "{}") as {
      question_id?: string;
      answer?: string;
    };
    const questionId = args.question_id?.trim() || activeQuizQuestionIdRef.current;
    const storedAnswer = questionId
      ? quizQuestionsRef.current.find((question) => question.id === questionId)?.answer
      : undefined;
    const answer = args.answer?.trim() || storedAnswer || "";
    const channel = dataChannelRef.current;

    if (!questionId || !channel || channel.readyState !== "open") {
      return;
    }

    try {
      const grade = await gradeQuizQuestion(questionId, answer, activeConversation);

      channel.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: toolCall.callId,
            output: JSON.stringify({
              status: grade.status,
              grade: grade.grade,
              spoken_summary: grade.spokenSummary
            })
          }
        })
      );
      channel.send(JSON.stringify({ type: "response.create" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quiz answer could not be graded.";
      setQuizError(message);
      channel.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: toolCall.callId,
            output: JSON.stringify({ error: message })
          }
        })
      );
      channel.send(JSON.stringify({ type: "response.create" }));
    }
  }

  const startCodeViewerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("resizing-code-viewer");

    const resize = (clientX: number) => {
      setCodeViewerWidth(clampCodeViewerWidth(window.innerWidth - clientX));
    };
    const stopResize = () => {
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }

      document.body.classList.remove("resizing-code-viewer");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      resize(moveEvent.clientX);
    };

    resize(event.clientX);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }, []);

  return (
    <main className={`app-shell ${codeViewer ? "with-code-viewer-shell" : ""}`}>
      <audio ref={audioRef} autoPlay />
      <section className={`workspace ${codeViewer ? "with-code-viewer" : ""}`} style={workspaceStyle}>
        <aside className="control-panel" aria-label="Question controls">
          <div className="brand-row">
            <div>
              <h1>coread</h1>
            </div>
          </div>

          <label className="field">
            <span>Codebase path</span>
            <div className="path-row">
              <input
                value={targetPath}
                onChange={(event) => {
                  setTargetPath(event.target.value);
                  setValidatedPath("");
                  setValidatedPathInput("");
                  setConversation(null);
                }}
                placeholder="~/src/project"
              />
              <button
                className="icon-button"
                type="button"
                onClick={validatePath}
                disabled={isValidatingPath}
                title="Validate path"
              >
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
              <button
                className="primary-action"
                type="button"
                disabled={!targetPath.trim() || isValidatingPath}
                onClick={connectVoice}
              >
                <Mic size={18} />
                Start voice
              </button>
            ) : (
              <button className="danger-action" type="button" onClick={disconnectVoice}>
                {voiceState === "connecting" ? <MicOff size={18} /> : <Square size={18} />}
                Stop voice
              </button>
            )}
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
                <span className="cost-grid">API cost</span>
				  {formatUsd(costSummary.totalUsd)}
              </div>
              <span>Checked {pricingMetadata.checkedAt}</span>
            </div>

            <div className="cost-grid">
              <span>Realtime</span>
              {formatUsd(costSummary.realtimeUsd)}
              <span>Codex</span>
              {formatUsd(costSummary.codexUsd)}
              {costSummary.totalCredits > 0 ? (
                <>
                  <span>Codex credits</span>
                  <strong>{formatCredits(costSummary.totalCredits)}</strong>
                </>
              ) : null}
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
            <span>Codex session</span>
            <strong>{conversation?.codexSessionId || "Created after first question"}</strong>
          </div>
        </aside>

        <section className="review-panel" aria-label={activeTab === "review" ? "Question transcript" : "Codebase quiz"}>
          <div className="transcript-header">
            <div>
              <h2>{activeTab === "review" ? "Voice and Codex output" : "Codebase quiz"}</h2>
            </div>
            <div className="panel-header-actions">
              {isAskingCodex ? <span className="busy-dot">Codex running</span> : null}
              <div className="view-tabs" role="tablist" aria-label="Main view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "review"}
                  className={activeTab === "review" ? "active" : ""}
                  onClick={() => setActiveTab("review")}
                >
                  Voice
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "quiz"}
                  className={activeTab === "quiz" ? "active" : ""}
                  onClick={() => setActiveTab("quiz")}
                >
                  Quiz
                </button>
              </div>
            </div>
          </div>

          {activeTab === "review" ? (
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
                      <MarkdownContent text={item.text} onOpenFileReference={openFileReference} />
                    ) : (
                      <pre className="message-plain">{item.text}</pre>
                    )}
                  </article>
                ))
              )}
            </div>
          ) : (
            <QuizPanel
              validatedPath={validatedPath}
              components={quizComponentOptions}
              selectedComponentId={selectedQuizComponentId}
              difficulty={quizDifficulty}
              questionCount={quizQuestionCount}
              questions={quizQuestions}
              activeQuestionId={activeQuizQuestionId}
              voiceState={voiceState}
              loadingComponents={isLoadingQuizComponents}
              generatingQuestions={isGeneratingQuiz}
              grading={isGradingQuiz}
              error={quizError}
              onLoadComponents={loadQuizComponents}
              onSelectComponent={setSelectedQuizComponentId}
              onChangeDifficulty={setQuizDifficulty}
              onChangeQuestionCount={setQuizQuestionCount}
              onGenerateQuestions={generateQuizRound}
              onAskQuestion={askQuizQuestionByVoice}
              onOpenFileReference={openFileReference}
            />
          )}
        </section>

        {codeViewer ? (
          <CodeViewerPanel
            viewer={codeViewer}
            onClose={() => setCodeViewer(null)}
            onResizeStart={startCodeViewerResize}
          />
        ) : null}
      </section>
    </main>
  );
}

function QuizPanel({
  validatedPath,
  components,
  selectedComponentId,
  difficulty,
  questionCount,
  questions,
  activeQuestionId,
  voiceState,
  loadingComponents,
  generatingQuestions,
  grading,
  error,
  onLoadComponents,
  onSelectComponent,
  onChangeDifficulty,
  onChangeQuestionCount,
  onGenerateQuestions,
  onAskQuestion,
  onOpenFileReference
}: {
  validatedPath: string;
  components: QuizComponent[];
  selectedComponentId: string;
  difficulty: QuizDifficulty;
  questionCount: number;
  questions: QuizQuestion[];
  activeQuestionId: string | null;
  voiceState: VoiceState;
  loadingComponents: boolean;
  generatingQuestions: boolean;
  grading: boolean;
  error: string;
  onLoadComponents: () => void;
  onSelectComponent: (id: string) => void;
  onChangeDifficulty: (difficulty: QuizDifficulty) => void;
  onChangeQuestionCount: (count: number) => void;
  onGenerateQuestions: () => void;
  onAskQuestion: (question: QuizQuestion, index: number) => void;
  onOpenFileReference: (reference: FileReference) => void;
}) {
  const voiceIsConnecting = voiceState === "connecting";

  return (
    <div className="quiz-panel">
      <div className="quiz-controls">
        <label className="field">
          <span>Component</span>
          <select
            value={selectedComponentId}
            onChange={(event) => onSelectComponent(event.target.value)}
            disabled={!validatedPath || loadingComponents || generatingQuestions}
          >
            {components.map((component) => (
              <option key={component.id} value={component.id}>
                {component.title}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Difficulty</span>
          <select
            value={difficulty}
            onChange={(event) => onChangeDifficulty(event.target.value as QuizDifficulty)}
            disabled={!validatedPath || generatingQuestions}
          >
            {quizDifficultyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Questions</span>
          <input
            type="number"
            min={1}
            max={20}
            value={questionCount}
            onChange={(event) => onChangeQuestionCount(clampQuestionCount(event.target.value))}
            disabled={!validatedPath || generatingQuestions}
          />
        </label>

        <button
          className="secondary-action"
          type="button"
          onClick={onLoadComponents}
          disabled={!validatedPath || loadingComponents || generatingQuestions || grading}
        >
          <BookOpen size={18} />
          {loadingComponents ? "Loading" : "Components"}
        </button>

        <button
          className="primary-action"
          type="button"
          onClick={onGenerateQuestions}
          disabled={!validatedPath || loadingComponents || generatingQuestions || grading}
        >
          <RefreshCw size={18} />
          {questions.length > 0 ? "Refresh" : "Generate"}
        </button>
      </div>

      {error ? <div className="quiz-error">{error}</div> : null}

      {questions.length === 0 ? (
        <div className="empty-state">
          <p>{generatingQuestions ? "Generating questions..." : "No quiz round yet."}</p>
        </div>
      ) : (
        <div className="quiz-card-grid">
          {questions.map((question, index) => (
            <article
              key={question.id}
              className={`quiz-card ${question.status} ${activeQuestionId === question.id ? "active" : ""}`}
            >
              <div className="quiz-card-top">
                <div>
                  <span>Question {index + 1}</span>
                  <strong>{question.componentTitle}</strong>
                </div>
                <span className={`quiz-status ${question.resultStatus ?? question.status}`}>
                  {question.resultStatus ?? getQuizStatusLabel(question.status)}
                </span>
              </div>

              <p className="quiz-question">{question.question}</p>

              <div className="quiz-card-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => onAskQuestion(question, index)}
                  disabled={
                    !validatedPath ||
                    voiceIsConnecting ||
                    question.status === "asking" ||
                    question.status === "grading" ||
                    grading
                  }
                >
                  <Mic size={18} />
                  {voiceState === "idle" ? "Start and ask" : "Ask by voice"}
                </button>
              </div>

              {question.answer ? (
                <div className="quiz-answer">
                  <span>User answer</span>
                  <p>{question.answer}</p>
                </div>
              ) : null}

              {question.status === "grading" ? (
                <div className="quiz-answer pending">
                  <span>Grade</span>
                  <p>Checking answer...</p>
                </div>
              ) : null}

              {question.resultMarkdown ? (
                <div className="quiz-result">
                  <div className="quiz-result-score">
                    <span className={`quiz-result-icon ${question.resultStatus}`}>
                      {question.resultStatus === "correct" ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <HelpCircle size={18} />
                      )}
                    </span>
                    <strong>{question.grade ?? 0}/10</strong>
                  </div>
                  <MarkdownContent text={question.resultMarkdown} onOpenFileReference={onOpenFileReference} />
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function clampQuestionCount(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(20, Math.max(1, Math.trunc(parsed)));
}

function getQuizStatusLabel(status: QuizQuestionStatus): string {
  if (status === "asking") {
    return "asking";
  }

  if (status === "listening") {
    return "listening";
  }

  if (status === "grading") {
    return "grading";
  }

  if (status === "graded") {
    return "graded";
  }

  return "pending";
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

function MarkdownContent({
  text,
  onOpenFileReference
}: {
  text: string;
  onOpenFileReference: (reference: FileReference) => void;
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            const fileReference = parseMarkdownFileReference(href);

            if (fileReference) {
              return (
                <button
                  className="markdown-file-link"
                  type="button"
                  onClick={() => onOpenFileReference(fileReference)}
                >
                  {children}
                </button>
              );
            }

            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeViewerPanel({
  viewer,
  onClose,
  onResizeStart
}: {
  viewer: CodeViewerState;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const highlightedLines = useMemo(() => {
    const language = getLanguageForPath(viewer.displayPath || viewer.requestedPath);

    return viewer.content.split(/\r?\n/).map((line, index) => ({
      number: index + 1,
      html: highlightCodeLine(line, language)
    }));
  }, [viewer.content, viewer.displayPath, viewer.requestedPath]);

  useEffect(() => {
    if (viewer.loading || viewer.error) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      targetLineRef.current?.scrollIntoView({ block: "center" });
    });

    return () => cancelAnimationFrame(frame);
  }, [viewer.content, viewer.error, viewer.loading, viewer.targetLine]);

  return (
    <aside className="code-viewer-panel" aria-label="File viewer">
      <button
        className="code-viewer-resize-handle"
        type="button"
        onPointerDown={onResizeStart}
        aria-label="Resize file viewer"
        title="Drag to resize file viewer"
      />
      <div className="code-viewer-header">
        <div>
          <span>File</span>
          <strong>{viewer.displayPath}</strong>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Close file viewer">
          <X size={18} />
        </button>
      </div>

      {viewer.loading ? (
        <div className="code-viewer-state">Loading file...</div>
      ) : viewer.error ? (
        <div className="code-viewer-state error">{viewer.error}</div>
      ) : (
        <div className="code-viewer-code" role="region" aria-label={`${viewer.displayPath} source`}>
          {highlightedLines.map((line) => {
            const isTargetLine = line.number === viewer.targetLine;

            return (
              <div
                key={line.number}
                ref={isTargetLine ? targetLineRef : undefined}
                className={`code-viewer-line${isTargetLine ? " target" : ""}`}
              >
                <span className="code-viewer-line-number">{line.number}</span>
                <code
                  className="hljs"
                  dangerouslySetInnerHTML={{ __html: line.html }}
                />
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function clampCodeViewerWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return defaultCodeViewerWidth;
  }

  const maxWidth =
    typeof window === "undefined"
      ? defaultCodeViewerWidth
      : Math.max(minCodeViewerWidth, window.innerWidth - codeViewerWorkspaceReserve);

  return Math.min(maxWidth, Math.max(minCodeViewerWidth, Math.trunc(width)));
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

async function readResponseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  }

  return (await response.text()) || response.statusText;
}

function readRealtimeErrorMessage(event: Record<string, unknown>): string {
  const error = event.error;

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const message = event.message;

  if (typeof message === "string" && message.trim()) {
    return message;
  }

  return "Realtime session error.";
}

function readRealtimeResponseDetails(event: Record<string, unknown>): string | undefined {
  const response = event.response;

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }

  const status = (response as Record<string, unknown>).status;

  if (status !== "failed") {
    return undefined;
  }

  const details = (response as Record<string, unknown>).status_details;

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return "Realtime response failed.";
  }

  const error = (details as Record<string, unknown>).error;

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Realtime response failed.";
}

function parseMarkdownFileReference(href: string | undefined): FileReference | undefined {
  if (!href) {
    return undefined;
  }

  const decodedHref = decodeHref(href).trim();

  if (!decodedHref || decodedHref.includes("\n") || decodedHref.startsWith("#")) {
    return undefined;
  }

  const lineMatch = decodedHref.match(/^(.+):([1-9]\d*)(?::\d+)?$/);

  if (!lineMatch) {
    return undefined;
  }

  const filePath = lineMatch[1].trim();

  if (!filePath || hasUrlScheme(filePath)) {
    return undefined;
  }

  return {
    filePath,
    line: Number(lineMatch[2])
  };
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

const languageByExtension: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "xml",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash"
};

function getLanguageForPath(filePath: string): string | undefined {
  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";

  if (fileName === "dockerfile") {
    return "dockerfile";
  }

  if (fileName === "makefile") {
    return "makefile";
  }

  const extension = fileName.split(".").pop() ?? "";
  return languageByExtension[extension];
}

function highlightCodeLine(line: string, language: string | undefined): string {
  if (!language || !hljs.getLanguage(language)) {
    return escapeHtml(line || " ");
  }

  try {
    return hljs.highlight(line || " ", { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(line || " ");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

  if (event.type === "response.done") {
    const response = event.response as Record<string, unknown> | undefined;
    const output = Array.isArray(response?.output) ? response.output : [];
    const item = output.find(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate as Record<string, unknown>).type === "function_call"
    );

    if (!item) {
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
