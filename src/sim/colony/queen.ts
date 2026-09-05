// Queen behavior: egg-laying rate as a function of food stores, temperature,
// season (peaks SPRING/SUMMER, near-zero WINTER), and queen age. Models stored
// sperm from the founding nuptial flight: a finite reserve that depletes over
// years. Fertilized egg -> female (worker/future queen); unfertilized -> male
// drone (haplodiploidy). Emits eggs into colony/brood.ts. QueenDied event when
// she reaches lifespan — colony then declines unless colony/caste.ts has raised
// a replacement.

import { rng } from "../rng";
import { ageAndMeter } from "../ants/lifecycle";
import type { Ant } from "../ants/ant";
import type { ColonyState } from "../state";
import { layEgg, type Brood } from "./brood";

const BASE_LAY_PROBABILITY = 0.1;
const FOOD_REFERENCE_PER_ANT = 40;
const POPULATION_SOFT_TARGET = 30;

// Hard ceiling on how much brood can exist at once — think nursery capacity /
// how many young the colony can physically care for. Without this the queen
// out-lays what the (few) nurses can raise and state.brood grows forever:
// unbounded memory, and perceive()'s per-ant brood scan gets slower every
// tick. This bounds the leak; it does NOT fix the underlying nurse-throughput
// imbalance (see the note in colony/brood.ts / the Phase 3 review). Exported
// so population.test.ts can assert brood stays bounded.
export const MAX_BROOD = 40;

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
    const totalFood = state.resources.reduce((sum, pile) => sum + pile.amount, 0);
    const foodPerAnt = totalFood / population;

    const foodFactor = Math.min(foodPerAnt / FOOD_REFERENCE_PER_ANT, 1);
    const populationFactor = POPULATION_SOFT_TARGET / Math.max(population, POPULATION_SOFT_TARGET);

    const layProbability = BASE_LAY_PROBABILITY * foodFactor * populationFactor;

    // Roll unconditionally (keeps the RNG cadence identical whether or not the
    // nursery is full), then gate on capacity.
    const roll = rng(state.rngSeed);
    const shouldLay = roll.value < layProbability && state.brood.length < MAX_BROOD;

    const brood = shouldLay ? [...state.brood, layEgg(state)] : state.brood;

    return {
        brood,
        queen,
        isDead: false,
        rngSeed: roll.seed,
    };
}
