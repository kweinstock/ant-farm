// The rule engine: every rule resolves to a target chamber (nest-side) or
// hands off to foraging.ts's own state machine (surface-side). Ordered,
// first match wins. Pure: no RNG, no state mutation. The queen is never
// passed through this.
//
// PHASE 3b: decide() is called for every worker regardless of which space
// it's in — there's no separate surface entry point. Rules 1, 3, and 5 only
// ever actually resolve for a nest ant, but not all for the same reason:
// rule 1's carrying-an-egg check is structurally always false for a
// FORAGER (nothing ever sets `carrying` on one — see ant.ts's
// carrying/carryingFood comment), while rules 3 and 5 are nest-only simply
// because rule 4 unconditionally catches every FORAGER, nest or surface,
// before execution could ever fall through to them.
import type { Ant } from "./ant";
import type { Perception } from "./senses";
import type { ChamberRole } from "../world/nest";
import type { Position } from "../world/grid";
import { decideForager } from "./foraging";
import { decideUndertaker } from "./undertaking";
import { HUNGER_THRESHOLD, NURSE_EGG_CAPACITY } from "../params";

export type Action =
    | { type: "goto"; role: ChamberRole }
    | { type: "pickUpEgg" }
    | { type: "placeEgg" }
    | { type: "eat" }
    | { type: "mill" }
    | { type: "crossExit" }
    | { type: "pickUpFood" }
    | { type: "depositFood" }
    | { type: "surfaceStep"; target: Position }
    | { type: "surfaceWander" }
    | { type: "moveToNestPoint"; target: Position }
    | { type: "pickUpCorpse" }
    | { type: "dropCorpse" }
    | { type: "clearUndertaking" };

export function decide(ant: Ant, perception: Perception): Action {
    // Rule 0: a non-forager on the surface with no active undertaking is
    // stranded — the only way a NURSE ends up out here is having just
    // finished a corpse haul (decideUndertaker's dropCorpse clears
    // `undertaking` while the ant is still surface-side). Route it back to
    // the hole. Foragers skip this: rule 5 hands them to decideForager,
    // which has its own surface->home logic; an undertaking ant skips it too
    // (rule 3 owns it until the body is buried).
    if (perception.where === "surface" && ant.job !== "FORAGER" && !ant.undertaking) {
        return perception.atHole ? { type: "crossExit" } : { type: "surfaceStep", target: perception.holePos };
    }

    // Rule 1: carrying an egg — get it to the nursery.
    if (perception.carrying.length > 0) {
        return perception.currentChamber === "NURSERY" ? { type: "placeEgg" } : { type: "goto", role: "NURSERY" };
    }

    // Rule 2: hungry — go eat, wherever else you were headed. Explicitly
    // nest-only now: a surface ant can't reach the nest's food store, so
    // being hungry there means something else entirely — decideForager's
    // own edge case (head for the hole) handles that instead.
    if (perception.hungerRatio < HUNGER_THRESHOLD && perception.where === "nest") {
        return perception.currentChamber === "FOOD_STORAGE" ? { type: "eat" } : { type: "goto", role: "FOOD_STORAGE" };
    }

    // Rule 3: undertaking overrides the base job entirely. Placed after
    // hunger (a hungry undertaker eats first — in practice a haul is far
    // shorter than it takes to starve, so this ordering is mostly academic,
    // but it's free to get right) and before rules 3/4, since undertaking is
    // a transient override on top of NURSE or FORAGER, not a third
    // coequal job — an undertaking ant should never fall through to its
    // base job's own rules while the override is active.
    if (ant.undertaking) {
        return decideUndertaker(perception);
    }

    // Rule 4: a nurse with room to carry more and eggs waiting — go collect
    // one.
    if (
        ant.job === "NURSE" &&
        perception.carrying.length < NURSE_EGG_CAPACITY &&
        perception.eggsAvailableInQueenChamber
    ) {
        return perception.currentChamber === "QUEEN" ? { type: "pickUpEgg" } : { type: "goto", role: "QUEEN" };
    }

    // Rule 5: any forager, nest or surface, hands off entirely to
    // foraging.ts's own state machine — the round trip has too many
    // location-dependent branches to fit this file's "resolve to one
    // chamber" shape. Unconditionally catches every FORAGER before rule 5
    // could ever apply to one.
    if (ant.job === "FORAGER") {
        return decideForager(ant, perception);
    }

    // Rule 6: nothing else applies — a nurse with no eggs waiting and
    // nothing to carry. Only ever reached by a NURSE, since every FORAGER
    // was already caught by rule 4.
    return perception.currentChamber === "COMMONS" ? { type: "mill" } : { type: "goto", role: "COMMONS" };
}