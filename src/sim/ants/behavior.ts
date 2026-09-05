// The rule engine. Each job has an ORDERED list of condition -> action rules;
// the first whose condition fires this tick wins. Example worker ordering:
//   threat nearby            -> raise alarm / attack
//   carrying food & inside   -> deposit in granary
//   starving                 -> eat from stores
//   on a strong trail        -> follow gradient
//   recruited                -> move toward recruit signal
//   job task available       -> do job (jobs.ts)
//   else                     -> wander (biased by memory)
//
// Deliberately small and legible — emergent complexity is the goal, so resist
// adding special-case rules. Randomness via state rng only.

import type { Ant } from "./ant";
import type { Perception } from "./senses";
import type { BroodId } from "../colony/brood";

export const HUNGER_THRESHOLD = 0.5;

export type Action = {type: "eat"; pileIndex: number} | {type: "tend"; broodId: BroodId} | {type: "wander"};

export function decide(ant: Ant, perception: Perception): Action {
    if (perception.hungerRatio < HUNGER_THRESHOLD && perception.onFoodPileIndex !== undefined) {
        return {type: "eat", pileIndex: perception.onFoodPileIndex};
    }

    if (ant.job === "NURSE" && perception.nearBroodId !== undefined) {
        return {type: "tend", broodId: perception.nearBroodId};
    }

    return {type: "wander"}
}