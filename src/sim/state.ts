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
import type { Corpse } from "./corpses";

const STARTER_WORKER_COUNT = 5;

export const STARTING_FOOD_STORE = 400;
export const FOOD_STORE_CAP = 500;

export const FORAGER_LOAD = 100;

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
    corpses: Corpse[];
    nextCorpseId: number;
    foodStore: { amount: number; capacity: number };
};

export function createInitialState(seed: number): ColonyState {
    const {grid, nest} = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
    const surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);

    const ants = new Map<AntId, Ant>();
    let nextAntId = 1;
    let currentSeed = seed;

    const queenId = `queen-ant-${nextAntId++}`;
    const queen = createQueen(queenId, tilesOf(nest, "QUEEN")[0], currentSeed)
    currentSeed = queen.seed;
    ants.set(queenId, queen.ant);

    const commonTiles = tilesOf(nest, "COMMONS");

    for (let i = 0; i < STARTER_WORKER_COUNT; i++) {
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
        corpses: [],
        nextCorpseId: 1,
        foodStore: {
            amount: STARTING_FOOD_STORE,
            capacity: FOOD_STORE_CAP,
        },
    };
}
