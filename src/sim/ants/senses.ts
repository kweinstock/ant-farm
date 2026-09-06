// Builds one ant's Perception for this tick — a pure read of state, no
// decisions made here (behavior.ts owns those). Phase 3a: dropped
// onFoodPileIndex and nearBroodId entirely — the scattered food-pile concept
// is gone (state.ts's single foodStore replaced it), and brood interaction
// is chamber-gated now, not proximity-gated, so "is there a nearby brood
// entry" stopped being the right question to ask.

import type { Ant } from "./ant";
import { MAX_ENERGY } from "./ant";
import { chamberAt, type ChamberRole } from "../world/nest";
import type { ColonyState } from "../state";
import type { BroodId } from "../colony/brood";

export type Perception = {
    currentChamber: ChamberRole | undefined;
    carrying: BroodId[];
    hungerRatio: number;
    eggsAvailableInQueenChamber: boolean;
};

export function perceive(state: ColonyState, ant: Ant): Perception {
    const currentChamber = chamberAt(state.nest, ant.position);

    // "Available" means: still an EGG (LARVA/PUPA aren't carried anywhere in
    // this phase), physically still sitting in the QUEEN chamber (an egg's
    // position IS its location — no separate "which chamber" field needed),
    // and not already claimed by a nurse. Brood.carriedBy is the single
    // source of truth for that last part — jobs.ts sets it in the same step
    // it adds the id to the nurse's Ant.carrying list, so within this tick's
    // per-ant loop a nurse earlier in the sort order will already have
    // stamped carriedBy before a later nurse perceives.
    const eggsAvailableInQueenChamber = state.brood.some(
        (brood) =>
            brood.stage === "EGG" &&
            chamberAt(state.nest, brood.position) === "QUEEN" &&
            brood.carriedBy === undefined
    );

    return {
        currentChamber,
        carrying: ant.carrying,
        hungerRatio: ant.energy / MAX_ENERGY,
        eggsAvailableInQueenChamber,
    };
}

