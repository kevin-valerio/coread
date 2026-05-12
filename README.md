# coread

Local voice app for asking questions about a codebase. It uses OpenAI Realtime for speech, fast local file tools for normal answers, and Codex CLI only for deeper investigations.

| Feature | What it does                                                           |
| --- |------------------------------------------------------------------------|
| Codebase vocal interaction | Ask codebase questions by voice. Normal questions use local overview, search, and read-file tools, so Realtime can answer directly without waiting for Codex. Codex is still available for explicit deep passes, bug hunts, and security reviews. The mic is held muted during voice playback to avoid the assistant hearing itself. |
| Quiz | Generate codebase questions, answer by voice, and get graded feedback. |


```bash
OPENAI_API_KEY=key npm run dev
```

## What's the goal?
Use your voice to ask questions about a codebase and get fast, interactive answers back. Use Codex only when you want a deeper pass. Play quizzes to check how well you know a codebase. Made for auditors who regularly jump into unknown codebases.
