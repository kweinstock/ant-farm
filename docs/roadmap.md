# Build roadmap

Incremental plan. Each phase ends with something you can **run and test**. The
file tree in `architecture.md` is a reference map — create real files only as a
phase needs them, and ignore (or delete) stubs you haven't reached.

Cloudflare is not involved until **Phase 13**. Everything up to and including
Phase 12 (Phases 3a–3c included) runs with `npm test` and `npm run dev` alone.

> **3a–3c were inserted after Phase 3 was built.** They turn the flat top-down
> board into a real ant farm: a side-on cutaway nest with rooms, a separate
> top-down surface for foraging, and corpse handling.

> **Phases 6–12 were inserted after Phase 5 was built** — a bigger world,
> deeper ant and predator behaviour, sleep, colony-level learning, and a full
> visual overhaul, all still local-only. The original Cloudflare phases 6–10
> shifted up to **13–17**. Code comments that reference "Phase 6"–"Phase 10"
> for the Durable Object, streaming, persistence, visitor actions, or D1 mean
> what are now Phases 13–17; they were not mass-edited.

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

At the end of Phase 5 you have a **complete first-pass simulation**, fully
tested, running locally in the browser. Phases 6–12 deepen it — a bigger nest
and surface, richer ant and predator behaviour, sleep, colony-level learning,
and a full visual overhaul — still local-only, still `npm run dev`. Cloudflare
starts at Phase 13. Tune `src/sim/params.ts` here after Phase 5, and again
after Phase 11 once behaviour is settled.

---

## Phase 6 — the bigger nest

Scale the nest up — not a flat 2×; enough room for real structure and, later,
the colony digging more of its own. The layout stops being a fixed set of
single rooms.

- `src/sim/params.ts` — `GRID_WIDTH` / `GRID_HEIGHT` up substantially (a nest
  that holds a few hundred ants without gridlock). One place, everything reads
  from here already.
- `src/sim/world/grid.ts` — tunnels are **2 tiles wide** everywhere; ants pass
  each other instead of deadlocking a 1-wide corridor. `isPassable` unchanged;
  the layout/dig code lays 2-wide runs.
- `src/sim/world/nest.ts` — multi-room layout:
  - **2–3 `NURSERY` chambers**, **2–3 `FOOD_STORE` chambers**, **4–5 `COMMONS`**
    (each bigger than today's), and a **larger `QUEEN` chamber**.
  - The `QUEEN` chamber sits **centrally** and deep, and is **not adjacent to a
    nursery** — nurses walk a real distance from queen to nursery.
  - Same-role chambers are interchangeable targets: nearest instance with a
    free slot wins.
  - Leave a wide margin of undug `SOIL` around the layout — Phase 11's
    excavation needs somewhere to dig.
- `src/sim/ants/movement.ts` — one BFS distance field **per chamber instance**,
  not per role; job resolution picks the nearest instance then routes to it.
- `src/sim/ants/jobs.ts` / `behavior.ts` — "go to `FOOD_STORE`" / "`NURSERY`"
  now means the nearest non-full instance.
- `src/sim/state.ts` — more starter workers to match the bigger nest.
- `src/web/render/nest-view.ts` — draw the multi-chamber cutaway.

**Test:**
- `nest.test.ts` — still fully connected: every chamber instance reachable from
  every other; every role's distance fields cover all passable tiles.
- every tunnel run is ≥ 2 wide (no 1-tile pinch points).
- an egg still reaches *a* nursery within N ticks; per-tile and per-nurse caps
  hold across all nursery instances.
- determinism holds.

**Run it:** a visibly bigger colony — several nurseries and stores, wide
tunnels, the queen isolated in a central chamber, ants spread across many
commons.

---

## Phase 7 — surface ecology

The surface stops being a uniform plane with purely random pile spawns.

- `src/sim/params.ts` — `SURFACE_WIDTH` / `SURFACE_HEIGHT` up to match the
  bigger nest and give foragers real ground to cover.
- `src/sim/world/surface.ts`:
  - **Fertile patches** — a handful of fixed regions where piles spawn far more
    often and larger; the rest of the map spawns them rarely. `spawnFoodPiles`
    rolls a patch first, then a tile within it.
  - **Obstacles** — `ROCK` / `TREE` tiles, impassable, clustered in and around
    the fertile patches (forage where the cover is).
  - The **graveyard moves well away from the hole** — its own region, a real
    walk for undertakers (and a target for Phase 10's predators).
- `src/sim/ants/movement.ts` — surface movement was greedy-Manhattan on an open
  grid; with obstacles it needs a step that doesn't walk into rocks (local
  avoidance or a cached surface distance field to the hole / patches).
- `src/sim/ants/foraging.ts` — outbound search biases toward known fertile
  patches, not just remembered individual piles.
- `src/web/render/surface-view.ts` — draw patches, rocks, trees, the relocated
  graveyard.

**Test:**
- piles spawn overwhelmingly inside fertile patches over a long run; the open
  map stays nearly bare.
- no pile spawns on an obstacle tile; no ant ever occupies one.
- undertakers still reach the relocated graveyard; determinism holds.

**Run it:** foragers converge on green, tree-and-rock-studded patches; the
graveyard is a distinct plot across the field.

---

## Phase 8 — queen life & brood care

- `src/sim/colony/queen.ts` — the queen **gets hungry** (she metabolises now,
  slowly) and signals it when low.
- `src/sim/ants/foraging.ts` / `behavior.ts` — a returning forager with food
  **delivers to a hungry queen before topping up `FOOD_STORE`** (trophallaxis).
  Hungry-queen priority sits above normal store delivery in the decision order.
- `src/sim/colony/queen.ts` / `movement.ts` — the queen **moves**, but only
  within her chamber and at a fraction of a worker's speed (a step every N
  ticks). Lay position follows her.
- `src/sim/colony/brood.ts` — an egg/larva only advances its timer on ticks
  when a **nurse is tending it**, and tending is **intermittent** — a nurse
  services each assigned brood every M ticks, not every tick. Unattended brood
  stalls, and past a longer limit dies.
- `src/sim/ants/jobs.ts` — the `NURSE` job gains a tend-rotation over its
  nursery's eggs, not just ferrying.

**Test:**
- a hungry queen is fed by the next forager back before the store rises.
- the queen's position changes over time but never leaves her chamber.
- too few nurses → brood development measurably slows / stalls; enough → matches
  today's timings.
- determinism holds.

**Run it:** foragers peel off to the centre to feed the queen; an
under-staffed nursery visibly lags.

---

## Phase 9 — sleep

Every ant sleeps. Default target: **~250 short sleeps per day, ~1 minute each**
(sim-scaled) — tune against `DAY_LENGTH_TICKS`.

- `src/sim/params.ts` — `SLEEPS_PER_DAY`, `SLEEP_DURATION_TICKS`,
  `QUEEN_SLEEP_MULT` (the queen sleeps longer, in longer blocks).
- `src/sim/ants/ant.ts` — an ant gains a sleep state (asleep + wake tick, or a
  running sleep-debt).
- `src/sim/ants/behavior.ts` — an ant at its sleep threshold stops taking jobs
  and rests where it is (or heads to a commons first); asleep = no move, no
  forage, no tend, no haul. A forager finishes the trip home before sleeping,
  never drops on the surface.
- `src/sim/colony/queen.ts` — the queen sleeps too, longer, and doesn't lay
  while asleep.
- `src/sim/colony/demography.ts` / dashboard — an "asleep" count so tuning can
  see the awake workforce.

**Test:**
- over a day, each ant's total sleep ≈ `SLEEPS_PER_DAY × SLEEP_DURATION_TICKS`
  (within tolerance).
- a sleeping ant's position and energy spend are static that tick; the colony
  still functions with a realistic fraction asleep at any moment.
- determinism holds.

**Run it:** activity ebbs and flows over the day/night cycle; clusters of
resting ants in the commons.

---

## Phase 10 — predators as roaming agents

The Phase 5 "predator blinks in near the exit, blinks out" placeholder becomes
a real agent.

- `src/sim/environment/hazards.ts`:
  - A predator **enters from a map edge and walks across to another edge**,
    then leaves — no random despawn. The path can weave.
  - **Vision** — it spots ants within a sight radius; a spotted ant is chased
    and, on contact, **eaten** (`cause: "predator"`).
  - **Graveyard attraction** — the corpse pile draws predators. Both
    `PREDATOR_APPEAR_CHANCE` and path targeting scale with the **number of
    bodies in the graveyard**; a big graveyard means frequent visitors nosing
    around it.
- `src/sim/pheromones.ts` — a second channel: **ALARM**. An ant that sees a
  predator (or is chased) deposits alarm pheromone; it evaporates fast.
- `src/sim/ants/behavior.ts` / `senses.ts` — an ant sensing a nearby predator
  **or** strong alarm pheromone **flees** (drops its job, heads for the hole /
  cover). Ants out of the predator's sight but on the alarm trail still divert.
- `src/sim/index.ts` — chase / strike resolves in the worker loop like the
  current roll, but gated on line-of-sight and range, not a flat radius chance.
- `src/web/render/*` — draw the predator crossing the field; alarm pheromone as
  its own (red) heat-map layer.

**Test:**
- a predator's track runs edge-to-edge; it never despawns mid-map.
- an ant in the predator's vision is chased; an ant that sees it deposits alarm
  and nearby ants divert.
- predator frequency rises measurably with graveyard size (seed the graveyard,
  compare visit rates).
- determinism holds — vision, chase, and alarm are all seeded / pure.

**Run it:** a predator prowls in from one edge, ants scatter ahead of it along
a spreading red alarm trail, it noses the graveyard and exits the far side.

---

## Phase 11 — collective intelligence: teaching, decisions, digging

The colony starts **changing its own layout and improving over time**.

- `src/sim/colony/knowledge.ts` (new) / `src/sim/ants/memory.ts`:
  - **Teaching** — when two ants meet in the nest, the one with better
    knowledge (richer food-site memory, known predator routes, patch quality)
    passes some of it to the other. Knowledge spreads without every ant
    learning first-hand.
  - **Per-ant improvement** — trip success / failure nudges an ant's own
    weights (trust trails vs. memory vs. patches, how early to flee).
- `src/sim/colony/decisions.ts` (new) — colony-level choices, re-evaluated
  slowly, each a scored proposal against the current state; the colony commits
  past a threshold, then ants act on it:
  - **Relocate the graveyard** when predators keep hitting it.
  - **Relocate / add a nursery or food store** — brood away from a cold or
    flooded edge, a store nearer the hole.
- `src/sim/world/nest.ts` / `grid.ts` — **excavation**: a `DIGGER` task turns
  `SOIL` into `TUNNEL` / `CHAMBER` over many ant-ticks; new chambers get roles;
  distance-field caches invalidate on dig. **The queen is never moved** — her
  chamber is fixed; everything else is fair game.
- `src/sim/ants/jobs.ts` — the `DIGGER` job: go to the dig frontier, remove a
  tile, repeat.
- `src/web/render/nest-view.ts` — active dig sites, newly opened rooms.

**Test:**
- knowledge measurably propagates: isolate one ant with a known rich patch,
  confirm colony-wide foraging efficiency rises faster than first-hand
  discovery alone would.
- a colony under repeated graveyard predation relocates the graveyard within N
  ticks and the old plot empties.
- excavation only ever converts `SOIL` — never structural `WALL` or the queen
  chamber; the nest stays fully connected after every dig.
- determinism holds.

**Run it:** a colony that reshapes itself — diggers opening a new wing, the
graveyard migrating away from a predator hotspot, foraging tightening up run
over run.

---

## Phase 12 — visual overhaul

Everything below the sim gets rebuilt. `src/web` only — the sim and every sim
test are untouched.

- **Hide the grid.** No visible tiles. Chambers read as organic dug-out
  pockets, tunnels as smooth channels, the surface as ground — not a lattice.
- **Real movement.** Ants interpolate smoothly between tiles (the sim still
  ticks discretely; the renderer eases positions), face their heading, and
  animate — a stylised body, not a dot.
- **The cube.** The nest and surface become two faces of a 3D volume the
  visitor can **rotate and orbit** — surface on top, nest cross-section on the
  side — instead of two flat canvases. WebGL; weigh a light lib vs. hand-rolled
  when we get here.
- **Global conditions HUD.** Weather, time of day, season, temperature frame
  the **whole** view, not just the surface panel — one clock/weather widget for
  the simulation.
- **Menus.** A proper panel system — dashboard, view controls, and any
  colony-decision readouts in one coherent UI, not stacked fixed-position
  buttons.
- **Art direction.** Grounded-realistic, or a flat warm hand-drawn 2D look
  (Paper Mario-ish). Decide early — it drives sprite work, palette, and
  lighting. "Local mode" and the tuning dashboard keep working throughout.

**Test:** visual / manual — the cube rotates, ants move fluidly and read as
ants, the HUD frames the whole scene. Every sim test still green (nothing here
touches `src/sim`).

**Run it:** the finished-looking thing — a colony you can turn around in your
hands.

---

## Phase 13 — move the loop server-side (first Cloudflare step)

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

## Phase 14 — persistence + hibernation replay

- `src/sim/serialize.ts` — encode/decode state.
- `src/worker/persistence.ts` — save every N ticks, load in the constructor.
- `src/worker/loop.ts` — `ticksToRun(now, lastTick)` capped by `MAX_CATCHUP_TICKS`.

**Test:** DO test that simulates eviction (drop the instance, recreate) and
asserts the colony resumes from storage and replays the missed ticks. Leave
`wrangler dev` running, stop it, restart — colony continues, not resets.

---

## Phase 15 — visitor actions

- `src/sim/inputs.ts` — apply food/water.
- `src/worker/inputs.ts` — validate, clamp, per-visitor daily allowance, global
  rate limit, queue for next tick.
- `src/worker/api/actions.ts`, `src/web/net/visitor-id.ts`, `src/web/ui/toolbar.ts`,
  `water-meter.ts`.

**Test:** `test/worker/inputs.test.ts` — rejects bad kinds/positions/amounts,
enforces allowance + rate limit. In the browser: drop food, watch foragers find it.

---

## Phase 16 — D1: names, lineage, pins, browsing

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

## Phase 17 — cron, KV cache, deploy

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
- Tune `params.ts` after Phase 5, and again after Phase 11 — not before.
