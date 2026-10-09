# Global Ant Farm — Architecture

Paper design only. No implementation yet — every file under `src/` and `test/`
is a comment-only stub describing what goes there and how it connects.

---

## 1. Mental model

There is **one global colony**. It is authoritative, lives server-side, and ticks
forward even when nobody is watching ("persistent"). Visitors are thin clients
that:

- **watch** a live stream of colony state,
- **nudge** it in one allowed way (place a 2x2 patch of food),
- **inspect** an ant (click it: name, job, age, time left) and **pin** ants they
  want to come back to (client-only; a pin follows an ant's heir when it dies).

Everything else — weather, day/night, seasons, temperature, predators, flooding,
disease, death rolls — is **server-driven and visitors cannot touch it**. That
boundary is enforced structurally: there is simply no API endpoint and no
`VisitorInput` variant for those things (`src/sim/inputs.ts` accepts only
`food`).

The three hard problems are (a) a single shared mutable simulation, (b) a loop
that runs without an always-on server, (c) real-time fan-out to many viewers. On
Cloudflare's free tier, one primitive solves all three: a **Durable Object** with
an `alarm()`.

```
                 ┌─────────────────────────────────────────────┐
   Browser ──────┤ Cloudflare Worker static assets  (src/web)   │
   (viewer)      │  served at kweinstock.dev/ant-farm/          │
                 └─────────────────────────────────────────────┘
       │  REST  /ant-farm/api/actions   (place food; Phase 16)
       │  WS    /ant-farm/api/stream   (Hello + Snapshot + Diffs)
       ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Worker  (src/worker/index.ts)                              │
   │  - routes requests, CORS, serves the built SPA             │
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
   └───────────────────────────────────────────────────────────┘
       │
       ▼
   DO storage (SQLite)
   authoritative live snapshot
   for crash / eviction recovery
```

There is no database, cache or cron: the Durable Object's storage and its own
alarms are the whole backend.

---

## 2. Folder structure

Single npm package (matches the existing repo — not a monorepo). The simulation
is a **pure, platform-free module** (`src/sim`) so it can be unit-tested in
isolation — and, if it ever outgrows JS, ported behind the same `step()`
signature without touching the Worker (see section 6).

```
ant-farm/
├── index.html                  # SPA shell (loads the web bootstrap)
├── package.json                # + scripts: test, deploy
├── wrangler.jsonc              # main, durable_objects, migrations, routes (+ env.testing)
├── vite.config.ts              # builds src/web -> dist/ (base /ant-farm/)
│
├── docs/
│   ├── architecture.md         # this file
│   ├── cloudflare-setup.md     # accounts, bindings, deploy, free-tier limits + math
│   ├── simulation-model.md     # tick order, the rule list, emergent behaviors to watch
│   ├── ant-biology.md          # the real-ant facts the model honors
│   └── data-model.md           # what lives in DO storage vs the browser, and why
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
│   │   │   ├── grid.ts         # NEST tiles, a vertical cross-section: soil / tunnel / chamber / wall / exit
│   │   │   ├── nest.ts         # chambers + roles: QUEEN / NURSERY / FOOD_STORE / COMMONS / EXIT; tunnel graph; BFS distance fields
│   │   │   ├── surface.ts      # top-down surface: exit hole, random food-pile spawns, graveyard zone
│   │   │   ├── resources.ts    # food piles (surface) + FOOD_STORE totals; spawn, decay, pickup
│   │   │   └── spatial-hash.ts # neighbor lookup so thousands of ants stays O(n)
│   │   ├── corpses.ts          # corpse entities (2/tile, decay) + undertaker assignment (proportional + proximity)
│   │   ├── pheromones.ts       # trail / alarm / recruit layers: deposit, diffuse, evaporate
│   │   ├── ants/
│   │   │   ├── ant.ts          # the Ant record + factory
│   │   │   ├── senses.ts       # local perception per tick
│   │   │   ├── behavior.ts     # ordered condition->action rule engine
│   │   │   ├── jobs.ts         # per-job actions + age->job assignment (temporal polyethism)
│   │   │   ├── memory.ts       # per-ant learning: food sites, path success, danger spots
│   │   │   ├── lifecycle.ts    # aging, energy, starvation, death (spawns a corpse), reassignment
│   │   │   └── movement.ts     # goal = a chamber; BFS distance-field descent; wander is the fallback
│   │   ├── colony/
│   │   │   ├── queen.ts        # laying rate vs food/temp/season; stored sperm; haplodiploidy
│   │   │   ├── brood.ts        # egg->larva->pupa->adult; nurse feeding; temp/humidity
│   │   │   ├── caste.ts        # larva fate: worker vs gyne vs drone (nutrition-driven)
│   │   │   ├── nuptial.ts      # seasonal alates, nuptial flight, drones die after
│   │   │   └── demography.ts   # cached population counts for the HUD
│   │   ├── names/
│   │   │   ├── generator.ts    # given name = hash of the ant id (never the RNG); surname queue + heirs
│   │   │   └── wordlists.ts    # given names / surnames
│   │   ├── environment/
│   │   │   ├── clock.ts        # simTime -> TimeOfDay
│   │   │   ├── season.ts       # day-of-year -> Season (drives abundance + queen)
│   │   │   ├── weather.ts      # seeded Markov weather + forecast
│   │   │   ├── temperature.ts  # base(season, timeOfDay) ± weather ± depth
│   │   │   └── hazards.ts      # predator / flooding / cold snap / disease — visitor-proof
│   │   ├── foraging.ts         # cross-view trip: exit -> surface search -> pickup -> return -> deliver to FOOD_STORE/queen
│   │   ├── inputs.ts           # apply the ONLY allowed visitor action (food)
│   │   └── events.ts           # Birth / Death / CorpseInterred / QueenDied / …
│   │
│   ├── worker/                 # the deployed backend (runs in the same Worker)
│   │   ├── index.ts            # fetch handler; DO resolution; asset passthrough
│   │   ├── router.ts           # tiny path router + JSON/CORS helpers + visitor-id header
│   │   ├── colony-do.ts        # THE Durable Object: constructor / fetch / alarm / ws handlers
│   │   ├── loop.ts             # ticksToRun(now, lastTick) capped by MAX_CATCHUP_TICKS
│   │   ├── broadcast.ts        # snapshot-on-join, diffs after, throttle, drop slow clients
│   │   ├── connections.ts      # socket registry on the Hibernation API
│   │   ├── inputs.ts           # validate + rate-limit + clamp visitor actions, queue for next tick
│   │   ├── persistence.ts      # DO storage: save/load snapshot + seq + lastTick
│   │   └── api/
│   │       └── actions.ts      # POST /actions/food -> DO
│   │
│   ├── web/                    # the browser client (built by Vite)
│   │   ├── main.ts             # bootstrap: visitor id -> store -> socket -> render -> UI
│   │   ├── config.ts           # API base, reconnect backoff, target FPS
│   │   ├── net/
│   │   │   ├── socket.ts       # WS to /stream: reconnect, resync, dispatch into store
│   │   │   └── visitor-id.ts   # anonymous UUID in localStorage — no accounts
│   │   ├── state/
│   │   │   ├── store.ts        # client mirror of the snapshot + diff reducers
│   │   │   ├── selectors.ts    # derive visible ants, pinned ants, HUD values
│   │   │   └── interpolate.ts  # smooth ant motion between server ticks
│   │   ├── render/
│   │   │   ├── engine.ts       # rAF loop; drives BOTH canvases (nest + surface)
│   │   │   ├── nest-view.ts    # the "ant farm between glass" side cutaway: chambers, tunnels, brood, stored food
│   │   │   ├── surface-view.ts # top-down: exit hole, foragers, spawned food piles, graveyard pile
│   │   │   ├── ants.ts         # draw ants by caste/job, carry state (egg/food/corpse), death fade, pin ring
│   │   │   ├── pheromone-layer.ts # optional heat-map toggle (surface)
│   │   │   ├── weather-fx.ts   # rain / snow / puddles / heat shimmer
│   │   │   ├── daynight.ts     # color grade by TimeOfDay
│   │   │   ├── season-fx.ts    # palette + surface dressing by Season
│   │   │   └── sprites/atlas.ts # sprite-sheet loader + atlas coords
│   │   ├── ui/
│   │   │   ├── view-switch.ts  # farm view + surface view side-by-side / stacked; toggle on narrow screens
│   │   │   ├── toolbar.ts      # place-food tool (Phase 16)
│   │   │   ├── ant-list.ts     # optional list of ants (stub)
│   │   │   ├── ant-card.ts     # clicked ant: name, job, time alive / left; follows its heir
│   │   │   ├── pinned-tray.ts  # this visitor's pinned ants; drives the highlight ring (Phase 16)
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
8. `persistence.ts` writes the snapshot to DO storage every N ticks.
9. `alarm()` schedules the next alarm → the loop runs forever with **zero
   always-on compute between ticks**.
10. If Cloudflare evicts the object, the next request or its own alarm
    reconstructs it from DO storage and re-arms the alarm. The sim
    **replays elapsed wall-clock time** on wake (that is why `step()` must be
    deterministic), so no tick is truly lost.

### A visitor acts

11. Toolbar POSTs `/ant-farm/api/actions/food` (Phase 16) with the
    `X-Visitor-Id` header.
12. Worker forwards to `ColonyDO.fetch()` → `worker/inputs.ts` validates,
    rate-limits per visitor and globally, clamps the amount, and queues it.
13. The next `alarm()` applies queued inputs **before** stepping (via
    `sim/inputs.ts`), so the shared state stays consistent.
14. The effect appears in the next `Diff` to everyone.

### Inspecting and pinning (no server round trip)

15. Clicking an ant opens `ant-card.ts` from the state the client already has.
    Pins are ant ids in `localStorage`; when a pinned ant dies the pin moves to
    its heir (`state.heirs`). Nothing here costs a request.

### Server-only changes

16. `sim/environment/*` and `sim/environment/hazards.ts` run purely inside
    `step()`. No API path lets a visitor set weather, season, temperature, or
    spawn/remove predators — enforced by not exposing endpoints and by
    `sim/inputs.ts` accepting only `food`.

---

## 4. Cloudflare — exactly what you use (all free tier)

| Piece | Cloudflare product | Role | Free-tier notes (verify current numbers — they change) |
| --- | --- | --- | --- |
| `src/web` build | **Workers static assets** (already configured in `wrangler.jsonc`) | Host the SPA at `kweinstock.dev/ant-farm/` | Free; served from the same Worker, no separate Pages project needed |
| `src/worker` | **Workers** | API routing, input validation, read endpoints, DO resolution | ~100k requests/day; small CPU budget per request — keep heavy work in the `alarm()` |
| `ColonyDO` | **Durable Objects** (SQLite-backed class) | The single authoritative colony: in-memory state, `alarm()` tick loop, WebSocket hibernation, transactional storage | SQLite-backed DOs are on the **free** Workers plan; the older key-value-only DO classes are **not**. Use `new_sqlite_classes` in the migration. |
| live updates | **WebSockets via DO Hibernation API** | Push `Snapshot` / `Diff` to viewers | Idle hibernating sockets don't bill duration; inbound connections/messages count toward request limits; server→client broadcasts are cheap |
**Request-budget math to design around.** An `alarm()` every 2s is ~43k
invocations/day just for ticks; every 5s is ~17k/day; every 10s is ~8.6k/day.
Pick `TICK_MS` (in `src/shared/constants.ts`) so `ticks + expected visitor
traffic` stay under the ~100k/day Workers cap. If it gets popular, the Workers
Paid plan (~$5/mo) raises every limit and gives the alarm a much larger CPU
budget — no architecture change required.

What you do **not** need: a VPS, a container, a separate Node server, Pages
Functions, Queues, R2, or Durable Object "colocation" tricks. One Worker + one
Durable Object is the whole backend.

See `docs/cloudflare-setup.md` for the step-by-step.

---

## 5. Storage split (also in `docs/data-model.md`)

| Store | Holds | Access pattern | Why here |
| --- | --- | --- | --- |
| **DO storage** (SQLite in the Durable Object) | the live `ColonyState` snapshot, `lastTick`, `seq` | single-writer, transactional, read once on wake | fast, consistent, no cross-request contention |
Rule of thumb: **DO storage = the simulation. localStorage = what a visitor keeps
for themselves.**

---

## 6. Language choice — all TypeScript

This project is TypeScript end to end: `src/sim`, `src/worker`, and `src/web`.
There is no second language, and that is the deliberate choice, not a default.

**Why not split the sim into Rust/WASM:**

- The genuinely hard code is the Durable Object lifecycle, `alarm()` scheduling,
  WebSocket hibernation, and hibernation-replay — all TS-first APIs.
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
