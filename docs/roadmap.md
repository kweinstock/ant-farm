# Build roadmap

Incremental plan. Each phase ends with something you can **run and test**. The
file tree in `architecture.md` is a reference map — create real files only as a
phase needs them, and ignore (or delete) stubs you haven't reached.

Cloudflare is not involved until **Phase 6**. Phases 1–5 run with `npm test` and
`npm run dev` alone.

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

## Phase 4 — pheromones + foraging

- `src/sim/pheromones.ts` — trail layer: deposit, diffuse, evaporate.
- `src/sim/world/surface.ts` — the single exit tile.
- `src/sim/foraging.ts` — leave, find food, carry back, lay trail, death roll.
- `src/sim/ants/memory.ts` — remembered food sites.
- `src/web/render/pheromone-layer.ts` — heat-map toggle.

**Test:**
- trail forms toward a food pile and decays after it's gone (assert pheromone
  totals over time).
- `learning.test.ts` — deaths per forage trip trend down over generations.

**Run it:** watch trails form and collapse in the browser.

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
