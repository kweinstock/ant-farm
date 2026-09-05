// PHASE 1 NOTE: the ColonyState below is a deliberate trim of the full shape
// documented above (no nest/resources/pheromones/multiple ants yet — just
// enough to prove the tick loop and determinism). Expand it phase by phase
// rather than building the full thing now.

import { randomInt } from "./rng";
import { createGrid, type Grid, type Position } from "./world/grid"
import { type Ant, type AntId, createQueen, createWorker } from "./ants/ant"
import { type FoodPile } from "./world/resources";
import { Brood } from "./colony/brood";

// Small + named here (not inline) because these are exactly the numbers
// you'll be hand-tuning once print-sim.ts is running — e.g. lifespans this
// short are deliberately impatient so a full life is watchable in seconds.
const GRID_WIDTH = 10;
const GRID_HEIGHT = 10;

// Exported so tests can assert death happens within this exact range,
// instead of hard-coding a second copy of these numbers in the test file.
export const MIN_LIFESPAN_TICKS = 500;
export const MAX_LIFESPAN_TICKS = 1000;

// Mortal, and shorter than a 10k run on purpose: the queen IS meant to die
// (simulation-model.md: "Death -> QueenDied; colony declines unless caste.ts
// raised a replacement"). Phase 3 has neither succession (colony/caste.ts)
// nor foragers feeding her (Phase 4+ trophallaxis), so once she's gone the
// colony winds down — that's expected, not a bug. Still clearly longer-lived
// than a worker (500-1000), matching real ant biology.
export const QUEEN_MIN_LIFESPAN_TICKS = 4000;
export const QUEEN_MAX_LIFESPAN_TICKS = 7000;

const STARTER_WORKER_COUNT = 5;

const STARTING_FOOD_AMOUNT = 200;
const FOOD_PILE_CAP = 200;

const STARTER_WORKER_OFFSETS: Position[] = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: 1 },
];


const FOOD_PILE_OFFSETS: Position[] = [
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: 0, y: 3 },
];

export type ColonyState = {
    seq: number;
    simTime: number;
    rngSeed: number;
    grid: Grid;
    ants: Map<AntId, Ant>;
    nextAntId: number;
    nextBroodId: number;
    queenId: AntId;
    brood: Brood[];
    resources: FoodPile[];
};

export function createInitialState(seed: number): ColonyState {
    const grid = createGrid(GRID_WIDTH, GRID_HEIGHT);

    const centerX = Math.floor(GRID_WIDTH / 2);
    const centerY = Math.floor(GRID_HEIGHT / 2);

    const ants = new Map<AntId, Ant>();
    let nextAntId = 1;

    let currentSeed = seed;

    const queenId = `queen-ant-${nextAntId++}`;
    const queenLifespan = randomInt(currentSeed, QUEEN_MIN_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS);
    currentSeed = queenLifespan.seed

    ants.set(queenId, createQueen(queenId, {x: centerX, y:centerY}, queenLifespan.value));

    for (let i = 0; i < STARTER_WORKER_COUNT; i++) {
        const workerId = `ant-${nextAntId++}`;
        const wokerLifespan = randomInt(currentSeed, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS);
        currentSeed = wokerLifespan.seed;

        const offset = STARTER_WORKER_OFFSETS[i];
        ants.set(workerId, createWorker(workerId, {x: centerX + offset.x, y: centerY + offset.y}, wokerLifespan.value))
    }

    const resources: FoodPile[] = FOOD_PILE_OFFSETS.map((offset) => ({
        position: {x: centerX + offset.x, y: centerY + offset.y},
        amount: STARTING_FOOD_AMOUNT,
        capacity: FOOD_PILE_CAP,
    }));

    return {
        seq: 0,
        simTime: 0,
        rngSeed: currentSeed,
        grid,
        ants,
        nextAntId,
        nextBroodId: 1,
        queenId,
        brood: [],
        resources,
    };
}
