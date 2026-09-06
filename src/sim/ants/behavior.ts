// The rule engine: every rule resolves to a target chamber. If the ant isn't
// there, the action is "go toward it"; if it's already there, the action is
// that room's actual work. Ordered, first match wins — resist adding a rule
// without deciding where it slots into this priority, since order is the
// whole point of a rule list like this. Pure: no RNG, no state mutation —
// decide() only reads a Perception and returns an Action, same discipline as
// Phase 3. The queen is never passed through this; she's still entirely
// handled by colony/queen.ts's tickQueen.

import type { Ant } from "./ant";
import type { Perception } from "./senses";
import type { ChamberRole } from "../world/nest";

export const HUNGER_THRESHOLD = 0.5;

// A nurse can hold at most 3 eggs at once. Checked explicitly in rule 3
// below even though, given rule 1's priority, an ant already carrying an
// egg never reaches rule 3 in the first place (rule 1 catches it first) —
// so this check is currently a restatement of an invariant rule ordering
// already guarantees, not something that fires on its own. Keeping it
// explicit here means that stays true even if rule 1's condition ever
// changes; deleting it would make correctness depend entirely on rule order
// never shifting.
export const NURSE_EGG_CAPACITY = 3;

export type Action =
    | { type: "goto"; role: ChamberRole }
    | { type: "pickUpEgg" }
    | { type: "placeEgg" }
    | { type: "eat" }
    | { type: "mill" };

export function decide(ant: Ant, perception: Perception): Action {
    // Rule 1: carrying an egg — get it to the nursery. Highest priority
    // because an egg mid-transit is the one thing actively blocking brood
    // progress; nothing else should interrupt it.
    if (perception.carrying.length > 0) {
        return perception.currentChamber === "NURSERY" ? { type: "placeEgg" } : { type: "goto", role: "NURSERY" };
    }

    // Rule 2: hungry — go eat, wherever else you were headed.
    if (perception.hungerRatio < HUNGER_THRESHOLD) {
        return perception.currentChamber === "FOOD_STORAGE" ? { type: "eat" } : { type: "goto", role: "FOOD_STORAGE" };
    }

    // Rule 3: a nurse with room to carry more and eggs waiting — go collect
    // one. See the NURSE_EGG_CAPACITY comment above for why this length
    // check is currently redundant with rule 1, not independently load-
    // bearing.
    if (
        ant.job === "NURSE" &&
        perception.carrying.length < NURSE_EGG_CAPACITY &&
        perception.eggsAvailableInQueenChamber
    ) {
        return perception.currentChamber === "QUEEN" ? { type: "pickUpEgg" } : { type: "goto", role: "QUEEN" };
    }

    // Rule 4: a forager with nothing more pressing heads for the exit.
    // Actually leaving the nest onto the surface is 3b's job — for now this
    // just means "stand at the exit," which is indistinguishable from
    // milling there until 3b gives EXIT somewhere to lead.
    if (ant.job === "FORAGER") {
        return perception.currentChamber === "EXIT" ? { type: "mill" } : { type: "goto", role: "EXIT" };
    }

    // Rule 5: nothing else applies — including a nurse with no eggs waiting
    // and nothing to carry. Default to milling in the commons rather than
    // idling in place, so an ant with no job to do still reads as "alive and
    // present," not stuck.
    return perception.currentChamber === "COMMONS" ? { type: "mill" } : { type: "goto", role: "COMMONS" };
}