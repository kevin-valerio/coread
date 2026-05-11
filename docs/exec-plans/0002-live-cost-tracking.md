# Live cost tracking

Add live cost tracking for the local voice review loop.

## Scope

Track Realtime usage from browser data-channel events and Codex usage from the existing SSE stream. Show totals in the left control panel. Do not guess prices for unknown models or missing token details.

## Checks

1. `npm run typecheck`
2. `npm run test`
3. Open `http://127.0.0.1:5173` and verify the cost panel renders without layout overlap.
