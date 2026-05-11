# Codex Bridge Investigation

This note compares the current `codex exec resume` bridge with the official Codex app-server path.

## What Was Checked

Local CLI help confirms that `codex exec resume` resumes a previous session by id or thread name.

Local CLI help also confirms that `codex app-server` exists, but the command is marked experimental.

Official Codex app-server docs describe a persistent protocol:

1. Initialize once per connection.
2. Start or resume a thread.
3. Start turns with `turn/start`.
4. Stream events such as `item/started`, `item/completed`, `item/agentMessage/delta`, and tool progress.
5. Finish on `turn/completed`.

## Local Measurements

Fresh `codex exec`, low reasoning, simple package question:

```text
durationMs: 10213
input_tokens: 61275
output_tokens: 100
```

Resumed `codex exec resume`, low reasoning, simple follow-up:

```text
durationMs: 16307
input_tokens: 126006
output_tokens: 217
```

The resumed turn was slower in this small test. The main visible reason is context growth: the resumed session includes earlier prompt and tool output, so the next turn had about double the input tokens.

## Conclusion

`codex exec resume` is the safest first bridge because it is available, simple, and already preserves follow-up context.

It is probably not the best long-term bridge for a low-latency voice app. Each request starts a new CLI subprocess, and resumed conversations can become slower as Codex history grows.

The official app-server path is a better target for this app because it keeps a persistent Codex service connection, has explicit thread and turn APIs, and streams turn events by design. The risk is that it is still marked experimental and needs a real protocol client instead of a small subprocess wrapper.

## Current Recommendation

Keep `codex exec resume` for the current local MVP.

Hide the bridge behind `/api/codex/ask/stream`, which the app already does now. That gives us one stable app API while we later replace the internals with app-server.

For the next bridge iteration, implement an app-server adapter with the same app-level contract:

```text
POST /api/codex/ask/stream
```

The UI and Realtime tool should not need to change when the backend bridge changes.

If we stay on `codex exec resume`, add conversation compaction or a small external summary so old command output does not keep growing the next turn.

