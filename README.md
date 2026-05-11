# Realtime Codex Reviewer

Local voice app for code-review conversations.

The browser connects to `gpt-realtime-2` through a local Express server. The Realtime model can call an `ask_codex` tool, and the server runs `codex exec` against the selected local codebase. Follow-up questions reuse the same Codex session with `codex exec resume`.

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

Codex is run as a review worker. It is instructed not to edit files, and the first run uses a read-only sandbox.

