// Per-job action implementations + the age->job assignment ("temporal
// polyethism"): young adults do NURSE / NEST_WORKER / BUILDER inside; older
// adults become FORAGER / SOLDIER / UNDERTAKER outside. Reassignment also
// responds to colony need (lots of brood -> more nurses; corpses piling up ->
// more undertakers) so the workforce self-balances.
//
// Actions: forage (delegates to foraging.ts), nurseBrood, buildTunnel,
// repairChamber, defend, haulCorpseToMidden, tendGranary.

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