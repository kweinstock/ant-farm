# Data model — what lives where

Three stores, one rule: **DO storage = the live simulation, D1 = its history,
KV = cheap stale reads.**

## Durable Object storage (SQLite inside `ColonyDO`)

Holds the single authoritative `ColonyState`, serialized by
`src/sim/serialize.ts`:

| key | value |
| --- | --- |
| `snapshot` | `Uint8Array` — the whole colony (grid, nest, ants, brood, pheromones, env, rng seed) |
| `seq` | monotonic tick counter at last save |
| `lastTickMs` | wall-clock of the last processed tick (drives replay on wake) |
| `schemaVersion` | bump → `serialize.decode` migrates or rejects |

Written every N ticks and again on hibernation. Read once, in the DO
constructor. Single-writer, so no locking. Losing it rewinds the colony to the
last save — it never corrupts.

## D1 (`db/schema.sql`)

History and anything queried across visitors. Written **batched** by
`src/worker/lineage-sink.ts` via `ctx.waitUntil` so the tick never blocks.

| table | columns | populated by | read by |
| --- | --- | --- | --- |
| `colony_snapshot` | `id=1, seq, sim_time, blob, updated_at` | optional periodic mirror | cold-start / debug |
| `ant` | `id, name, lineage_id, caste, job, born_at, died_at, death_cause, traits_json` | `Birth` (insert), `Death` (update) | `/api/ants`, `/api/ants/:id` |
| `lineage` | `id, surname, founded_at, founder_ant_id, extinct_at` | `Birth` of a founder, `LineageExtinct` | family tree, memorial |
| `lineage_edge` | `parent_ant_id, child_ant_id` (PK both) | `Birth` | `/api/lineage/:id` tree build |
| `pin` | `visitor_id, ant_id, created_at` (PK visitor+ant) | `/api/pins` POST/DELETE | `/api/pins`, leaderboard |
| `event_log` | `id, kind, sim_time, payload_json` | weather/predator/nuptial/queen events | activity feed, memorial |
| `visitor_action` | `id, visitor_id, kind, amount, sim_time, created_at` | `/api/actions/*` | audit, rate-limit backstop |

Indexes: `ant(died_at)` (living list), `ant(lineage_id)`,
`lineage_edge(child_ant_id)`, `pin(ant_id)` (most-pinned), `event_log(kind, sim_time)`.

Housekeeping (`src/worker/cron.ts`, nightly): prune old `event_log` and
long-dead `ant` rows to stay under the ~100k writes/day cap over time.

## KV (`CACHE`, optional)

Pure read-through cache. Every entry tolerates ~60s staleness. Refreshed by
`cron.ts` once a minute, never written on the request path.

| key | value | source |
| --- | --- | --- |
| `ants:living:page:<n>` | serialized `AntSummary[]` | D1 `ant WHERE died_at IS NULL` |
| `leaderboard:pinned` | top-N ants by pin count | D1 `pin` group-by |
| `snapshot:public` | latest lossy snapshot | DO (or `colony_snapshot`) |
| `stats:hud` | `Stats` DTO | DO demography |

## Client (browser)

`localStorage` only, no server persistence of visitor identity:

| key | value |
| --- | --- |
| `antfarm.vid` | anonymous UUID (scopes pins + daily allowance) |
| `antfarm.pins` | cached pin set (authoritative copy is D1) |
| `antfarm.prefs` | UI prefs (pheromone layer on/off, camera) |
