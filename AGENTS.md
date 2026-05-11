# AGENTS.md

The goal is to let a user pick a local codebase, ask questions by voice, and receive a real-time spoken answer plus a text transcript with file and line references.

The first implementation uses `gpt-realtime-2` for the live voice session and `codex exec` as the local investigation worker. Follow-up turns must reuse the same Codex session with `codex exec resume` so the review stays contextual inside one topic conversation.

## Product Rules

Keep the app local-only. Bind servers to `127.0.0.1`.

Do not expose `OPENAI_API_KEY` to the browser. The browser sends WebRTC SDP to the local server. The local server calls the OpenAI Realtime API.

The user selects a local folder in the UI. A browser cannot safely expose a real local folder path from a native picker, so the first app version accepts a folder path input and validates it on the local server.

The user can choose Codex reasoning amount before asking a question. Pass this through to Codex as `model_reasoning_effort`.

The user can preview and choose Realtime voice, choose voice speed, and provide an extra voice system prompt. Voice speed is passed as Realtime instruction text.

This app is for codebase questions and investigation. Codex should not edit files. Run Codex with read-only intent and read-only sandboxing where the CLI supports it.

The UI should show voice status, Codex running state, and durable final model output. Text output must preserve file and line references when Codex provides them. Spoken answers should not read file names, paths, or line numbers aloud.

## Agentic Development Rules

Use a short repo-local `AGENTS.md` as the operating map.

Keep design decisions in `docs/design.md`.

For larger changes, write an executable plan in `docs/exec-plans/` before implementation. The plan should include concrete checks that can be run locally.

Prefer small mechanical checks:

1. Typecheck
2. Unit tests for parsing and bridge logic
3. Manual browser check for the local UI

If you need to use the Google Chrome MCP browser, restart Chrome with:

```bash
open -na 'Google Chrome' --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-devtools-mcp-profile --no-first-run --no-default-browser-check about:blank
```

Make logs inspectable. When an agent calls another agent, keep enough local trace data to debug what happened without guessing.

Keep tool boundaries explicit. Realtime talks to the browser and local backend. The backend executes Codex. Codex inspects the target codebase.

Do not add speculative features. Build the smallest useful review loop first.

## Current Architecture

The browser opens a WebRTC session with `gpt-realtime-2`.

The local server creates the Realtime session and registers an `ask_codex` tool.

When the Realtime model needs codebase evidence, it calls `ask_codex`.

The browser receives that tool call over the Realtime data channel, calls the local `/api/codex/ask/stream` endpoint, then returns the final Codex output to the Realtime session as `function_call_output`.

The backend stores local conversation metadata under `.data/conversations.json`.
