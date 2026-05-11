# Initial Local App Plan

Build a minimal local app that connects browser microphone input to `gpt-realtime-2`, exposes an `ask_codex` tool, and runs Codex against a selected local codebase.

## Steps

1. Create Vite React UI and Express backend in one Node project.
2. Add local server endpoints for path validation, conversation storage, Realtime WebRTC session creation, and Codex questions.
3. Implement Codex subprocess bridge with first-turn and resume-turn support.
4. Implement browser WebRTC client and Realtime function-call handling.
5. Add basic tests for path expansion and session-id parsing.
6. Run typecheck and tests.
7. Start the local dev server and verify the UI renders.

## Checks

```bash
npm run check
```

Manual check:

```text
Open http://127.0.0.1:5173 and verify the app renders.
```
