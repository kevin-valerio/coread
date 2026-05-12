# AGENTS.md

The goal is to let a user pick a local codebase, ask questions by voice, and receive a real-time spoken answer plus a text transcript with file and line references.

The current implementation uses `gpt-realtime-2` for the live voice session. Normal codebase questions use fast local overview, search, and read-file tools so the Realtime model can answer directly. `codex exec` remains available for explicit deep passes, bug hunts, and security reviews.

When Codex is used, follow-up turns must reuse the same Codex session with `codex exec resume` so the review stays contextual inside one topic conversation.

## Product Rules

Keep the app local-only. Bind servers to `127.0.0.1`.

Do not expose `OPENAI_API_KEY` to the browser. The browser sends WebRTC SDP to the local server. The local server calls the OpenAI Realtime API.

The user selects a local folder in the UI. A browser cannot safely expose a real local folder path from a native picker, so the first app version accepts a folder path input and validates it on the local server.

The user can choose Codex reasoning amount before asking a question. Pass this through to Codex as `model_reasoning_effort`.

Default conversations should feel fluid and fast. For broad codebase questions, call the local overview tool and answer with the next useful thing, not a complete report. A good default answer explains the purpose, key entrypoints, and one useful follow-up question.

Only do a deep Codex pass when the user asks for a broad exact-behavior trace, a bug hunt, a security review, or explicitly asks to go deeper. Even then, keep the spoken answer short and put detailed evidence in the transcript.

Failed Codex checks must not look like they are still running. Return an explicit tool error to Realtime, say one short failure sentence aloud, and keep the detailed error in the transcript.

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

Keep tool boundaries explicit. Realtime talks to the browser and local backend. The backend reads bounded local codebase context directly. Codex inspects the target codebase only for explicit deep work.

Do not add speculative features. Build the smallest useful review loop first.

## Current Architecture

The browser opens a WebRTC session with `gpt-realtime-2`.

The local server creates the Realtime session and registers fast codebase tools plus the slower `ask_codex` tool.

When the Realtime model needs normal codebase evidence, it calls `get_codebase_overview`, `search_codebase`, or `read_codebase_file`.

The browser receives those tool calls over the Realtime data channel, calls the local `/api/codebase/*` endpoints, then returns the result to the Realtime session as `function_call_output`.

When the user asks for explicit deep work, Realtime can call `ask_codex`. The browser calls `/api/codex/ask/stream`, then returns the final Codex output to the Realtime session as `function_call_output`.

The backend stores local conversation metadata under `.data/conversations.json`.
