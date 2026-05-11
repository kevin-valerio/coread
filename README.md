# Realtime Codex Reviewer

Local voice app for codebase questions.

The browser connects to `gpt-realtime-2` through a local Express server. The Realtime model can call an `ask_codex` tool, and the server runs `codex exec` against the selected local codebase. Follow-up questions reuse the same Codex session with `codex exec resume`.

Questions are voice-only from the microphone. The UI shows when Codex is running, then displays only the final model output. It lets the user choose Codex reasoning amount, voice speed, and extra voice instructions.

Bridge notes are in `docs/codex-bridge-investigation.md`.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Set `OPENAI_API_KEY` in `.env` before starting voice.

Codex must already be installed and authenticated on the machine.

## Local URL

```text
http://127.0.0.1:5173
```

## Checks

```bash
npm run check
```

## Notes

The first version uses a path input instead of a native folder picker because browsers do not expose the selected folder's absolute local path.

Codex is run as a read-only investigation worker. It is instructed not to edit files, and the first run uses a read-only sandbox.

Voice speed is passed as Realtime session instruction text. The voice answer is instructed not to speak file names or line numbers aloud; exact references stay in the visible Codex output.
