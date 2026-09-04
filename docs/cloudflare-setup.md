# Cloudflare setup

Everything below fits the **free** Workers plan. Verify current limits at
`developers.cloudflare.com` — the numbers move.

## 0. Prerequisites

- A Cloudflare account with the `kweinstock.dev` zone (already used by the
  landing-page Worker — this project attaches to `/ant-farm/*` routes, so there
  is no new DNS record or certificate).
- `wrangler` (already a dev dependency): `npx wrangler login`.

## 1. Create the D1 database

```bash
npx wrangler d1 create ant-farm
```

Copy the returned `database_id` into `wrangler.jsonc` (see step 4), then:

```bash
npx wrangler d1 migrations apply ant-farm --local    # dev
npx wrangler d1 migrations apply ant-farm --remote    # production
```

Migrations live in `db/migrations/`. `db/schema.sql` is the human-readable
current shape.

## 2. (Optional) Create the KV namespace

```bash
npx wrangler kv namespace create CACHE
```

Copy the `id` into `wrangler.jsonc`. Skip this until browse traffic actually
needs shielding from D1.

## 3. Durable Object

No CLI step — the DO class is declared in `wrangler.jsonc` and created on first
deploy. It **must** be registered as SQLite-backed (`new_sqlite_classes`), because
the free plan does not include the older key-value-only DO storage.

## 4. `wrangler.jsonc` additions

The repo's current `wrangler.jsonc` only configures static assets. Add:

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

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ant-farm",
      "database_id": "<from step 1>"
    }
  ],

  "kv_namespaces": [
    { "binding": "CACHE", "id": "<from step 2, optional>" }
  ],

  "triggers": {
    "crons": ["*/1 * * * *"]
  }

  // The existing "assets" block stays. In a Worker with `main`, the asset
  // binding is reachable as env.ASSETS; static files are served automatically
  // for paths that don't match a route the Worker handles.
}
```

The `testing` env block should get the same `durable_objects` / `d1_databases` /
`triggers` keys (pointing at a separate `ant-farm-testing` D1 database) so the
two branches never share a colony.

## 5. Local dev

```bash
npx wrangler dev
```

Runs the Worker + a local Durable Object + local D1 in `workerd`. `alarm()` fires
locally, so the sim ticks. `npm run dev` (Vite) is still used for fast frontend
iteration — point its dev proxy at the `wrangler dev` port for `/ant-farm/api/*`.

## 6. Deploy

Unchanged from the current setup — Cloudflare Workers Builds, one Worker per
branch:

| Branch | Worker | Command |
| --- | --- | --- |
| `main` | `ant-farm` | `npm run build && npx wrangler deploy` |
| `testing` | `ant-farm-testing` | `npm run build && npx wrangler deploy --env testing` |

`npm run build` compiles `src/web` to `dist/`; `wrangler deploy` bundles
`src/worker` + uploads `dist/` as assets + creates/updates the DO and cron.

## 7. Free-tier budget — the one calculation that matters

Workers free plan is ~**100,000 requests/day**. Every `alarm()` invocation
counts. Every inbound WebSocket connection counts (messages on an open socket are
cheap; the broadcast fan-out is not billed per-viewer). Every cron fire counts.

| `TICK_MS` | alarm invocations/day | headroom left for visitors + cron |
| --- | --- | --- |
| 1000 | ~86,400 | almost none — don't |
| 2000 | ~43,200 | ~55k |
| 5000 | ~17,280 | ~80k |
| 10000 | ~8,640 | ~90k |

Cron at `*/1` adds ~1,440/day. Start at **`TICK_MS = 5000`** (the sim can run
multiple simulation steps per alarm if you want finer-grained behavior — the
alarm cadence and the sim step size are separate knobs; see
`src/worker/loop.ts`). Revisit if you move to the paid plan.

Other caps to respect:
- **D1 writes** ~100k rows/day → `lineage-sink.ts` batches events, never writes
  per ant per tick.
- **KV writes** ~1k/day → refresh caches once per minute from `cron.ts`, not on
  demand.
- **Worker bundle** ~1 MB gzipped → plenty of room for an all-TypeScript build;
  only a concern if a future WASM sim core is ever added.
- **DO CPU per alarm** — a long catch-up after eviction must bail early
  (`MAX_CATCHUP_TICKS`) and finish on the next alarm.
