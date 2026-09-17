import type { Position } from "../world/grid";
import { randomInt } from "../rng";
import { BroodId } from "../colony/brood";
import type { CorpseId } from "../corpses";
import { emptyMemory, type AntMemory } from "./memory";
import { STARTING_ENERGY, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS, QUEEN_MIN_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS, SLEEP_CYCLE_TICKS } from "../params";

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
    digging?: { planId: string };
    memory: AntMemory;
    location: AntLocation;
    energy: number;
    ageTicks: number;
    lifespanTicks: number;
    asleep: boolean;
    wakeAt: number;
    ticksAwake: number;
    sleepPhase: number;
    spookedUntil: number;
    tripSource?: "trail" | "memory" | "patch";
    tripStartTick?: number;
};

export function createWorker(id: AntId, position: Position, currentSeed: number): {ant: Ant; seed: number} {
    const workerLifespan = randomInt(currentSeed, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS);
    const sleepPhase = randomInt(workerLifespan.seed, 0, SLEEP_CYCLE_TICKS - 1);
    // sleepPhase only staggers the FIRST nap (seeded here as the starting
    // ticksAwake) so founding ants don't all drop at once. After that,
    // ticksAwake resets to 0 on every wake and isSleepy() reads ticksAwake
    // alone — it must NOT keep re-adding sleepPhase on every check, or an
    // ant born with sleepPhase in the top SLEEP_DURATION_TICKS values of the
    // cycle would satisfy the sleepy threshold again the instant it wakes
    // (ticksAwake back at 0 + that same phase), sleeping forever.
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
            asleep: false,
            wakeAt: 0,
            ticksAwake: sleepPhase.value,
            sleepPhase: sleepPhase.value,
            spookedUntil: 0,
        },
        seed: sleepPhase.seed,
    };
}

export function createQueen(id: AntId, position: Position, currentSeed: number): {ant: Ant; seed: number} {
    const queenLifespan = randomInt(currentSeed, QUEEN_MIN_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS);
    const sleepPhase = randomInt(queenLifespan.seed, 0, SLEEP_CYCLE_TICKS - 1);
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
            asleep: false,
            wakeAt: 0,
            ticksAwake: sleepPhase.value,
            sleepPhase: sleepPhase.value,
            spookedUntil: 0,
        },
        seed: sleepPhase.seed,
    };
}