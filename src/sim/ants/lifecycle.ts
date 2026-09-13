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
import { METABOLISM_COST, QUEEN_METABOLISM_COST, NURSE_AGE_THRESHOLD_TICKS, SLEEP_METABOLISM_MULT } from "../params";
import type { Ant } from "./ant";
import { assignJob } from "./jobs";

// The two RNG-free ways an ant can die at end-of-tick. `undefined` = survived
// this metering pass (it may still die to a surface-hazard / predator / cold
// roll back in index.ts, which owns the rng). Returned explicitly so callers
// don't have to re-derive "was it age or energy?" from the metered ant and
// risk disagreeing with the check here.
export type MeterDeath = "oldAge" | "starvation" | undefined;

export function ageAndMeter(ant: Ant): { ant: Ant; isDead: boolean; cause: MeterDeath } {
    const ageTicks = ant.ageTicks + 1;

    // The queen metabolises too, but slowly (QUEEN_METABOLISM_COST). She's
    // not in the worker sense->decide->act loop so she can't feed herself —
    // returning foragers hand her food via trophallaxis (Phase 8, the
    // feedQueen action). Underfed, she now starves; otherwise she still
    // reaches old age first (QUEEN_*_LIFESPAN_TICKS), which the colony has no
    // answer for until colony/caste.ts raises a replacement.
    //
    // Phase 9: a sleeping ant's cost is scaled by SLEEP_METABOLISM_MULT
    // (queen included, off her own QUEEN_METABOLISM_COST) — this function
    // stays RNG-free, it just reads the asleep flag jobs.ts/queen.ts set.
    const baseCost = ant.caste === "QUEEN" ? QUEEN_METABOLISM_COST : METABOLISM_COST
    const energy = ant.energy - (ant.asleep ? baseCost * SLEEP_METABOLISM_MULT : baseCost);

    // Starvation is checked first: an ant that has run its energy to zero is
    // dead of starvation even if it also happens to be at its lifespan.
    const cause: MeterDeath = energy <= 0 ? "starvation" : ageTicks >= ant.lifespanTicks ? "oldAge" : undefined;

    const crossedThreshold = ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS && ageTicks >= NURSE_AGE_THRESHOLD_TICKS;

    const job = ant.caste === "WORKER" && crossedThreshold ? assignJob({...ant, ageTicks}) : ant.job

    const ticksAwake = ant.asleep ? ant.ticksAwake : ant.ticksAwake + 1;

    return {
        ant: {...ant, ageTicks, energy, job, ticksAwake},
        isDead: cause !== undefined,
        cause,
    };
}