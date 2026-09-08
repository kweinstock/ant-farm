// End-of-tick resolution for adults: burn energy (movement + metabolism trait),
// starvation damage when energy hits zero, old-age death roll as ageTicks
// approaches lifespanTicks, cold-death checks in WINTER/COLD_SNAP. Produces
// Death events, frees the ant from state.ants, and hands lineage/extinction
// bookkeeping to genetics/lineage.ts. Also triggers job reassignment on age
// thresholds.
//
// PHASE 4: this is NOT the only way a worker can die anymore. index.ts's
// worker loop calls this first, and — only if the ant is still alive after
// it — separately rolls a surface hazard death (SURFACE_DEATH_CHANCE) for
// any worker standing on the surface that tick. That roll deliberately
// stays out of this function: ageAndMeter is RNG-free (decision 3), so it
// can be called and reasoned about without threading rngSeed through it —
// only index.ts, which already owns rngSeed for the tick, needs to know
// about that second way to die.
import { METABOLISM_COST, NURSE_AGE_THRESHOLD_TICKS } from "../params";
import type { Ant } from "./ant";
import { assignJob } from "./jobs";


export function ageAndMeter(ant: Ant): {ant: Ant, isDead: boolean} {
    const ageTicks = ant.ageTicks + 1;

    // The queen doesn't burn energy yet. She's not in the worker
    // sense->decide->act loop, so nothing refills her, and metabolising would
    // just starve her on a fixed timer (STARTING_ENERGY / METABOLISM_COST).
    // A later phase adds trophallaxis (foragers/nurses feeding her); until
    // then she doesn't metabolise, but she still ages and dies of old age
    // (QUEEN_*_LIFESPAN_TICKS), which the colony has no answer for until
    // colony/caste.ts raises a replacement.
    const energy = ant.caste === "QUEEN" ? ant.energy : ant.energy - METABOLISM_COST;
    const isDead = energy <= 0 || ageTicks >= ant.lifespanTicks;

    const crossedThreshold = ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS && ageTicks >= NURSE_AGE_THRESHOLD_TICKS;

    const job = ant.caste === "WORKER" && crossedThreshold ? assignJob({...ant, ageTicks}) : ant.job

    return {
        ant: {...ant, ageTicks, energy, job},
        isDead,
    };
}