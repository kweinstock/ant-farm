# Simulation model

The design target: **simple per-ant rules → complex colony behavior emerges.**
Resist hard-coding colony-level outcomes. If trail networks, division of labor,
or boom/bust population cycles appear, they should come from the rules below, not
from a scheduler.

## Tick order (implemented in `src/sim/index.ts`)

Each `step(state, queuedInputs, dtTicks)` runs, in order:

1. **Apply visitor inputs** (`inputs.ts`) — food / water only, already validated.
2. **Environment** (`environment/*`) — advance `clock`, `season`, roll `weather`
   transitions, recompute `temperature`, update `hazards` (predator presence,
   flooding from sustained rain, cold snaps, disease spread).
3. **Pheromones** (`pheromones.ts`) — diffuse to neighbors, then evaporate
   (faster in rain). Deposits happen during step 4 as ants act.
4. **Ants** (`ants/*`) — rebuild the spatial hash, then for each ant:
   `senses` → `behavior` (pick one rule) → act (`jobs` / `movement` /
   `foraging`), in whichever space (`nest` / `surface`) the ant is in; ants that
   reach the `EXIT` tile cross between spaces. Pheromone deposits happen here.
5. **Colony** (`colony/*`) — queen lays eggs (rate from food/temp/season/age),
   brood advances stages (nursery-only), `caste` decides larva fates, `nuptial`
   may launch a flight.
6. **Lifecycle** (`ants/lifecycle.ts`) — burn energy, starvation damage, old-age
   and cold death rolls, job reassignment. A death spawns a **corpse** entity
   (`corpses.ts`), which also ages/decays here.
7. **Undertaker assignment** (`corpses.ts`) — recompute how many workers are on
   corpse duty (proportional to corpse count, proximity-weighted).
8. **Genetics / lineage** (`genetics/*`) — offspring trait vectors, family-tree
   edges, mark lineages extinct when their living count hits zero.
9. **Collect events** and return.

## The ant rule engine (`ants/behavior.ts`)

Per job, an **ordered** list of `condition → action`. First match wins. Example
worker ordering:

```
threat within alarm range         -> raise alarm pheromone / attack
carrying a corpse                 -> head for the EXIT / graveyard
carrying food AND inside the nest -> head for FOOD_STORE and deposit
carrying an egg                   -> head for NURSERY and place it
energy below starvation threshold -> head for FOOD_STORE and eat
at my job's destination chamber   -> perform job action (jobs.ts)
strong trail pheromone present    -> follow its gradient
otherwise                         -> head toward my job's chamber (movement.ts)
```

Most rules now resolve to "carry X" or "go to chamber Y" — `movement.ts` turns
that goal into a step. Pure random wander is only the last resort.

Keep the list short. Every special case you add reduces the chance of surprising
emergent behavior.

## Castes and jobs

- **Queen** — lays eggs; fertilized (from stored sperm) → female, unfertilized →
  male drone (haplodiploidy). Larger, far longer lifespan. Death → `QueenDied`;
  colony declines unless `caste.ts` raised a replacement gyne.
- **Workers** (sterile females) — job changes with **age** ("temporal
  polyethism"): young = nurse / nest-worker / builder (inside); old = forager /
  soldier / undertaker (outside, higher risk). Reassignment also responds to
  colony need.
  - **Foraging** — leave via the single exit, find food, lay a trail on the way
    back (positive feedback recruits nestmates), communicate location via that
    trail.
  - **Brood care** — feed larvae, move eggs/larvae/pupae between chambers to hit
    target temperature + humidity.
  - **Nest maintenance** — dig and repair tunnels/chambers, keep ventilation and
    storage.
  - **Defense** — soldiers (bigger jaws) respond to alarm pheromone.
  - **Waste management** — undertakers haul corpses out through the exit to the
    **graveyard** on the surface (see below); hygiene slows disease.
- **Drones** — exist to mate. Leave on the nuptial flight, die shortly after.

## The nest, the surface, and moving between them

*(Structure introduced in Phases 3a–3c.)*

Two distinct coordinate spaces:

- **The nest** — a **vertical cross-section** (x across, y = depth), rendered
  like an ant farm viewed between glass. Tiles are `SOIL` (undug), `TUNNEL`,
  `CHAMBER`, `WALL`, `EXIT`. The dug-out space is a fixed starter layout of
  rooms joined by tunnels:
  - `QUEEN` — the queen sits here and lays; eggs appear here.
  - `NURSERY` — eggs only progress once a nurse has carried them here.
  - `FOOD_STORE` — foragers deposit returned food here; hungry ants come here to
    eat.
  - `COMMONS` — the "room to move around in" / crossroads ants pass through and
    idle in.
  - `EXIT` — the shaft up to the surface.
- **The surface** — a separate **top-down** plane: the exit hole, an open area
  where food piles spawn at random positions over time, and the graveyard patch
  just outside the hole.

Every mobile thing carries `location: { where: "nest" | "surface"; pos }`. An ant
that walks onto the `EXIT` tile is moved to the matching tile in the other space
and its `where` flips. The tick loop runs a nest pass and then a surface pass.

### Room-aware movement (`ants/movement.ts`)

Each job resolves to a **destination chamber**. Movement is a BFS distance field
over passable tiles from that chamber (one cached field per role; the nest is
static for now) — each tick the ant steps to the lowest-distance neighbour, with
a little noise so they don't form rigid lines. Random wander is only the fallback
when an ant has no goal.

### Nurses and eggs

- Eggs are laid in the `QUEEN` chamber and are inert there.
- A nurse picks up an egg, carries it to the `NURSERY`, and places it on a tile
  with a free slot.
- **A nurse holds at most 3 eggs at once. A nursery tile holds at most 3 eggs.**
- Only eggs actually in the nursery advance toward larva/pupa/adult.

### Foragers and delivery

A forager walks to the `EXIT`, onto the surface, to a food pile, picks up a load,
returns through the exit, and **deposits it in the `FOOD_STORE` (or hands it
straight to the queen)**. The surface death roll (Phase 4+) makes this the risky
job it should be.

### Corpses and the undertaker (`corpses.ts`)

- A dead ant becomes a **corpse** entity at its death spot — **small, 2 per
  tile** — and decays away on its own after a long time even if never moved.
- **Undertaker is a dynamic job, not an age band.** Each tick:
  `desiredUndertakers ≈ round(corpseCount × UNDERTAKER_PER_CORPSE)`, clamped to a
  fraction of the workforce.
  - **No corpses → no undertakers.**
  - The workers picked are the ones **closest to a corpse** — proximity-weighted,
    so an ant standing next to a body is far more likely to be tasked with it
    than one across the nest.
- An undertaker carries the nearest corpse to the `EXIT`, out to the
  **graveyard** on the surface, drops it on the growing pile, and reverts to its
  previous job.

## Learning (`ants/memory.ts`)

Each ant keeps small bounded stores: remembered food sites (with decay),
per-route success/failure counts, and danger locations. Reinforced on success,
decays over time. Learning rate is a **heritable trait**. Aggregate effect: death
rate per forage trip should fall measurably over generations
(`test/sim/learning.test.ts`). Selection is implicit — better-calibrated ants
survive foraging and their queen-line traits propagate.

## Genetics (`genetics/*`)

Bounded float trait vector: `riskTolerance`, `trailFidelity`, `speed`,
`metabolism`, `learningRate`, `aggression`, `broodCareSkill`. Offspring =
blend(queen genome, stored-sperm genome) + small bounded mutation. Drones are
haploid (queen only). Family tree = `parent → child` edges tagged with a
`LineageId` inherited from the mother's line; when a lineage's living count hits
zero it is marked extinct and shown in the memorial.

## Environment (server-only — no visitor input path)

- **Time of day**: dawn / day / dusk / night. Night lowers surface activity and
  visibility, raises forage risk.
- **Season**: spring / summer / fall / winter. Scales natural surface resource
  abundance, queen laying rate, brood speed, baseline temperature. Winter is a
  survival test of stored food.
- **Weather**: seeded Markov chain — clear / rain / snow / heat / cold snap —
  with a short forecast shown in the HUD. Affects pheromone evaporation,
  movement speed (mud), forage risk, and flooding.
- **Temperature**: `base(season, timeOfDay) + weather + depthGradient`.
  Underground is buffered. Drives brood timers, cold death, evaporation.
- **Hazards**: predator at the exit, tunnel flooding, cold snaps, disease
  outbreaks. Frequency and severity scale with season + weather. **Visitors can
  never trigger, place, or remove these** — this is the "set changes visitors
  have no effect on" requirement.

## Visitor effects (the only ones)

- **Add food** on a surface tile — a pile foragers can discover.
- **Add water** on a surface tile — a pool; level tracked and shown, shrinks via
  evaporation.
- **Pin an ant** — pure client/D1 state; does not touch the sim.

All three are rate-limited and (for food/water) clamped and allowance-capped
server-side.

## Determinism contract

`step()` is a pure function. No wall-clock reads, no `Math.random`, no I/O. Time
enters only as `dtTicks`; randomness only via `state.rngSeed` (`rng.ts`). Fixed
iteration order over ants (sort by `AntId`). This is non-negotiable — the Durable
Object replays elapsed ticks after hibernation, and any nondeterminism makes the
colony diverge between viewers and across restarts.

## Emergent behaviors to watch for (signs it's working)

- Trail networks that form toward a new food pile and collapse when it's gone.
- Foraging effort that tracks season and weather without being told to.
- Division of labor shifting as the colony's age structure changes.
- Population boom after a good summer, crash in a hard winter, recovery in spring.
- Lineages that dominate for a while, then go extinct — a readable "history".
