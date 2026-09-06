import type { Position } from "../world/grid";
import { randomInt } from "../rng";
import { BroodId } from "../colony/brood";

const STARTING_ENERGY = 1500;
export const MAX_ENERGY = 1500;

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

export type AntId = string;
export type Caste = "QUEEN" | "WORKER";
export type Job = "NURSE" | "FORAGER";

export type Ant = {
    id: AntId;
    name: string;
    caste: Caste;
    job: Job;
    carrying: BroodId[];
    position: Position;
    energy: number;
    ageTicks: number;
    lifespanTicks: number;
};

export function createWorker(id: AntId, position: Position, currentSeed: number): {ant: Ant; seed: number} {
    const workerLifespan = randomInt(currentSeed, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS);
    return {
        ant: {
            id,
            name: id,
            caste: "WORKER",
            job: "NURSE",
            carrying: [],
            position,
            energy: STARTING_ENERGY,
            ageTicks: 0,
            lifespanTicks: workerLifespan.value,
        },
        seed: workerLifespan.seed,
    };
}

export function createQueen(id: AntId, position: Position, currentSeed: number): {ant: Ant; seed: number} {
    const queenLifespan = randomInt(currentSeed, QUEEN_MIN_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS);
    return {
        ant: {
            id,
            name: id,
            caste: "QUEEN",
            job: "NURSE",
            carrying: [],
            position,
            energy: STARTING_ENERGY,
            ageTicks: 0,
            lifespanTicks: queenLifespan.value,
        },
        seed: queenLifespan.seed
    };
}