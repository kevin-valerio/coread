# coread

Local voice app for asking questions about a codebase.  It uses OpenAI Realtime for speech and Codex CLI to inspect the selected codebase.

| Feature | What it does                                                           |
| --- |------------------------------------------------------------------------|
| Codebase vocal interaction | Ask codebase questions by voice. The voice speaks the short Codex summary while the transcript keeps the full answer with file references. The mic is held muted during voice playback to avoid the assistant hearing itself. |
| Quiz | Generate codebase questions, answer by voice, and get graded feedback. |


```bash
OPENAI_API_KEY=key npm run dev
```

## What's the goal?
Use your voice to ask questions about a codebase and get almost-instant answers back. Play quizzes to check how well you know a codebase. Made for auditors who regularly jump into unknown codebases.
