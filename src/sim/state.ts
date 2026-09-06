// PHASE 3a: the flat open board is gone. Grid dimensions, the chamber
// layout, and distance fields all come from world/nest.ts's
// createStarterNest — this file no longer defines its own grid size
// constants, so there's exactly one source of truth for "how big is the
// world" instead of two that could drift apart.

import { createStarterNest, tilesOf, GRID_WIDTH, GRID_HEIGHT, type Nest } from "./world/nest";
import type { Grid } from "./world/grid";
import { type Ant, type AntId, createQueen, createWorker } from "./ants/ant";
import type { Brood } from "./colony/brood";

const STARTER_WORKER_COUNT = 5;

// Placeholder single-number food economy — Phase 3's scattered FoodPile[]
// is gone. Seeded near (not at) capacity so the colony isn't food-stressed
// on tick 1 but also isn't starting maxed out. FOOD_STORE_REGEN is the slow
// passive trickle world/resources.ts's regrow-equivalent applies every tick
// until 3b's foragers exist to actually stock this from real trips.
export const STARTING_FOOD_STORE = 400;
export const FOOD_STORE_CAP = 500;

export type ColonyState = {
    seq: number;
    simTime: number;
    rngSeed: number;
    grid: Grid;
    nest: Nest;
    ants: Map<AntId, Ant>;
    nextAntId: number;
    nextBroodId: number;
    queenId: AntId;
    brood: Brood[];
    foodStore: { amount: number; capacity: number };
};

export function createInitialState(seed: number): ColonyState {
    const {grid, nest} = createStarterNest(GRID_WIDTH, GRID_HEIGHT);

    const ants = new Map<AntId, Ant>();
    let nextAntId = 1;
    let currentSeed = seed;

    // Any QUEEN tile works — it's one physical room, not a set of
    // meaningfully different spots — so [0] just needs the chamber to be
    // non-empty, which createStarterNest's hand-authored layout guarantees.
    const queenId = `queen-ant-${nextAntId++}`;
    const queen = createQueen(queenId, tilesOf(nest, "QUEEN")[0], currentSeed)
    currentSeed = queen.seed;
    ants.set(queenId, queen.ant);

    const commonTiles = tilesOf(nest, "COMMONS");

    for (let i = 0; i < STARTER_WORKER_COUNT; i++) {
        // Wraps via modulo once there are more starter workers than COMMONS
        // tiles — several ants sharing a tile is fine, nothing in the sim
        // treats ant-on-ant tile occupancy as exclusive (only nursery
        // egg-slots and a nurse's own carrying capacity are actually
        // capacity-limited).
        const workerId = `ant-${nextAntId++}`;
        const worker = createWorker(workerId, commonTiles[i % commonTiles.length], currentSeed);
        currentSeed = worker.seed;
        ants.set(workerId, worker.ant);
    }

    return {
        seq: 0,
        simTime: 0,
        rngSeed: currentSeed,
        grid,
        nest,
        ants,
        nextAntId,
        nextBroodId: 1,
        queenId,
        brood: [],
        foodStore: {
            amount: STARTING_FOOD_STORE,
            capacity: FOOD_STORE_CAP,
        },
    };
}
