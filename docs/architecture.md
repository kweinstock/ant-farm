# Global Ant Farm — Architecture

Paper design only. No implementation yet — every file under `src/` and `test/`
is a comment-only stub describing what goes there and how it connects.

---

## 1. Mental model

There is **one global colony**. It is authoritative, lives server-side, and ticks
forward even when nobody is watching ("persistent"). Visitors are thin clients
that:

- **watch** a live stream of colony state,
- **nudge** it in a few allowed ways (drop food, drop water, pin an ant),
- **browse** derived data (living-ant list, an ant's detail, family trees, the
  roll of the dead).

Everything else — weather, day/night, seasons, temperature, predators, flooding,
disease, death rolls — is **server-driven and visitors cannot touch it**. That
boundary is enforced structurally: there is simply no API endpoint and no
`VisitorInput` variant for those things (`src/sim/inputs.ts` accepts only
`food` and `water`).

The three hard problems are (a) a single shared mutable simulation, (b) a loop
that runs without an always-on server, (c) real-time fan-out to many viewers. On
Cloudflare's free tier, one primitive solves all three: a **Durable Object** with
an `alarm()`.

```
                 ┌─────────────────────────────────────────────┐
   Browser ──────┤ Cloudflare Worker static assets  (src/web)   │
   (viewer)      │  served at kweinstock.dev/ant-farm/          │
                 └─────────────────────────────────────────────┘
       │  REST  /ant-farm/api/ants, /pins, /actions, /lineage, /stats
       │  WS    /ant-farm/api/stream   (Hello + Snapshot + Diffs)
       ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Worker  (src/worker/index.ts)                              │
   │  - routes requests, CORS, serves the built SPA             │
   │  - read-only browsing  -> D1 / KV directly                 │
   │  - stream + mutations  -> the ONE Durable Object           │
   └───────────────────────────────────────────────────────────┘
       │ stub = env.COLONY.get(env.COLONY.idFromName("global-colony"))
       ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Durable Object: ColonyDO   (single instance)               │
   │  - holds full ColonyState in memory                        │
   │  - alarm() = the tick loop; reschedules itself forever     │
   │  - runs src/sim step() each tick                           │
   │  - broadcasts Diffs to hibernatable WebSockets             │
   │  - persists state to DO storage every N ticks              │
   │  - streams births/deaths/lineage events to D1              │
   └───────────────────────────────────────────────────────────┘
       │                                     │
       ▼                                     ▼
   DO storage (SQLite)                   D1 database (db/)
   authoritative live snapshot        family trees, names, pins,
   for crash / eviction recovery      event history, memorial
       ▲
       │ every 1 min: keepalive + nightly housekeeping
   Cron Trigger ── hits Worker ── pings the DO
```

---

## 2. Folder structure

Single npm package (matches the existing repo — not a monorepo). The simulation
is a **pure, platform-free module** (`src/sim`) so it can be unit-tested in
isolation — and, if it ever outgrows JS, ported behind the same `step()`
signature without touching the Worker (see section 6).

```
ant-farm/
├── index.html                  # SPA shell (loads the web bootstrap)
├── package.json                # + scripts: db:migrate, test, deploy
├── wrangler.jsonc              # add: main, [[durable_objects]], [[d1_databases]],
│                               #      [[kv_namespaces]], [[migrations]], triggers.crons
├── vite.config.ts              # builds src/web -> dist/ (base /ant-farm/)
│
├── docs/
│   ├── architecture.md         # this file
│   ├── cloudflare-setup.md     # accounts, bindings, deploy, free-tier limits + math
│   ├── simulation-model.md     # tick order, the rule list, emergent behaviors to watch
│   ├── ant-biology.md          # the real-ant facts the model honors
│   └── data-model.md           # what lives in DO storage vs D1 vs KV, and why
│
├── db/
│   ├── schema.sql              # current D1 shape (reference)
│   ├── migrations/0001_init.sql
│   └── seed.sql                # optional founding queen
│
├── src/
│   ├── shared/                 # types + constants imported by BOTH web and worker
│   │   ├── protocol.ts         # WS message shapes + REST DTOs — the wire contract
│   │   ├── constants.ts        # TICK_MS, GRID_W/H, lifespans, allowances, PROTOCOL_VERSION
│   │   ├── enums.ts            # Caste, Job, TileType, WeatherKind, Season, TimeOfDay, EventKind…
│   │   └── ids.ts              # AntId / LineageId / VisitorId formats + guards
│   │
│   ├── sim/                    # THE engine. No Cloudflare, no DOM, deterministic.
│   │   ├── index.ts            # step(state, inputs, dtTicks) -> { state, events }  + re-exports
│   │   ├── state.ts            # ColonyState + createInitialState + toSnapshot + diff
│   │   ├── rng.ts              # seeded PRNG; the ONLY randomness source
│   │   ├── serialize.ts        # compact encode/decode for DO storage
│   │   ├── params.ts           # every balance constant, separated from logic
│   │   ├── world/
│   │   │   ├── grid.ts         # tile arrays: soil / tunnel / chamber / surface / wall / exit
│   │   │   ├── nest.ts         # chambers + roles: nursery / granary / throne / midden
│   │   │   ├── surface.ts      # above-ground strip, the single exit, resource spawns
│   │   │   ├── resources.ts    # food piles + water pools; decay, evaporation, stores
│   │   │   └── spatial-hash.ts # neighbor lookup so thousands of ants stays O(n)
│   │   ├── pheromones.ts       # trail / alarm / recruit layers: deposit, diffuse, evaporate
│   │   ├── ants/
│   │   │   ├── ant.ts          # the Ant record + factory
│   │   │   ├── senses.ts       # local perception per tick
│   │   │   ├── behavior.ts     # ordered condition->action rule engine
│   │   │   ├── jobs.ts         # per-job actions + age->job assignment (temporal polyethism)
│   │   │   ├── memory.ts       # per-ant learning: food sites, path success, danger spots
│   │   │   ├── lifecycle.ts    # aging, energy, starvation, death, reassignment
│   │   │   └── movement.ts     # step / follow-gradient / collision / speed
│   │   ├── colony/
│   │   │   ├── queen.ts        # laying rate vs food/temp/season; stored sperm; haplodiploidy
│   │   │   ├── brood.ts        # egg->larva->pupa->adult; nurse feeding; temp/humidity
│   │   │   ├── caste.ts        # larva fate: worker vs gyne vs drone (nutrition-driven)
│   │   │   ├── nuptial.ts      # seasonal alates, nuptial flight, drones die after
│   │   │   └── demography.ts   # cached population counts for the HUD
│   │   ├── genetics/
│   │   │   ├── traits.ts       # heritable bounded numbers
│   │   │   ├── inheritance.ts  # queen + stored-sperm genome -> offspring traits + mutation
│   │   │   └── lineage.ts      # parent->child edges, lineage id, extinction marks
│   │   ├── names/
│   │   │   ├── generator.ts    # deterministic name from (lineageId, birthIndex, rng)
│   │   │   └── wordlists.ts    # syllables / given names / surnames
│   │   ├── environment/
│   │   │   ├── clock.ts        # simTime -> TimeOfDay
│   │   │   ├── season.ts       # day-of-year -> Season (drives abundance + queen)
│   │   │   ├── weather.ts      # seeded Markov weather + forecast
│   │   │   ├── temperature.ts  # base(season, timeOfDay) ± weather ± depth
│   │   │   └── hazards.ts      # predator / flooding / cold snap / disease — visitor-proof
│   │   ├── foraging.ts         # exit trips: travel, pickup, return, death roll
│   │   ├── inputs.ts           # apply the ONLY allowed visitor actions (food, water)
│   │   └── events.ts           # Birth / Death / LineageExtinct / QueenDied / …
│   │
│   ├── worker/                 # the deployed backend (runs in the same Worker)
│   │   ├── index.ts            # fetch + scheduled handlers; DO resolution; asset passthrough
│   │   ├── router.ts           # tiny path router + JSON/CORS helpers + visitor-id header
│   │   ├── colony-do.ts        # THE Durable Object: constructor / fetch / alarm / ws handlers
│   │   ├── loop.ts             # ticksToRun(now, lastTick) capped by MAX_CATCHUP_TICKS
│   │   ├── broadcast.ts        # snapshot-on-join, diffs after, throttle, drop slow clients
│   │   ├── connections.ts      # socket registry on the Hibernation API
│   │   ├── inputs.ts           # validate + rate-limit + clamp visitor actions, queue for next tick
│   │   ├── persistence.ts      # DO storage: save/load snapshot + seq + lastTick
│   │   ├── lineage-sink.ts     # batched, best-effort export of events -> D1
│   │   ├── cron.ts             # scheduled(): ping DO, nightly D1/KV housekeeping
│   │   └── api/
│   │       ├── ants.ts         # GET /ants (living list), GET /ants/:id (detail)
│   │       ├── pins.ts         # GET / POST / DELETE /pins  (keyed by X-Visitor-Id)
│   │       ├── actions.ts      # POST /actions/food | /actions/water -> DO
│   │       ├── lineage.ts      # GET /lineage/:id (tree), GET /lineage (roll of the dead)
│   │       └── stats.ts        # GET /stats (population, weather, water level) for the HUD
│   │
│   ├── web/                    # the browser client (built by Vite)
│   │   ├── main.ts             # bootstrap: visitor id -> store -> socket -> render -> UI
│   │   ├── config.ts           # API base, reconnect backoff, target FPS
│   │   ├── net/
│   │   │   ├── socket.ts       # WS to /stream: reconnect, resync, dispatch into store
│   │   │   ├── api.ts          # REST fetch wrappers (+ X-Visitor-Id)
│   │   │   └── visitor-id.ts   # anonymous UUID in localStorage — no accounts
│   │   ├── state/
│   │   │   ├── store.ts        # client mirror of the snapshot + diff reducers
│   │   │   ├── selectors.ts    # derive visible ants, pinned ants, HUD values
│   │   │   └── interpolate.ts  # smooth ant motion between server ticks
│   │   ├── render/
│   │   │   ├── engine.ts       # rAF loop, camera, layer compositing
│   │   │   ├── nest-view.ts    # side-cutaway of tunnels + chambers + brood
│   │   │   ├── surface-view.ts # exit, foragers, dropped food/water, predator
│   │   │   ├── ants.ts         # draw ants by caste/job, carry state, death fade, pin ring
│   │   │   ├── pheromone-layer.ts # optional heat-map toggle
│   │   │   ├── weather-fx.ts   # rain / snow / puddles / heat shimmer
│   │   │   ├── daynight.ts     # color grade by TimeOfDay
│   │   │   ├── season-fx.ts    # palette + surface dressing by Season
│   │   │   └── sprites/atlas.ts # sprite-sheet loader + atlas coords
│   │   ├── ui/
│   │   │   ├── toolbar.ts      # Add food / Add water / Inspect tools
│   │   │   ├── water-meter.ts  # tracked water level + this visitor's daily allowance
│   │   │   ├── ant-list.ts     # scrollable list of living ants
│   │   │   ├── ant-card.ts     # selected ant stats + lineage crumb + PIN button
│   │   │   ├── pinned-tray.ts  # this visitor's pinned ants; drives the highlight ring
│   │   │   ├── family-tree.ts  # lineage graph for an ant / a dynasty
│   │   │   ├── memorial.ts     # roll of the dead — extinct lineages, notable ants
│   │   │   └── weather-hud.ts  # season, time, temperature, weather + forecast
│   │   └── lib/
│   │       ├── dom.ts          # tiny helpers
│   │       └── format.ts       # ageTicks -> "3 days", etc.
│   │
│   ├── main.ts                 # existing template entry — re-point at src/web/main.ts
│   └── vite-env.d.ts
│
└── test/
    ├── sim/{determinism,population,learning,balance}.test.ts
    └── worker/{do,inputs}.test.ts
```

---

## 3. How the pieces connect (data flow)

### A visitor arrives

1. Browser loads the static bundle (Worker static assets, `/ant-farm/`).
2. `net/visitor-id.ts` reads or mints an anonymous UUID in `localStorage`.
3. `net/socket.ts` opens `wss://…/ant-farm/api/stream`. `src/worker/index.ts`
   resolves the fixed Durable Object (`idFromName("global-colony")`) and forwards
   the upgrade to `ColonyDO.fetch()`.
4. `ColonyDO` accepts the socket with the **Hibernation API**, sends `Hello` +
   a full `Snapshot`, and registers the connection (`connections.ts`).

### The loop (persistence without an always-on server)

5. `ColonyDO` keeps `ColonyState` in memory and has an `alarm()` set for
   `now + TICK_MS`.
6. `alarm()` fires → `loop.ts` computes how many sim steps to run for the real
   elapsed time (capped by `MAX_CATCHUP_TICKS`) → calls `src/sim` `step()` for
   each → collects events.
7. `broadcast.ts` builds a `Diff` from the previous snapshot and sends it to every
   live socket.
8. `persistence.ts` writes the snapshot to DO storage every N ticks;
   `lineage-sink.ts` flushes `Birth` / `Death` / name / extinction events to D1.
9. `alarm()` schedules the next alarm → the loop runs forever with **zero
   always-on compute between ticks**.
10. If Cloudflare evicts the object, the next request (or the Cron Trigger, every
    minute) reconstructs it from DO storage and re-arms the alarm. The sim
    **replays elapsed wall-clock time** on wake (that is why `step()` must be
    deterministic), so no tick is truly lost.

### A visitor acts

11. Toolbar → `net/api.ts` POSTs `/ant-farm/api/actions/food` with the
    `X-Visitor-Id` header.
12. Worker forwards to `ColonyDO.fetch()` → `worker/inputs.ts` validates,
    rate-limits per visitor and globally, clamps the amount, and queues it.
13. The next `alarm()` applies queued inputs **before** stepping (via
    `sim/inputs.ts`), so the shared state stays consistent.
14. The effect appears in the next `Diff` to everyone.

### Pins and browsing (kept off the DO's hot path)

15. `/api/pins`, `/api/ants`, `/api/lineage`, `/api/stats` read/write **D1**
    (and optionally **KV** cache) directly from the Worker. Pins are rows keyed
    by `visitor_id`. The client highlights pinned ants that are still alive by
    cross-referencing the live snapshot.

### Server-only changes

16. `sim/environment/*` and `sim/environment/hazards.ts` run purely inside
    `step()`. No API path lets a visitor set weather, season, temperature, or
    spawn/remove predators — enforced by not exposing endpoints and by
    `sim/inputs.ts` accepting only `food` / `water`.

---

## 4. Cloudflare — exactly what you use (all free tier)

| Piece | Cloudflare product | Role | Free-tier notes (verify current numbers — they change) |
| --- | --- | --- | --- |
| `src/web` build | **Workers static assets** (already configured in `wrangler.jsonc`) | Host the SPA at `kweinstock.dev/ant-farm/` | Free; served from the same Worker, no separate Pages project needed |
| `src/worker` | **Workers** | API routing, input validation, read endpoints, DO resolution | ~100k requests/day; small CPU budget per request — keep heavy work in the `alarm()` |
| `ColonyDO` | **Durable Objects** (SQLite-backed class) | The single authoritative colony: in-memory state, `alarm()` tick loop, WebSocket hibernation, transactional storage | SQLite-backed DOs are on the **free** Workers plan; the older key-value-only DO classes are **not**. Use `new_sqlite_classes` in the migration. |
| live updates | **WebSockets via DO Hibernation API** | Push `Snapshot` / `Diff` to viewers | Idle hibernating sockets don't bill duration; inbound connections/messages count toward request limits; server→client broadcasts are cheap |
| `db/` | **D1** | Family trees, ant names, lineage history, pins, event log, memorial | Free: multi-GB storage, millions of row reads/day, ~100k row writes/day — **batch** the lineage writes |
| `CACHE` (optional) | **Workers KV** | Cached "living ants" page, most-pinned leaderboard, latest public snapshot | Free: ~100k reads/day, ~1k writes/day — write once per minute, never per tick |
| keepalive + housekeeping | **Cron Triggers** | Ping the DO so the alarm survives eviction; nightly D1 compaction / KV refresh | Free; minimum interval 1 minute |

**Request-budget math to design around.** An `alarm()` every 2s is ~43k
invocations/day just for ticks; every 5s is ~17k/day; every 10s is ~8.6k/day.
Pick `TICK_MS` (in `src/shared/constants.ts`) so `ticks + expected visitor
traffic + cron` stay under the ~100k/day Workers cap, and treat the Cron Trigger
as a safety net rather than the primary clock. If it gets popular, the Workers
Paid plan (~$5/mo) raises every limit and gives the alarm a much larger CPU
budget — no architecture change required.

What you do **not** need: a VPS, a container, a separate Node server, Pages
Functions, Queues, R2, or Durable Object "colocation" tricks. One Worker + one
Durable Object + D1 + Cron is the whole backend.

See `docs/cloudflare-setup.md` for the step-by-step.

---

## 5. Storage split (also in `docs/data-model.md`)

| Store | Holds | Access pattern | Why here |
| --- | --- | --- | --- |
| **DO storage** (SQLite in the Durable Object) | the live `ColonyState` snapshot, `lastTick`, `seq` | single-writer, transactional, read once on wake | fast, consistent, no cross-request contention |
| **D1** | `ant`, `lineage`, `lineage_edge`, `pin`, `event_log`, `visitor_action` | many readers (lists, trees, memorial), batched writes | relational queries + cross-visitor data the sim doesn't need in memory |
| **KV** (optional) | cached living-ants page, most-pinned leaderboard, public snapshot mirror | high-read, tolerates ~60s staleness | shields D1 and the DO from browse traffic |

Rule of thumb: **DO storage = the simulation. D1 = its history. KV = cheap stale
reads.**

---

## 6. Language choice — all TypeScript

This project is TypeScript end to end: `src/sim`, `src/worker`, and `src/web`.
There is no second language, and that is the deliberate choice, not a default.

**Why not split the sim into Rust/WASM:**

- The genuinely hard code is the Durable Object lifecycle, `alarm()` scheduling,
  WebSocket hibernation, D1 batching, and hibernation-replay — all TS-first APIs.
  A language boundary through the middle of that is friction with no early payoff.
- `src/shared/protocol.ts` is imported directly by the sim, the worker, and the
  browser. A WASM core would mean serializing across the JS↔WASM boundary every
  tick and maintaining the `ColonyState` layout twice.
- Early development is mostly balance-tuning (laying rates, pheromone decay,
  forage risk). Edit-save-watch beats a `wasm-pack` recompile per change.
- Free-tier limits (100k requests/day, snapshot bandwidth) bite well before
  simulation CPU does.

**The one workload that would favor WASM** is pheromone diffusion — grid math
that runs every tick regardless of ant count. Mitigations, all in TS:

- `Float32Array` for the grid + pheromone layers (same memory layout a Rust port
  would use; V8 optimizes these loops well).
- Run diffusion every N ticks, not every tick (`src/sim/params.ts`).
- Cap population; start with hundreds, not thousands.

**If that wall is ever hit:** `src/sim` is already a pure module with a single
entry point — `step(state, inputs, dtTicks) -> { state, events }`. Porting just
that function to Rust→WASM later (via `wasm-pack`, imported into
`src/worker/colony-do.ts`) is a scoped task, not a rewrite. Cloudflare Workers
run WASM natively, so the door stays open. Until profiling says otherwise, don't.

**Determinism** (the actual constraint, and language-independent): one seeded RNG
carried in the state, fixed iteration order over ants, integer / fixed-point math
where practical. That is what makes `test/sim/determinism.test.ts` pass and lets
the DO replay elapsed time after waking from hibernation.

---

## 7. Open questions to settle before coding

- `TICK_MS` and the daily request budget — pick a number, then size everything else.
- Grid resolution and max population target (drives memory + snapshot size + CPU/tick).
- Snapshot/diff encoding: JSON to start (simple), binary later (bandwidth).
- Whether new queens leaving on nuptial flights are just "emigration + a note" or
  eventually seed sibling colonies (out of scope for v1).
- How aggressively to cache browse endpoints in KV vs hitting D1.
