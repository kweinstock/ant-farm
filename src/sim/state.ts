// ColonyState — the entire world in one serializable object, plus the two
// projections the client ever sees.
//
//   ColonyState {
//     seq            monotonic tick counter
//     simTime        ticks since founding
//     rngSeed        current PRNG state (advanced in place — see rng.ts)
//     grid           flat typed arrays for tiles (see world/grid.ts)
//     nest           chamber list + roles (world/nest.ts)
//     surface        exit position, resource spawn points (world/surface.ts)
//     resources      food piles + water pools (world/resources.ts)
//     pheromones     trail/alarm/recruit layers as Float arrays (pheromones.ts)
//     ants           Map<AntId, Ant> (ants/ant.ts)
//     brood          egg/larva/pupa records (colony/brood.ts)
//     queenId        AntId | null
//     lineages       Map<LineageId, LineageMeta>
//     nextAntId      counter
//     env            { season, timeOfDay, weather, temperature, forecast }
//     stats          cached demography for cheap HUD reads (colony/demography.ts)
//   }
//
//   createInitialState(seed) -> ColonyState   founding queen + starter workers + dug nest
//   toSnapshot(state) -> Snapshot             lossy: only what the client renders (ant pos/caste/job/carry, resources, pheromone summary, env, stats)
//   diff(prev, next) -> Diff                  minimal change set between two snapshots

// PHASE 1 NOTE: the ColonyState below is a deliberate trim of the full shape
// documented above (no nest/resources/pheromones/multiple ants yet — just
// enough to prove the tick loop and determinism). Expand it phase by phase
// rather than building the full thing now.

import { randomInt } from "./rng";
import { createGrid, type Grid, type Position } from "./world/grid"

// Small + named here (not inline) because these are exactly the numbers
// you'll be hand-tuning once print-sim.ts is running — e.g. lifespans this
// short are deliberately impatient so a full life is watchable in seconds.
const GRID_WIDTH = 10;
const GRID_HEIGHT = 10;

// Set well above MAX_LIFESPAN_TICKS on purpose: there's no food source until
// Phase 3, so with METABOLISM_COST=1/tick and no way to refill, energy is a
// straight countdown from this number. If it were lower than the lifespan
// range, starvation would ALWAYS win, at the same fixed tick every run
// regardless of seed — making the lifespan roll below pointless dead code.
// Keeping this above the range means old-age death (the interesting,
// seed-dependent case) is actually reachable for now.
const STARTING_ENERGY = 1500;

// Exported so tests can assert death happens within this exact range,
// instead of hard-coding a second copy of these numbers in the test file.
export const MIN_LIFESPAN_TICKS = 500;
export const MAX_LIFESPAN_TICKS = 1000;

export type Ant = {
    id: string;
    position: Position;
    energy: number;
    ageTicks: number;
    lifespanTicks: number;
};

export type ColonyState = {
    seq: number;
    simTime: number;
    rngSeed: number;
    grid: Grid;
    ant: Ant | null;
};

export function createInitialState(seed: number): ColonyState {
    const grid = createGrid(GRID_WIDTH, GRID_HEIGHT);

    const centerX = Math.floor(GRID_WIDTH / 2);
    const centerY = Math.floor(GRID_HEIGHT / 2);

    const lifespanResult = randomInt(seed, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS);

    return {
        seq: 0,
        simTime: 0,
        // rngSeed is lifespanResult.seed, NOT the incoming `seed` parameter.
        // Rolling the lifespan already consumed one draw from the RNG; if a
        // second random decision reused the raw `seed`, it would replay the
        // exact same "random" value the lifespan roll got. Every consumer of
        // the RNG has to store and pass forward the seed it got back, not
        // the one it started with — this is the pattern to repeat anywhere
        // else randomness gets added later.
        rngSeed: lifespanResult.seed,
        grid,
        ant: {
            id: "ant-1",
            position: {
                x: centerX,
                y: centerY,
            },
            energy: STARTING_ENERGY,
            ageTicks: 0,
            lifespanTicks: lifespanResult.value
        },
    };
}
