# Build roadmap

Incremental plan. Each phase ends with something you can **run and test**. The
file tree in `architecture.md` is a reference map — create real files only as a
phase needs them, and ignore (or delete) stubs you haven't reached.

Cloudflare is not involved until **Phase 6**. Everything up to and including
Phase 5 (Phases 3a–3c included) runs with `npm test` and `npm run dev` alone.

> **3a–3c were inserted after Phase 3 was built.** They turn the flat top-down
> board into a real ant farm: a side-on cutaway nest with rooms, a separate
> top-down surface for foraging, and corpse handling. Phase numbers 4+ are
> unchanged so existing code comments that reference them still line up.

---

## Phase 0 — tooling (half a day)

- Add a test runner: `vitest` (dev dependency), `npm test` script.
- Add `src/sim` and `src/shared` to `tsconfig` paths if you want `@sim` / `@shared` aliases.
- Nothing else changes.

**Test:** `npm test` runs an empty suite green.

---

## Phase 1 — sim core, one ant, no server, no browser

Build the smallest real simulation:

- `src/sim/rng.ts` — seeded PRNG.
- `src/sim/state.ts` — `ColonyState` with just: seq, simTime, rngSeed, a small
  grid, one ant `{id, pos, energy, ageTicks, lifespanTicks}`. `createInitialState(seed)`.
- `src/sim/index.ts` — `step()` that does: age the ant, burn energy, wander one
  tile, kill it at lifespan or zero energy. Returns `{state, events}`.
- `src/sim/world/grid.ts` — tile array + helpers.

**Test (`test/sim/`):**
- `determinism.test.ts` — same seed + N steps → identical state; 1 call of N
  steps == N calls of 1 step.
- a basic "ant dies within its lifespan range" test.

**Run it:** a throwaway script that steps 500 times and prints an ASCII grid each
frame to the console. You now have a living dot.

---

## Phase 2 — see it in the browser (still no server)

Wire the client straight to the sim — no network, no Durable Object:

- `src/web/main.ts` — create state, start a `requestAnimationFrame` loop that
  calls `step()` on a timer and draws the grid + ant to a `<canvas>`.
- `src/web/render/engine.ts` + `render/grid` + `render/ants.ts` — minimal canvas draw.
- Point `index.html` at `src/web/main.ts`.

Keep this "local mode" permanently as a dev switch (`config.ts`:
`SOURCE = "local" | "stream"`). It's the fastest way to tune behavior later.

**Test:** `npm run dev`, watch the ant wander and die. Visual, not automated —
that's fine at this stage.

---

## Phase 3 — a colony

- `src/sim/ants/ant.ts` (full record: caste, job, name placeholder), `senses.ts`,
  `behavior.ts` (3–4 rules), `jobs.ts`, `lifecycle.ts`, `movement.ts`.
- `src/sim/colony/queen.ts` + `brood.ts` — queen lays, egg→larva→pupa→adult.
- `src/sim/world/resources.ts` + food piles; ants eat to regain energy.
- `src/sim/colony/demography.ts` — population counts.

**Test:**
- `population.test.ts` — with a fixed food supply the colony survives 10k ticks
  without extinction and without unbounded growth.
- rule tests: a hungry ant on food eats; an ant at lifespan dies.

**Run it:** browser shows dozens of ants, brood in a chamber, population climbing.

---

## Phase 3a — the nest: rooms and room-aware movement

Replace Phase 3's flat open board with a **dug-out nest of connected rooms**.
Still one top-down view (the side-on / two-screen split is 3b) — this phase is
only about structure and getting ants to navigate it on purpose instead of by
random walk.

- `src/sim/world/grid.ts` — real tile types: `SOIL` (undug), `TUNNEL`,
  `CHAMBER`, `WALL`, `EXIT`. `isPassable` = tunnel / chamber / exit.
- `src/sim/world/nest.ts` — the chamber system:
  - `ChamberRole`: `QUEEN`, `NURSERY`, `FOOD_STORE`, `COMMONS` (the "room to
    move around in" / crossroads), and the `EXIT` shaft.
  - Each chamber = a group of `CHAMBER` tiles tagged with a role, joined by
    `TUNNEL` runs.
  - `createStarterNest()` — digs one fixed layout: queen chamber deep, nursery
    next to it, food store + commons off a central tunnel, a shaft up to the
    exit.
  - Queries: `chamberAt(pos)`, `tilesOf(role)`, `nearestTileOf(role, pos)`, and
    a chamber-to-chamber adjacency graph for pathing.
- `src/sim/ants/movement.ts` — extend from pure wander to **goal-directed**:
  build a BFS distance field over passable tiles from a target chamber (cache
  one per role; the nest is static for now), and each tick step to the
  lowest-distance neighbour, with a little noise so ants don't form a rigid
  conga line. Wander stays as the no-goal fallback.
- `src/sim/ants/behavior.ts` / `jobs.ts` — every job now resolves to a
  **destination chamber**: queen stays in `QUEEN`; nurse ferries eggs from
  `QUEEN` to `NURSERY`; forager heads for `EXIT`; a hungry ant heads for
  `FOOD_STORE`; idle ants mill in `COMMONS`.
- `src/sim/colony/brood.ts` — eggs are laid in the `QUEEN` chamber and do **not
  progress until a nurse has physically carried each one to the `NURSERY`**.
  - **A nurse can hold/tend at most 3 eggs at once.**
  - **A nursery tile holds at most 3 eggs** — a nurse carrying an egg looks for
    a tile with a free slot.
- `src/sim/state.ts` — `createInitialState` calls `createStarterNest`; starter
  ants spawn in `COMMONS`; brood is carried, never teleported.
- The `MAX_BROOD` cap from Phase 3 can now come out — nursery-tile capacity plus
  the 3-per-nurse limit are the real ceiling.

**Test (`test/sim/`):**
- `nest.test.ts` — the starter nest is fully connected (every chamber reachable
  from every other over passable tiles); every role's distance field covers all
  passable tiles (no unreachable pockets).
- an egg laid in the queen chamber reaches the nursery within N ticks, and no
  nursery tile ever holds more than 3 eggs, and no nurse tends more than 3.
- determinism still holds (`step(state, N)` == N × `step(state, 1)`).

**Run it:** top-down still, but now you see rooms — the queen in her chamber, a
nursery filling with eggs, ants threading the tunnels between rooms to reach
their jobs.

---

## Phase 3b — two views: the farm (side-on) and the surface (top-down)

Split into **two coordinate spaces and two renders**: the nest is a vertical
cross-section (like looking at an ant farm between glass); the surface is a
separate top-down plane. The exit shaft's top tile is the seam between them.

- `src/sim/state.ts` — every mobile thing (ant, later corpse, carried food) gets
  a `location: { where: "nest" | "surface"; pos }`. Nest `pos` is
  `(x across, y = depth)`; surface `pos` is top-down `(x, y)`.
- `src/sim/world/surface.ts` — the top-down surface: the exit hole at a fixed
  point, an open area where **food piles spawn at random positions over time**
  (this replaces Phase 3's fixed piles), and an empty patch reserved just
  outside the hole for the graveyard (filled in 3c).
- `src/sim/index.ts` — tick order gains a **surface pass** after the nest pass:
  ants standing on the surface move / search in surface coords; an ant that
  reaches the exit tile flips `location.where` and is placed at the matching
  tile in the other space.
- `src/sim/foraging.ts` — the minimal round trip (no trails yet, that's Phase
  4): forager walks to the exit → onto the surface → wanders to the nearest
  food pile → picks up a load → walks back through the exit → **delivers to the
  `FOOD_STORE` chamber (or straight to the queen)**, then repeats.
- `src/web/render/nest-view.ts` — the cutaway: chambers as excavated pockets in
  a soil fill, tunnels as thin channels, the exit shaft rising to a surface line
  at the top; ants / eggs / stored food drawn inside their rooms.
- `src/web/render/surface-view.ts` — top-down: the hole, foragers walking the
  ground, the randomly-spawned food piles.
- `src/web/render/engine.ts` — drive both canvases.
- `src/web/ui/view-switch.ts` — side-by-side (or stacked) by default so you see
  the ant leave one and appear in the other; a toggle for narrow screens.
  `config.ts` gets the default layout.
- `src/web/render/grid.ts` + `render/resources.ts` — retired / folded into the
  two new views.

**Test:**
- an ant told to forage walks to the exit, its `location.where` flips to
  `"surface"`, it reaches a pile, flips back to `"nest"` on return, and the
  `FOOD_STORE` total goes up.
- determinism holds across the transition.
- food piles keep spawning on the surface and are consumed — the surface never
  runs permanently empty or fills without bound.

**Run it:** two panels — the cutaway colony and the foraging ground — with an ant
visibly leaving the nest through the hole and popping up top-side.

---

## Phase 3c — corpses and the undertaker

- `src/sim/corpses.ts` (new) — a dead ant no longer just disappears. It becomes
  a **corpse** at its death spot: `{ id, location, ageTicks }`. Corpses are
  **small — 2 per tile** — and decay away after a long time even if never moved,
  so a stalled colony can't leak memory.
- `src/sim/world/surface.ts` — the **graveyard** zone just outside the hole
  accumulates hauled-out corpses into a visible, growing pile.
- `src/sim/corpses.ts` — undertaker assignment, recomputed every tick:
  - **It is a dynamic job, not an age band.** No corpses → zero undertakers.
  - `desiredUndertakers ≈ round(corpseCount × UNDERTAKER_PER_CORPSE)`, clamped to
    a fraction of the workforce so the colony never drops everything to bury the
    dead.
  - **Proximity-weighted pick:** among available workers, the ones whose nearest
    corpse is closest are the ones tasked — an ant next to a body is far more
    likely to be assigned it than one across the nest.
- `src/sim/ants/jobs.ts` — the `UNDERTAKER` job: pick up the nearest corpse,
  carry it to the `EXIT`, out onto the surface, drop it in the graveyard, then
  revert to the job it had before.
- `src/sim/ants/lifecycle.ts` — on death, emit the corpse instead of only a
  `Death` event.
- `src/web/render/*` — corpses drawn small and grey in whichever view they're
  in; the graveyard pile on the surface view.

**Test:**
- kill several ants in a chamber → within N ticks every corpse is in the
  graveyard, and the count of ants that took `UNDERTAKER` was roughly
  `corpseCount × UNDERTAKER_PER_CORPSE`.
- zero corpses → zero undertakers, every tick.
- across many seeds, an ant adjacent to a corpse is assigned it noticeably more
  often than a distant ant (statistical check).
- corpses that are never reached still decay and disappear eventually.

**Run it:** trigger a die-off — bodies get carried out through the hole and
stacked in the graveyard, and the colony visibly puts more workers on corpse
duty when the pile is bigger.

---

## Phase 4 — pheromones + foraging

The surface, the exit transition, random food spawns, and basic delivery already
exist from 3b. This phase adds the **intelligence and feedback loops** on top.

- `src/sim/pheromones.ts` — trail layer (on the surface, optionally in tunnels):
  deposit on the way *back* carrying food, follow the gradient on the way *out*,
  evaporate over time.
- `src/sim/foraging.ts` — upgrade the 3b round trip: bias the outbound search
  toward trails and remembered sites instead of pure wander; add the on-surface
  death roll (raised later by weather / predators in Phase 5).
- `src/sim/ants/memory.ts` — remembered food-pile locations, per-route success.
- `src/web/render/pheromone-layer.ts` — heat-map toggle on the surface view.

**Test:**
- trail forms toward a surface food pile and decays after it's exhausted (assert
  pheromone totals over time).
- `learning.test.ts` — deaths per forage trip trend down over generations.

**Run it:** trails forming and collapsing on the foraging ground; the food store
filling faster as recruitment kicks in.

---

## Phase 5 — environment

- `src/sim/environment/` — `clock.ts` (day/night), `season.ts`, `weather.ts`
  (seeded Markov), `temperature.ts`, `hazards.ts` (predator at the exit first;
  add flooding/cold/disease later).
- `src/web/render/` — `daynight.ts`, `weather-fx.ts`, `season-fx.ts`.

**Test:**
- `balance.test.ts` — glut / drought / harsh winter / constant predator don't
  NaN or hard-crash the sim; population recovers or declines gracefully.
- weather transitions are deterministic for a fixed seed.

**Run it:** browser cycles through day/night and seasons with visual changes.

At the end of Phase 5 you have the **entire simulation**, fully tested, running
locally in the browser. No Cloudflare yet. This is the natural place to spend
time tuning `src/sim/params.ts`.

---

## Phase 6 — move the loop server-side (first Cloudflare step)

- `wrangler.jsonc` — add `main`, the `COLONY` Durable Object binding, and the
  `v1` migration (`new_sqlite_classes`). No D1 yet.
- `src/worker/index.ts` — fetch handler: serve assets, route `/ant-farm/api/stream`
  to the DO.
- `src/worker/colony-do.ts` — hold `ColonyState` in memory, `alarm()` runs
  `step()` on `TICK_MS` and reschedules, accept a WebSocket (Hibernation API),
  send a full snapshot then diffs.
- `src/worker/broadcast.ts`, `connections.ts` — minimal.
- `src/shared/protocol.ts` — `Hello`, `Snapshot`, `Diff`.
- `src/web` — implement `net/socket.ts`; flip `config.ts` `SOURCE` to `"stream"`.

**Test:**
- `test/worker/do.test.ts` under `vitest` + `@cloudflare/vitest-pool-workers`
  (or miniflare): `alarm()` advances the sim and reschedules; a connected socket
  receives `Hello` + `Snapshot` then `Diff`s.
- `npx wrangler dev` — open the browser, see the same colony you had locally, now
  driven by the Worker. Open two tabs → both show identical state.

---

## Phase 7 — persistence + hibernation replay

- `src/sim/serialize.ts` — encode/decode state.
- `src/worker/persistence.ts` — save every N ticks, load in the constructor.
- `src/worker/loop.ts` — `ticksToRun(now, lastTick)` capped by `MAX_CATCHUP_TICKS`.

**Test:** DO test that simulates eviction (drop the instance, recreate) and
asserts the colony resumes from storage and replays the missed ticks. Leave
`wrangler dev` running, stop it, restart — colony continues, not resets.

---

## Phase 8 — visitor actions

- `src/sim/inputs.ts` — apply food/water.
- `src/worker/inputs.ts` — validate, clamp, per-visitor daily allowance, global
  rate limit, queue for next tick.
- `src/worker/api/actions.ts`, `src/web/net/visitor-id.ts`, `src/web/ui/toolbar.ts`,
  `water-meter.ts`.

**Test:** `test/worker/inputs.test.ts` — rejects bad kinds/positions/amounts,
enforces allowance + rate limit. In the browser: drop food, watch foragers find it.

---

## Phase 9 — D1: names, lineage, pins, browsing

- `db/schema.sql` + `migrations/0001_init.sql`; `wrangler d1 create`, wire the
  `DB` binding.
- `src/sim/names/`, `src/sim/genetics/` (traits, inheritance, lineage).
- `src/worker/lineage-sink.ts` — batch Birth/Death/Extinct → D1.
- `src/worker/api/ants.ts`, `pins.ts`, `lineage.ts`, `stats.ts`.
- `src/web/ui/ant-list.ts`, `ant-card.ts`, `pinned-tray.ts`, `family-tree.ts`,
  `memorial.ts`, `weather-hud.ts`.

**Test:** integration test — run the sim a while, assert `ant` / `lineage_edge`
rows appear; `/api/ants` returns only the living; pin/unpin round-trips.

---

## Phase 10 — cron, KV cache, deploy

- `src/worker/cron.ts` + `triggers.crons` — DO keepalive + nightly housekeeping.
- Optional `CACHE` KV namespace for the living-ants page and pin leaderboard.
- `wrangler deploy --env testing` → `testing.kweinstock.dev/ant-farm/`.
- Add the entry to `../landing-page/public/projects.json`.

**Test:** watch it run on the testing subdomain for a day. Then `wrangler deploy`
to production.

---

## Rules of thumb

- Don't build a module before the phase that needs it, even though the stub exists.
- Every phase must leave `npm test` green and `npm run dev` (or `wrangler dev`)
  showing something.
- Keep "local mode" in the web client forever — it's your tuning workbench.
- Tune `params.ts` at the end of Phase 5, not before.
