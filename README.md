# coread

Local voice app for asking questions about a codebase. It uses OpenAI Realtime for speech, fast local codebase tools for normal answers, and Codex CLI only for deeper investigations.

| Feature | What it does                                                           |
| --- |------------------------------------------------------------------------|
| Codebase vocal interaction | Ask codebase questions by voice. Normal questions use local overview, file discovery, directory listing, text search, ripgrep, and read-file tools, so Realtime can answer directly without waiting for Codex. When a deeper Codex pass may be useful, Realtime asks before starting it. The mic is held muted during voice playback to avoid the assistant hearing itself. Tool follow-up responses wait for the active Realtime response to finish before creating the next response. Spoken user turns appear in the transcript after Realtime input transcription completes. Answers assume the user is new to the codebase and avoid generic follow-up offers. The transcript can be cleared from the UI. |
| Audit presets | Validate a codebase, click **Run audit presets**, confirm the Codex run, and coread generates cached Threat model, User input, and Useful skills audit notes with Codex `gpt-5.5` extra-high reasoning. Useful skills ranks visible skills by security-bug value and codebase fit without executing them. |
| Quiz | Generate codebase questions, answer by voice, and get graded feedback. |


```bash
OPENAI_API_KEY=key npm run dev
```

Transcript entries use the same compact box sizing for user, assistant, status, and error messages.
API failures are shown as explicit transcript errors, including empty or malformed server responses.

## What's the goal?
Use your voice to ask questions about a codebase and get fast, interactive answers back. Use Codex only when you want a deeper pass. Play quizzes to check how well you know a codebase. Made for auditors who regularly jump into unknown codebases.
