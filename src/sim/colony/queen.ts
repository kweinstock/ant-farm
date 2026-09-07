// Queen behavior: egg-laying rate as a function of food stores, temperature,
// season (peaks SPRING/SUMMER, near-zero WINTER), and queen age. Models stored
// sperm from the founding nuptial flight: a finite reserve that depletes over
// years. Fertilized egg -> female (worker/future queen); unfertilized -> male
// drone (haplodiploidy). Emits eggs into colony/brood.ts. QueenDied event when
// she reaches lifespan — colony then declines unless colony/caste.ts has raised
// a replacement.
//
// PHASE 3a: MAX_BROOD is gone. The nursery-tile cap (3 eggs/tile, enforced in
// ants/jobs.ts's placeEgg) plus the nurse-carrying cap (3/nurse, enforced in
// ants/behavior.ts) are the real ceiling on placed brood now — a colony-level
// brood cap on top of that would just be a second, disagreeing limit.

import { rng } from "../rng";
import { ageAndMeter } from "../ants/lifecycle";
import type { Ant } from "../ants/ant";
import type { ColonyState } from "../state";
import { layEgg, type Brood } from "./brood";
import { tilesOf } from "../world/nest";

const BASE_LAY_PROBABILITY = 0.1;
const POPULATION_SOFT_TARGET = 30;

export type QueenTickResult = {
    brood: Brood[];
    queen: Ant;
    isDead: boolean;
    rngSeed: number;
};

export function tickQueen(state: ColonyState): QueenTickResult {
    const queenBeforeTick = state.ants.get(state.queenId);

    // index.ts guards this call with `state.ants.has(state.queenId)`, so a
    // missing queen here means that invariant was broken somewhere. Fail loud
    // instead of returning a fake `undefined as Ant` that crashes later with
    // no hint where it came from.
    if (!queenBeforeTick) {
        throw new Error(
            `tickQueen called with no queen ${state.queenId} in state.ants — caller must guard`
        );
    }

    const {ant: queen, isDead} = ageAndMeter(queenBeforeTick);

    if (isDead) {
        return {
            brood: state.brood,
            queen,
            isDead: true,
            rngSeed: state.rngSeed,
        };
    }

    const population = Math.max(state.ants.size, 1);
    const populationFactor = POPULATION_SOFT_TARGET / Math.max(population, POPULATION_SOFT_TARGET);

    // Still no foodFactor. It's a real forager-stocked economy as of 3b, but
    // the 10k probe showed the store sits near-full (foragers out-deliver
    // consumption) and the colony stays bounded on populationFactor alone —
    // adding a lay-rate brake now would just destabilise a working balance
    // for no benefit. Phase 4 revisits it, where weather/season give a
    // foodFactor something real to respond to.
    const layProbability = BASE_LAY_PROBABILITY * populationFactor;

    // Roll unconditionally (keeps the RNG cadence identical whether or not the
    // nursery is full), then gate on capacity.
    const roll = rng(state.rngSeed);
    const nurseryCapacity = tilesOf(state.nest, "NURSERY").length * 3;
    const shouldLay = roll.value < layProbability && state.brood.length < nurseryCapacity;

    const brood = shouldLay ? [...state.brood, layEgg(state)] : state.brood;

    return {
        brood,
        queen,
        isDead: false,
        rngSeed: roll.seed,
    };
}
