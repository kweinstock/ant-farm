// End-of-tick resolution for adults: burn energy (movement + metabolism trait),
// starvation damage when energy hits zero, old-age death roll as ageTicks
// approaches lifespanTicks, cold-death checks in WINTER/COLD_SNAP. Produces
// Death events, frees the ant from state.ants, and hands lineage/extinction
// bookkeeping to genetics/lineage.ts. Also triggers job reassignment on age
// thresholds.

import type { Ant } from "./ant";
import { NURSE_AGE_THRESHOLD_TICKS, assignJob } from "./jobs";

const METABOLISM_COST = 1;

export function ageAndMeter(ant: Ant): {ant: Ant, isDead: boolean} {
    const ageTicks = ant.ageTicks + 1;

    // The queen doesn't burn energy YET. She's not in the worker
    // sense->decide->act loop, so nothing refills her, and metabolising would
    // just starve her on a fixed timer (STARTING_ENERGY / METABOLISM_COST).
    // Phase 4 adds the real mechanic: foragers carry food to her (trophallaxis).
    // Until then she doesn't metabolise — but she still ages and dies of old
    // age (QUEEN_*_LIFESPAN_TICKS), which the colony has no answer for until
    // colony/caste.ts raises a replacement in a later phase.
    const energy = ant.caste === "QUEEN" ? ant.energy : ant.energy - METABOLISM_COST;
    const isDead = energy <= 0 || ageTicks >= ant.lifespanTicks;

    const crossedThreshold = ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS && ageTicks >= NURSE_AGE_THRESHOLD_TICKS;

    const job = ant.caste === "WORKER" && crossedThreshold ? assignJob({...ant, ageTicks}) : ant.job

    return {
        ant: {...ant, ageTicks, energy, job},
        isDead,
    };
}