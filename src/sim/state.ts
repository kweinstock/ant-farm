// PHASE 3b: the sim now spans two coordinate spaces. state.grid/state.nest is
// still the underground cross-section; state.surface (world/surface.ts) is
// the new top-down foraging ground. Every Ant (queen included, for a uniform
// record) now carries `location: { where: "nest" | "surface"; pos }` instead
// of a bare `position` — see ants/ant.ts. The queen's `where` is always
// "nest"; only foragers ever set it to "surface".

import { createStarterNest, tilesOf, GRID_WIDTH, GRID_HEIGHT, type Nest } from "./world/nest";
import { createSurface, SURFACE_WIDTH, SURFACE_HEIGHT, type Surface } from "./world/surface";
import type { Grid } from "./world/grid";
import { type Ant, type AntId, createQueen, createWorker } from "./ants/ant";
import type { Brood } from "./colony/brood";

const STARTER_WORKER_COUNT = 5;

// Placeholder single-number food economy from 3a. The passive regen that
// used to keep this topped up is gone as of this phase (world/resources.ts's
// regenFoodStore is deleted in file 10) — foragers hauling real trips
// through depositFood are the only inflow now. Seeded near-but-not-at
// capacity so the colony has a cushion for the first few trips' travel time
// before it's genuinely at risk, not so much cushion that a broken forager
// loop goes unnoticed for thousands of ticks.
export const STARTING_FOOD_STORE = 400;
export const FOOD_STORE_CAP = 500;

// How much food one forager trip delivers per pickUpFood. The single biggest
// lever in the 3b economy — raise this first if the colony starves despite
// piles existing and foragers reaching them, before touching spawn rate or
// population. A 10k-tick probe (seed 12345) held the store at 350-500 and
// population at ~40-58 while queened at 100 — kept as-is.
export const FORAGER_LOAD = 100;

// The pile-spawn/decay params (MAX_PILES, PILE_START_AMOUNT, PILE_SPAWN_CHANCE,
// PILE_DECAY_TICKS) are defined and owned by world/surface.ts — the module
// that actually uses them in spawnFoodPiles/ageFoodPiles. Import them from
// there, not from here.

export type ColonyState = {
    seq: number;
    simTime: number;
    rngSeed: number;
    grid: Grid;
    nest: Nest;
    surface: Surface;
    ants: Map<AntId, Ant>;
    nextAntId: number;
    nextBroodId: number;
    queenId: AntId;
    brood: Brood[];
    foodStore: { amount: number; capacity: number };
};

export function createInitialState(seed: number): ColonyState {
    const {grid, nest} = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
    const surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);

    const ants = new Map<AntId, Ant>();
    let nextAntId = 1;
    let currentSeed = seed;

    // Queen keeps a bare position (see the file header note) — any QUEEN
    // tile works, same reasoning as always: one physical room, not
    // meaningfully different spots.
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
        surface,
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
