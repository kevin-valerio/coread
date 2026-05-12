# Audit presets

Add two right-edge audit preset tabs: Threat model and User input.

## Scope

When the user validates a codebase path, the app loads cached preset markdown from localStorage. The user can start the preset analyses with the **Run audit presets** button, which asks for confirmation before running Codex. Each preset runs Codex with `gpt-5.5`, extra-high reasoning, and read-only sandboxing. The UI stores the final markdown per codebase path and preset. A refresh control reruns the selected preset and replaces the cached markdown.

The rotated right-side preset buttons open a drawer that leaves part of the voice transcript visible. If a preset is still running, the drawer shows `Thinking, wait please..`.

## Checks

1. `npm run typecheck`
2. `npm run test`
3. Open the local UI, validate a path, confirm both preset tabs start in the background, click each right-side tab, and confirm cached content or the thinking message is shown.
