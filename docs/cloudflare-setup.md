# Cloudflare setup

Everything below fits the **free** Workers plan. Verify current limits at
`developers.cloudflare.com` — the numbers move.

## 0. Prerequisites

- A Cloudflare account with the `kweinstock.dev` zone (already used by the
  landing-page Worker — this project attaches to `/ant-farm/*` routes, so there
  is no new DNS record or certificate).
- `wrangler` (already a dev dependency): `npx wrangler login`.

## 1. Durable Object

No CLI step — the DO class is declared in `wrangler.jsonc` and created on first
deploy. It **must** be registered as SQLite-backed (`new_sqlite_classes`), because
the free plan does not include the older key-value-only DO storage.

## 2. `wrangler.jsonc`

The Worker, the Durable Object binding and the migration, in addition to the
static-assets block:

```jsonc
{
  // ...existing name / compatibility_date / assets / routes...

  "main": "src/worker/index.ts",

  "durable_objects": {
    "bindings": [
      { "name": "COLONY", "class_name": "ColonyDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ColonyDO"] }
  ],

  // The existing "assets" block stays. In a Worker with `main`, the asset
  // binding is reachable as env.ASSETS; static files are served automatically
  // for paths that don't match a route the Worker handles.
}
```

The `testing` env block repeats `durable_objects` and `migrations`, so the two
environments never share a colony. There is no D1 database, KV namespace or cron
trigger: the Durable Object's own storage and alarms are all the backend needs.

## 3. Local dev

```bash
npx wrangler dev
```

Runs the Worker + a local Durable Object in `workerd`. `alarm()` fires
locally, so the sim ticks. `npm run dev` (Vite) is still used for fast frontend
iteration — point its dev proxy at the `wrangler dev` port for `/ant-farm/api/*`.

## 4. Deploy

Unchanged from the current setup — Cloudflare Workers Builds, one Worker per
branch:

| Branch | Worker | Command |
| --- | --- | --- |
| `main` | `ant-farm` | `npm run build && npx wrangler deploy` |
| `testing` | `ant-farm-testing` | `npm run build && npx wrangler deploy --env testing` |

`npm run build` compiles `src/web` to `dist/`; `wrangler deploy` bundles
`src/worker` + uploads `dist/` as assets + creates/updates the DO.

## 5. Free-tier budget — the one calculation that matters

Workers free plan is ~**100,000 requests/day**. Every `alarm()` invocation
counts. Every inbound WebSocket connection counts (messages on an open socket are
cheap; the broadcast fan-out is not billed per-viewer). 

| `TICK_MS` | alarm invocations/day | headroom left for visitors |
| --- | --- | --- |
| 1000 | ~86,400 | almost none — don't |
| 2000 | ~43,200 | ~55k |
| 5000 | ~17,280 | ~80k |
| 10000 | ~8,640 | ~90k |

**What the code actually does** (`src/shared/constants.ts`): `TICK_MS` (200 ms) is the
sim step, not the alarm cadence. While at least one viewer is connected the object
wakes every `ALARM_MS` (5 s, ~17k alarms/day if someone watches 24 h) and sends the
~25 ticks since the last wake as one `Batch`. With nobody connected it wakes every
`IDLE_ALARM_MS` (~20 min, ~73/day), runs the whole gap in one go (at most
`MAX_RUN_TICKS` ticks, sized to the per-invocation CPU limit), saves, and is evicted
until the next alarm. The first viewer after an idle stretch is caught up to the
present before they get their snapshot. The table above is therefore the *watched*
budget, scaled by hours watched per day.

Start at **`TICK_MS = 5000`** (the sim can run
multiple simulation steps per alarm if you want finer-grained behavior — the
alarm cadence and the sim step size are separate knobs; see
`src/worker/loop.ts`). Revisit if you move to the paid plan.

Other caps to respect:
- **Worker bundle** ~1 MB gzipped → plenty of room for an all-TypeScript build;
  only a concern if a future WASM sim core is ever added.
- **DO CPU per alarm** — a long catch-up after eviction must bail early
  (`MAX_CATCHUP_TICKS`) and finish on the next alarm.
