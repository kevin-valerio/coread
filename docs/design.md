# Design

This document describes the first local version of Realtime Codex Reviewer.

## Goal

Build a local app where a user can ask voice questions about a codebase and get a real-time spoken answer backed by Codex investigation.

The app must support follow-up questions inside one review conversation. A single codebase can have many conversations, usually one conversation per review topic.

## Main Flow

1. The user starts the local web app.
2. The user enters a local codebase path.
3. The local server validates that the path exists and is a directory.
4. The user chooses a review mode: security, bug, or architecture.
5. The user starts voice.
6. The browser opens a WebRTC session to `gpt-realtime-2` through the local server.
7. The user asks a question by microphone.
8. The Realtime model calls the `ask_codex` tool when it needs codebase evidence.
9. The browser forwards the tool call to the local server.
10. The local server runs `codex exec` against the selected codebase.
11. The browser returns the Codex result to the Realtime session.
12. The Realtime model speaks a concise answer and the UI stores the text transcript.

## Follow-Up Context

`codex exec` is non-interactive, but it supports resuming a prior session.

For the first question in a conversation, the server runs:

```bash
codex exec --json --skip-git-repo-check --sandbox read-only -C <codebase> -o <output-file> -
```

For later questions in the same conversation, the server runs:

```bash
codex exec resume <session-id> --json -o <output-file> -
```

The app stores the Codex session id in `.data/conversations.json`.

The first prompt includes a unique conversation token. If the CLI does not directly print a session id, the server searches the local Codex session files for that token and records the matching session id.

## Realtime Bridge

The browser never receives the OpenAI API key.

The browser creates a WebRTC offer and sends the SDP to:

```text
POST /api/realtime/session
```

The local server forwards that SDP to the OpenAI Realtime API with a session config:

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

## Codex Tool Contract

Tool name:

```text
ask_codex
```

Arguments:

```json
{
  "question": "Where can this parser panic?",
  "mode": "security",
  "conversation_id": "local-conversation-id"
}
```

Result:

```json
{
  "conversationId": "local-conversation-id",
  "codexSessionId": "codex-session-id",
  "answer": "Codex output with file and line references",
  "durationMs": 12345
}
```

## Review Modes

Security review asks Codex to prioritize exploitable behavior, trust boundaries, unsafe parsing, injection, authz/authn issues, secret handling, command execution, path traversal, crypto misuse, concurrency hazards, and missing checks at external boundaries.

Bug review asks Codex to prioritize crashes, incorrect state, data loss, bad edge cases, race conditions, broken assumptions, regressions, and missing tests.

Architecture review asks Codex to prioritize module boundaries, state ownership, coupling, unclear contracts, scalability bottlenecks, operational risks, and code paths that are hard to change safely.

## Harness Engineering Practices

This app follows the harness engineering ideas from OpenAI's article:

1. Keep instructions short and local.
2. Keep durable design context in repo docs.
3. Make agent work auditable through logs and local artifacts.
4. Use executable plans for non-trivial changes.
5. Define exact tool boundaries instead of relying on vague model behavior.
6. Prefer mechanical checks over trust.

## Safety Defaults

The current app runs Codex in review mode and tells it not to edit files.

The first Codex command uses `--sandbox read-only`.

The Realtime model can trigger Codex investigation, but it cannot directly execute shell commands. It can only call the local `ask_codex` tool.

The server validates paths at the API boundary.

## Known Limitations

The first browser UI uses a path input instead of a native folder picker because browsers do not expose the selected folder's absolute path to web pages.

Realtime voice requires `OPENAI_API_KEY` in the local server environment.

Codex must already be installed and authenticated on the machine.

Long Codex investigations can take time. The UI shows pending tool-call state while Codex runs.

