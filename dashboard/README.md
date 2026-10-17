# Prompt2Prod dashboard

Mission-control web UI for Prompt2Prod (Vite + React, plain CSS, hand-rolled SVG charts).
The data model and REST contract live in [`../docs/SPEC.md`](../docs/SPEC.md).

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
```

With no backend reachable, the app starts in **offline demo mode** automatically.

To develop against a running backend, pick one:

```bash
# Call the API directly (needs CORS on the backend)
VITE_API_BASE=https://prompt2prod-82783179546.asia-south1.run.app npm run dev

# …or proxy /api through Vite (no CORS needed)
DEV_API_PROXY=http://localhost:8080 npm run dev
```

## Build

```bash
npm run build          # → dist/  (FastAPI serves it at /)
npm run preview        # serve the built bundle locally
```

Assets use relative paths (`base: './'`) and routing is hash-based (`#/`, `#/task/:id`, `#/releases`,
`#/insights`, `#/integrations`), so `dist/` works from any path without server rewrites.
Firebase and the demo backend are lazy-loaded chunks.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_BASE` | build/dev | API origin. Default `''` = same origin (FastAPI serves the dashboard). |
| `DEV_API_PROXY` | dev only | Optional Vite proxy target for `/api`. |

## Live mode

On load the app calls `GET {API_BASE}/api/config`, initialises Firebase with `config.firebase`, signs in
anonymously, and subscribes with `onSnapshot` to `projects`, `tasks` (newest 100) and, for the open task,
`tasks/{id}` + `tasks/{id}/events` (ordered by `seq`). Writes go through the REST API with
`Authorization: Bearer <Firebase ID token>`. The display name (stored in localStorage) is sent as
`requesterName` when creating tasks and as the `X-Requester-Name` header on approve / reject / rollback /
retry / cancel / reset.

## Demo mode (offline)

Starts automatically when `/api/config` fails, or force it with **`?mock=1`**
(e.g. `http://localhost:5173/?mock=1#/`). A "Demo data" badge shows in the sidebar.

- Seeded with 13 realistic tasks over the last 14 days on the "Acme Tasks" Flask app: deployed, a
  rollback, a failed run (tests still red after 3 attempts), a rejected change and one awaiting approval.
- New tasks from the composer animate through all 10 stages (an event every 0.4–1.5 s, ~1 min total):
  TDD red phase, a pytest failure on attempt 1 that the Coder self-heals, a real unified diff, AI review,
  a preview URL whose Live preview renders the changed app, live smoke checks, then autopilot release
  (or the approval gate — Approve releases, Reject discards, Roll back restores the previous release).
- `?speed=2` (0.25–8) speeds the simulation up or down for recordings.
- Demo state is in memory; a full reload re-seeds it.

Deep links for screenshots: `#/task/k3x9p2/diff` (tabs: `overview`, `diff`, `tests`, `review`,
`preview`, `verify`).
