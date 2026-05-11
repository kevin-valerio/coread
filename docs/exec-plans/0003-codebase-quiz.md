# Codebase quiz

Add a Quiz tab that lets the user select a codebase component, pick a difficulty, generate questions, and answer by voice.

## Scope

Codex proposes component choices for the selected repo. Codex generates the quiz questions and expected answers for the chosen component or whole codebase. The Realtime session asks each selected question aloud and calls back into the app to grade the spoken answer. The UI keeps quiz state in the current browser session and renders grading evidence as Markdown with file references.

## Checks

1. `npm run typecheck`
2. `npm run test`
3. Open `http://127.0.0.1:5173`, validate a local repo, open Quiz, generate components, generate questions, and confirm the cards render without overlap.
