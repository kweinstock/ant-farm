// The rule engine: a short ordered list of cross-cutting rules (stranded,
// hunger, undertaking), then a handoff to the job-specific state machine —
// decideNurse / decideForager / decideUndertaker, one file each. First match
// wins. Pure: no RNG, no state mutation. The queen is never passed through
// this.
import type { Ant } from "./ant";
import type { Perception } from "./senses";
import type { ChamberRole } from "../world/nest";
import type { Position } from "../world/grid";
import { decideForager } from "./foraging";
import { decideUndertaker } from "./undertaking";
import { decideNurse } from "./nursing";
import { HUNGER_THRESHOLD, SLEEP_CYCLE_TICKS, SLEEP_DURATION_TICKS } from "../params";

export type Action =
    | { type: "goto"; role: ChamberRole }
    | { type: "pickUpEgg" }
    | { type: "placeEgg" }
    | { type: "eat" }
    | { type: "eatFromPile" }
    | { type: "mill" }
    | { type: "crossExit" }
    | { type: "pickUpFood" }
    | { type: "depositFood" }
    | { type: "surfaceStep"; target: Position }
    | { type: "surfaceRoute"; target: Position }
    | { type: "noteBarrenPatch"; target: Position; patchIndex: number }
    | { type: "surfaceWander" }
    | { type: "moveToNestPoint"; target: Position }
    | { type: "pickUpCorpse" }
    | { type: "dropCorpse" }
    | { type: "clearUndertaking" }
    | { type: "tendBrood" }
    | { type: "feedQueen" }
    | {type: "sleep" };

export function isSleepy(ant: Ant): boolean {
    // ticksAwake alone, NOT (ticksAwake + sleepPhase): sleepPhase already did
    // its one job at birth, seeding ticksAwake's starting value (ant.ts) so
    // founding ants don't all nap in lockstep. ticksAwake resets to 0 on
    // every wake, so re-adding the constant sleepPhase here would make an
    // ant born with a high phase satisfy this threshold again the instant it
    // wakes (0 + that same phase), sleeping forever.
    return ant.ticksAwake % SLEEP_CYCLE_TICKS >= SLEEP_CYCLE_TICKS - SLEEP_DURATION_TICKS;
}

export function decide(ant: Ant, perception: Perception): Action {
    // Rule 1: hungry — go eat, wherever else you were headed. Nest-only: a
    // surface ant can't reach the store, and decideForager handles a hungry
    // forager out there. Two carve-outs stay out of "eat first":
    //  - a nurse carrying eggs (perception.carrying) delivers them first — an
    //    egg riding a hungry nurse into the food store helps no one;
    //  - a forager home with food deposits first, or a starving colony
    //    deadlocks with every forager looping at an empty store while still
    //    holding the 100 that would refill it.
    if (
        perception.hungerRatio < HUNGER_THRESHOLD &&
        perception.where === "nest" &&
        perception.carrying.length === 0 &&
        !(ant.job === "FORAGER" && ant.carryingFood > 0)
    ) {
        return perception.currentChamber === "FOOD_STORAGE" ? { type: "eat" } : { type: "goto", role: "FOOD_STORAGE" };
    }

    // Rule 2: sleep — nest-only, unburdened, not mid-undertaking; a laden or
    // surface ant just runs its normal job logic and sleeps a tick or two
    // later once it's home and clear. Naps happen in a rest chamber
    // (COMMONS, or NURSERY for a nurse); everyone else heads to COMMONS
    // first, which is what produces clusters of resting ants.
    if (
        isSleepy(ant) &&
        perception.where === "nest" &&
        ant.carrying.length === 0 &&
        ant.carryingFood === 0 &&
        !ant.undertaking
    ) {
        const inRestChamber = perception.currentChamber === "COMMONS" ||
            (ant.job === "NURSE" && perception.currentChamber === "NURSERY");
        return inRestChamber ? { type: "sleep" } : { type: "goto", role: "COMMONS" };
    }

    // Rule 3: undertaking is a transient override on top of NURSE or FORAGER
    // — an undertaking ant never falls through to its base job's rules while
    // the override is active. After hunger (a hungry undertaker eats first),
    // which in practice never matters — a haul is far shorter than starving.
    if (ant.undertaking) {
        return decideUndertaker(perception);
    }

    // Rule 4: hand off to the job-specific state machine. One file each:
    // nursing.ts (ferry eggs + tend brood), foraging.ts (the surface round
    // trip). Workers are only ever NURSE or FORAGER, so the final branch is
    // exhaustive; the mill fallback is just a total-function guard.
    if (ant.job === "NURSE") {
        return decideNurse(ant, perception);
    }
    if (ant.job === "FORAGER") {
        return decideForager(ant, perception);
    }

    return perception.currentChamber === "COMMONS" ? { type: "mill" } : { type: "goto", role: "COMMONS" };
}