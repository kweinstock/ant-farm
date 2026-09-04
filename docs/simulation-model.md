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
   `foraging`), depositing pheromone as a side effect.
5. **Colony** (`colony/*`) — queen lays eggs (rate from food/temp/season/age),
   brood advances stages, `caste` decides larva fates, `nuptial` may launch a
   flight.
6. **Lifecycle** (`ants/lifecycle.ts`) — burn energy, starvation damage, old-age
   and cold death rolls, job reassignment on age thresholds.
7. **Genetics / lineage** (`genetics/*`) — offspring trait vectors, family-tree
   edges, mark lineages extinct when their living count hits zero.
8. **Collect events** and return.

## The ant rule engine (`ants/behavior.ts`)

Per job, an **ordered** list of `condition → action`. First match wins. Example
worker ordering:

```
threat within alarm range        -> raise alarm pheromone / attack
carrying food AND inside nest     -> deposit in nearest granary chamber
energy below starvation threshold -> eat from stores
strong trail pheromone present    -> follow its gradient
recruit pheromone present         -> move toward it
job task available nearby         -> perform job action (jobs.ts)
otherwise                         -> wander, biased by remembered food sites
```

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
  - **Waste management** — undertakers haul corpses and debris to the midden;
    hygiene slows disease.
- **Drones** — exist to mate. Leave on the nuptial flight, die shortly after.

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
