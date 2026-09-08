import type { Position } from "../world/grid";
import { randomInt } from "../rng";
import { BroodId } from "../colony/brood";
import type { CorpseId } from "../corpses";
import { emptyMemory, type AntMemory } from "./memory";
import { STARTING_ENERGY, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS, QUEEN_MIN_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS } from "../params";

export type AntId = string;
export type Caste = "QUEEN" | "WORKER";
export type Job = "NURSE" | "FORAGER";

export type AntLocation = {
    where: "nest" | "surface";
    pos: Position,
};

export type Ant = {
    id: AntId;
    name: string;
    caste: Caste;
    job: Job;
    carrying: BroodId[];
    carryingFood: number;
    undertaking?: { corpseId: CorpseId };
    memory: AntMemory;
    location: AntLocation;
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
            carryingFood: 0,
            undertaking: undefined,
            memory: emptyMemory(),
            location: { where: "nest", pos: position },
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
            carryingFood: 0,
            undertaking: undefined,
            memory: emptyMemory(),
            location: { where: "nest", pos: position },
            energy: STARTING_ENERGY,
            ageTicks: 0,
            lifespanTicks: queenLifespan.value,
        },
        seed: queenLifespan.seed,
    };
}