# Realtime Codex Reviewer

Local voice app for codebase questions.

The browser connects to `gpt-realtime-2` through a local Express server. The Realtime model can call an `ask_codex` tool, and the server runs `codex exec` against the selected local codebase. Follow-up questions reuse the same Codex session with `codex exec resume`.

Questions are voice-only from the microphone. The UI shows animated voice state, shows when Codex is running, then displays the final assistant output with Markdown rendering. It lets the user choose Codex reasoning amount, preview and select a Realtime voice, choose voice speed, add extra voice instructions, and track live API cost.

The compact cost panel uses actual token usage events. Realtime cost is calculated from `response.done`. Codex cost is calculated from `codex exec --json` usage when the CLI reports it. Prices are kept in `shared/cost.ts` with the verification date and source links.

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

Voice speed defaults to Very Fast and is passed as Realtime session instruction text. Voice previews use the local server to call the OpenAI speech endpoint, keeping the API key out of the browser. The system prompt textbox is tall enough to show the default prompt. The voice answer is instructed not to speak file names or line numbers aloud; exact references stay in the visible Codex output.

Cost totals reset when a new codebase path is validated. Known Codex CLI model slugs, including `gpt-5.1-codex`, are mapped in `shared/cost.ts`. Unknown model prices or missing token details are shown as unpriced tokens instead of being guessed.
