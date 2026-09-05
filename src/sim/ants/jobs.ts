// Per-job action implementations + job assignment.
//
// Assignment: mostly age-based ("temporal polyethism") — young = NURSE,
// older = FORAGER. Two exceptions that respond to colony need instead of age:
//   - NURSE stays capped at 3 eggs each (Phase 3a).
//   - UNDERTAKER is handed out dynamically each tick, proportional to corpse
//     count and weighted by proximity — see src/sim/corpses.ts (Phase 3c).
//
// Actions (Phase 3a+ each resolve to "carry X" / "go to chamber Y", turned into
// a step by ants/movement.ts):
//   forage   — EXIT -> surface -> pile -> carry back -> deposit in FOOD_STORE / to queen
//   nurse    — carry egg from QUEEN chamber to NURSERY, place (3/tile), then tend
//   undertak — carry nearest corpse to EXIT -> graveyard, then revert job
//   eat      — go to FOOD_STORE, eat from stores
//   idle     — mill in COMMONS
//
// Phase 3 (current) is the trimmed version: no chambers yet, wander + eat + tend.

import type { Ant, Job } from "./ant";
import { MAX_ENERGY } from "./ant";
import type { Action } from "./behavior";
import { wander } from "./movement";
import { eatFromPile } from "../world/resources";
import type { FoodPile } from "../world/resources";
import type { ColonyState} from "../state";
import { Brood } from "../colony/brood";


const EAT_AMOUNT = 50;

export const NURSE_AGE_THRESHOLD_TICKS = 150;

export type ActResult = {
    ant: Ant;
    resources: FoodPile[];
    brood: Brood[];
    rngSeed: number;
};

export function act(state: ColonyState, ant: Ant, action: Action): ActResult {
    switch (action.type) {
        case "eat": {
            const {piles, consumed} = eatFromPile(state.resources, action.pileIndex, EAT_AMOUNT);

            return {
                ant: {...ant, energy: Math.min(ant.energy + consumed, MAX_ENERGY)},
                resources: piles,
                brood: state.brood,
                rngSeed: state.rngSeed,
            };
        }

        case "tend": {
            const brood = state.brood.map((entry) => entry.id === action.broodId ? {...entry, tendedThisTick: true} : entry);

            return {
                ant,
                resources: state.resources,
                brood,
                rngSeed: state.rngSeed,
            };
        }

        case "wander": {
            const result = wander(state.grid, ant.position, state.rngSeed);

            return {
                ant: {...ant, position: result.position},
                resources: state.resources,
                brood: state.brood,
                rngSeed: result.seed,
            };
        }
    }
}

export function assignJob(ant: Ant): Job {
    return ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS ? "NURSE" : "FORAGER";
}