# coread

Local voice app for asking questions about a codebase.

It uses OpenAI Realtime for speech and Codex CLI to inspect the selected local folder. The OpenAI API key stays on the local server and is required for voice.

| Feature | What it does |
| --- | --- |
| Codebase vocal interaction | Ask codebase questions by voice and get spoken answers plus text output with file references. |
| Quiz | Generate codebase questions, answer by voice, and get graded feedback. |

## Run

Requirements: Node.js, npm, Codex CLI installed and authenticated, and an OpenAI API key.

```bash
cp .env.example .env
```

Set the key in `.env`:

```text
OPENAI_API_KEY=your_api_key_here
```

Start the app:

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Check

```bash
npm run check
```
