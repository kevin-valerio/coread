# coread

Local voice app for asking questions about a codebase. It uses OpenAI Realtime for speech, fast local codebase tools for normal answers, and Codex CLI only for deeper investigations.

| Feature | What it does                                                           |
| --- |------------------------------------------------------------------------|
| Codebase vocal interaction | Ask codebase questions by voice. Normal questions use local overview, file discovery, directory listing, text search, ripgrep, and read-file tools, so Realtime can answer directly without waiting for Codex. Codex is still available for explicit deep passes, bug hunts, and security reviews. The mic is held muted during voice playback to avoid the assistant hearing itself. The transcript can be cleared from the UI. |
| Quiz | Generate codebase questions, answer by voice, and get graded feedback. |


```bash
OPENAI_API_KEY=key npm run dev
```

The fast `run_ripgrep` tool requires `rg` to be installed and available on `PATH`.

The UI exposes compact Realtime controls for reasoning, voice speed, turn detection, and truncation. Voice speed uses both Realtime playback speed and pacing instructions. Turn detection defaults to semantic VAD so longer codebase questions are less likely to be cut off while the user is still naming files, paths, or symbols.

The Current state bars use the local microphone stream as a live voice meter during a voice session.

## What's the goal?
Use your voice to ask questions about a codebase and get fast, interactive answers back. Use Codex only when you want a deeper pass. Play quizzes to check how well you know a codebase. Made for auditors who regularly jump into unknown codebases.
