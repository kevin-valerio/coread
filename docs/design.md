# Design

This document describes the first local version of coread.

## Goal

Build a local app where a user can ask voice questions about a codebase and get a real-time spoken answer backed by local codebase evidence.

Normal questions should use fast local file tools directly from the Realtime model. Codex is reserved for explicit deep passes, bug hunts, and security reviews.

The app must support follow-up questions inside one conversation. A single codebase can have many conversations, usually one conversation per topic.

## Main Flow

1. The user starts the local web app.
2. The user enters a local codebase path.
3. The local server validates that the path exists and is a directory.
4. The user chooses Codex reasoning amount, previews and selects a Realtime voice, chooses voice speed, and optional voice instructions. Codex reasoning defaults to `low` for deeper investigations.
5. The user starts voice.
6. The browser opens a WebRTC session to `gpt-realtime-2` through the local server.
7. The user asks a question by microphone.
8. The Realtime model calls fast local tools when it needs codebase evidence.
9. The browser forwards the tool call to the local server.
10. The local server returns a bounded overview, search results, or a file excerpt.
11. The browser returns that tool result to the Realtime session.
12. The Realtime model speaks a concise answer for a user who is new to the codebase, avoids generic follow-up offers, and the UI stores the text transcript.
13. The UI updates cost totals when Realtime or Codex reports token usage.
14. If assistant Markdown contains a file link with a line reference, the user can open it in an in-app code side panel.
15. After a path is validated, the browser starts the Threat model, User input, and Useful skills audit presets if that path does not already have cached markdown in localStorage.

For explicit deep work, Realtime can still call `ask_codex`. The browser forwards that call to the local server, and the local server runs `codex exec` against the selected codebase with bounded read-only instructions.

Audit presets use `POST /api/audit/preset`. The server runs Codex read-only with `gpt-5.5` and high reasoning. The browser stores the final markdown per validated codebase path and preset id in localStorage. The right-side preset drawer shows cached markdown, or `Thinking, wait please..` while the preset is still running. Refresh reruns only the selected preset and replaces the cached markdown. The Useful skills preset asks Codex to rank visible skills by security-bug value and fit for the selected codebase, without executing those skills.

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

Both commands include a `model_reasoning_effort` config override from the UI. New conversations default to `low`; users can choose higher effort when they want a deeper pass. Audit presets also pass a model override, currently `gpt-5.5`.

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
  "reasoningEffort": "low",
  "realtimeReasoningEffort": "medium",
  "voice": "marin",
  "voiceSpeed": "very-fast",
  "turnDetectionMode": "semantic-auto",
  "truncationMode": "auto",
  "voiceSystemPrompt": "Answer in very short bullets."
}
```

The local server forwards the SDP to the OpenAI Realtime API with a session config:

```json
{
  "type": "realtime",
  "model": "gpt-realtime-2",
  "reasoning": {
    "effort": "medium"
  },
  "truncation": "auto",
  "audio": {
    "input": {
      "transcription": {
        "model": "gpt-4o-transcribe"
      },
      "turn_detection": {
        "type": "semantic_vad",
        "eagerness": "auto",
        "create_response": true,
        "interrupt_response": true
      }
    },
    "output": {
      "voice": "marin",
      "speed": 1.25
    }
  },
  "tools": [
    { "type": "function", "name": "get_codebase_overview" },
    { "type": "function", "name": "find_codebase_files" },
    { "type": "function", "name": "list_codebase_directory" },
    { "type": "function", "name": "search_codebase" },
    { "type": "function", "name": "run_ripgrep" },
    { "type": "function", "name": "read_codebase_file" },
    { "type": "function", "name": "ask_codex" }
  ]
}
```

The local server returns the SDP answer to the browser.

Realtime tuning is exposed through compact select controls. The user can choose Realtime reasoning effort, voice speed, turn detection mode, and truncation mode before starting voice. Realtime reasoning defaults to `medium`.

Voice speed defaults to Very Fast and uses both Realtime `audio.output.speed` and instruction text. The speed field changes playback rate, while the instruction still guides cadence and brevity.

Turn detection defaults to semantic VAD with auto eagerness. This helps the model wait when the user pauses while naming files, paths, symbols, or multi-part codebase questions. The UI can also choose patient or eager semantic VAD, or server VAD for silence-based turns.

Truncation defaults to `auto`. The UI can choose cost-oriented retention settings or disable truncation so an over-long session fails instead of silently dropping old context.

Voice previews use `POST /api/voice/preview`. The local server calls the OpenAI speech endpoint with `gpt-4o-mini-tts`, so the API key stays server-side.

The voice is instructed not to say file names, paths, or line numbers aloud. Exact references can stay in visible text.

Normal codebase Q&A uses fast local tools:

```text
get_codebase_overview
find_codebase_files
list_codebase_directory
search_codebase
run_ripgrep
read_codebase_file
```

`get_codebase_overview` returns a bounded file tree and key README/package/config snippets. `find_codebase_files` searches relative file paths by substring. `list_codebase_directory` lists a bounded directory tree. `search_codebase` returns exact string matches with file and line numbers. `run_ripgrep` runs a bounded `rg` search inside the selected codebase with controlled options. `read_codebase_file` returns a bounded numbered file excerpt.

After Codex finishes, the browser stores the full Codex answer in the transcript but sends Realtime only a compact `spoken_summary` from the `Short version` or `Short answer` paragraph. The voice says that summary or a close paraphrase, then stops and waits.

If Codex fails, the browser still returns a `function_call_output` to Realtime. That output includes an `error` field plus a short `spoken_summary`, so the voice can say the check failed instead of acting like the tool is still running.

Codex prompts are still tuned for bounded interaction. Broad normal questions should not call Codex. Codex should stop once it has enough evidence for a useful deep answer instead of searching for completeness.

Realtime cost is calculated from `response.done`. The app uses text, audio, image, cached input, and output token details when they are present. If a response does not include enough detail to price safely, the tokens are counted as unpriced.

## Fast Tool Contract

Tool names:

```text
get_codebase_overview
find_codebase_files
list_codebase_directory
search_codebase
run_ripgrep
read_codebase_file
```

File discovery arguments:

```json
{
  "query": "auth",
  "max_results": 20
}
```

Directory listing arguments:

```json
{
  "directory_path": "server",
  "depth": 1,
  "max_results": 80
}
```

Exact search arguments:

```json
{
  "query": "createRealtimeSession",
  "max_results": 20
}
```

Ripgrep arguments:

```json
{
  "pattern": "create.*Session",
  "search_path": "server",
  "fixed_strings": false,
  "case_sensitive": false,
  "max_results": 20
}
```

Read arguments:

```json
{
  "file_path": "server/realtime.ts",
  "start_line": 150,
  "line_count": 80
}
```

The browser handles those tool calls by calling:

```text
POST /api/codebase/overview
POST /api/codebase/files
POST /api/codebase/directory
POST /api/codebase/search
POST /api/codebase/rg
POST /api/codebase/read
```

The server resolves all paths under the validated target codebase and rejects outside files.

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

Failure tool output:

```json
{
  "conversation_id": "local-conversation-id",
  "spoken_summary": "Codex could not complete that check. The error is visible in the transcript.",
  "full_answer_visible_in_transcript": true,
  "error": "Codex turn failed: Unsupported model"
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

The Realtime model can trigger local overview, search, read-file, and optional Codex investigation tools. It cannot directly execute shell commands.

The server validates paths at the API boundary.

Markdown file references are opened through `POST /api/codebase/file`. The browser sends the selected codebase path and the linked file path. The server resolves the file through the real filesystem path and rejects files outside the selected codebase before reading content.

## Known Limitations

The first browser UI uses a path input instead of a native folder picker because browsers do not expose the selected folder's absolute path to web pages.

Realtime voice requires `OPENAI_API_KEY` in the local server environment.

Codex must already be installed and authenticated on the machine for deep investigations and quiz generation.

Deep Codex investigations can still take time when the user selects higher reasoning or asks for a full review. The default voice loop avoids Codex and uses bounded local file tools for faster answers.

The cost panel is local UI state. It is meant to show the current browser session cost, not a historical billing report.
