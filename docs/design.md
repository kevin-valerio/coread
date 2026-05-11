# Design

This document describes the first local version of coread.

## Goal

Build a local app where a user can ask voice questions about a codebase and get a real-time spoken answer backed by Codex investigation.

The app must support follow-up questions inside one conversation. A single codebase can have many conversations, usually one conversation per topic.

## Main Flow

1. The user starts the local web app.
2. The user enters a local codebase path.
3. The local server validates that the path exists and is a directory.
4. The user chooses Codex reasoning amount, previews and selects a Realtime voice, chooses voice speed, and optional voice instructions.
5. The user starts voice.
6. The browser opens a WebRTC session to `gpt-realtime-2` through the local server.
7. The user asks a question by microphone.
8. The Realtime model calls the `ask_codex` tool when it needs codebase evidence.
9. The browser forwards the tool call to the local server.
10. The local server runs `codex exec` against the selected codebase.
11. The browser returns the Codex result to the Realtime session.
12. The Realtime model speaks a concise answer and the UI stores the text transcript.
13. The UI updates cost totals when Realtime or Codex reports token usage.
14. If assistant Markdown contains a file link with a line reference, the user can open it in an in-app code side panel.

## Follow-Up Context

`codex exec` is non-interactive, but it supports resuming a prior session.

For the first question in a conversation, the server runs:

```bash
codex exec --json --skip-git-repo-check --sandbox read-only -c model_reasoning_effort="<effort>" -C <codebase> -o <output-file> -
```

For later questions in the same conversation, the server runs:

```bash
codex exec resume <session-id> --json -c sandbox_mode="read-only" -c model_reasoning_effort="<effort>" -o <output-file> -
```

Both commands include a `model_reasoning_effort` config override from the UI.

See `docs/codex-bridge-investigation.md` for the current bridge tradeoff. `codex exec resume` works, but app-server is the better long-term bridge for lower-latency voice sessions.

The app stores the Codex session id in `.data/conversations.json`.

The first prompt includes a unique conversation token. If the CLI does not directly print a session id, the server searches the local Codex session files for that token and records the matching session id.

## Realtime Bridge

The browser never receives the OpenAI API key.

The browser creates a WebRTC offer and sends the SDP to:

```text
POST /api/realtime/session/json
```

The local server receives the SDP plus local session settings:

```json
{
  "sdp": "v=0...",
  "targetPath": "/Users/example/project",
  "conversationId": "local-conversation-id",
  "reasoningEffort": "medium",
  "voice": "marin",
  "voiceSpeed": "very-fast",
  "voiceSystemPrompt": "Answer in very short bullets."
}
```

The local server forwards the SDP to the OpenAI Realtime API with a session config:

```json
{
  "type": "realtime",
  "model": "gpt-realtime-2",
  "tools": [
    {
      "type": "function",
      "name": "ask_codex"
    }
  ]
}
```

The local server returns the SDP answer to the browser.

Voice speed defaults to Very Fast and is currently implemented as Realtime instruction text because the checked public Realtime WebRTC docs do not expose a stable speech-speed field for this session shape.

Voice previews use `POST /api/voice/preview`. The local server calls the OpenAI speech endpoint with `gpt-4o-mini-tts`, so the API key stays server-side.

The voice is instructed not to say file names, paths, or line numbers aloud. Exact references stay in the visible Codex output.

After Codex finishes, the browser stores the full Codex answer in the transcript but sends Realtime only a compact `spoken_summary` from the `Short version` or `Short answer` paragraph. The voice says that summary or a close paraphrase.

Realtime cost is calculated from `response.done`. The app uses text, audio, image, cached input, and output token details when they are present. If a response does not include enough detail to price safely, the tokens are counted as unpriced.

## Codex Tool Contract

Tool name:

```text
ask_codex
```

Arguments:

```json
{
  "question": "Where can this parser panic?",
  "conversation_id": "local-conversation-id"
}
```

The browser also sends the selected Codex reasoning amount to the local server request. The stream sends structured `usage` progress events when Codex reports token usage. The UI prices those events with the shared calculator in `shared/cost.ts`.

Before returning the tool result to Realtime, the browser converts the backend result to a voice payload:

```json
{
  "conversation_id": "local-conversation-id",
  "codex_session_id": "codex-session-id",
  "spoken_summary": "Short spoken result without file references",
  "full_answer_visible_in_transcript": true
}
```

Backend result:

```json
{
  "conversationId": "local-conversation-id",
  "codexSessionId": "codex-session-id",
  "answer": "Codex output with file and line references",
  "durationMs": 12345
}
```

## Harness Engineering Practices

This app follows the harness engineering ideas from OpenAI's article:

1. Keep instructions short and local.
2. Keep durable design context in repo docs.
3. Make agent work auditable through logs and local artifacts.
4. Use executable plans for non-trivial changes.
5. Define exact tool boundaries instead of relying on vague model behavior.
6. Prefer mechanical checks over trust.

## Safety Defaults

The current app runs Codex in read-only investigation mode and tells it not to edit files.

The first Codex command uses `--sandbox read-only`.

The Realtime model can trigger Codex investigation, but it cannot directly execute shell commands. It can only call the local `ask_codex` tool.

The server validates paths at the API boundary.

Markdown file references are opened through `POST /api/codebase/file`. The browser sends the selected codebase path and the linked file path. The server resolves the file through the real filesystem path and rejects files outside the selected codebase before reading content.

## Known Limitations

The first browser UI uses a path input instead of a native folder picker because browsers do not expose the selected folder's absolute path to web pages.

Realtime voice requires `OPENAI_API_KEY` in the local server environment.

Codex must already be installed and authenticated on the machine.

Long Codex investigations can take time. The UI shows a running state while Codex runs, then displays the final model output.

The cost panel is local UI state. It is meant to show the current browser session cost, not a historical billing report.
