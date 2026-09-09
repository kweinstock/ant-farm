// Pre-adult pipeline: EGG -> LARVA -> PUPA -> ADULT. Phase 3a: position now
// actually matters (queen chamber -> carried -> nursery tile) instead of
// being cosmetic, and tending is gone entirely — the bottleneck is now a
// nurse physically carrying each egg to the NURSERY, not per-tick attention
// once it's there. No caps enforced here: the nurse-carrying cap (3) lives
// in behavior.ts/jobs.ts, the nursery-tile cap (3) lives in jobs.ts's
// placeEgg. This file just runs timers on whatever is currently placed.

import type { Ant, AntId } from "../ants/ant";
import { createWorker } from "../ants/ant";
import type { ColonyState } from "../state";
import { chamberAt } from "../world/nest";
import type { Position } from "../world/grid";
import { EGG_DURATION_TICKS, LARVA_DURATION_TICKS, PUPA_DURATION_TICKS } from "../params";
import { broodSpeed } from "../environment/season";


export type BroodStage = "EGG" | "LARVA" | "PUPA";
export type BroodId = string;

export type Brood = {
    id: BroodId;
    stage: BroodStage;
    progressTicks: number;
    position: Position;
    carriedBy?: AntId;
}

export function layEgg(state: ColonyState): Brood {
    const queen = state.ants.get(state.queenId);
    // Queen is always in the nest, so location.pos is a nest tile — an egg is
    // laid wherever she's standing (a QUEEN-chamber tile).
    const position: Position = queen ? queen.location.pos : {x: 0, y: 0};

    return {
        id: `brood-${state.nextBroodId}`,
        stage: "EGG",
        progressTicks: 0,
        position,
        carriedBy: undefined,
    };
}

export function advanceBrood(state: ColonyState): {brood: Brood[]; newAdults: Ant[]; rngSeed: number} {
    const newAdults: Ant[] = [];
    const remainingBrood: Brood[] = [];

    let nextAntId = state.nextAntId;
    let rngSeed = state.rngSeed;

    const speed = broodSpeed(state.env.season);
    const eggDuration = EGG_DURATION_TICKS / speed;
    const larvaDuration = LARVA_DURATION_TICKS / speed;
    const pupaDuration = PUPA_DURATION_TICKS / speed;

    for (const entry of state.brood) {
        const isPlaced = entry.carriedBy === undefined && chamberAt(state.nest, entry.position) === "NURSERY";

        if (!isPlaced) {
            // Still sitting uncarried in the QUEEN chamber, or currently
            // being walked somewhere by a nurse — either way, no progress
            // this tick. This is the actual bottleneck this phase is built
            // around: physical placement unlocks development, not time
            // alone.
            remainingBrood.push(entry);
            continue; 
        }

        if (entry.stage === "EGG") {
            const progressTicks = entry.progressTicks + 1;
            remainingBrood.push(progressTicks >= eggDuration 
                ? {...entry, stage: "LARVA", progressTicks: 0}
                : {...entry, progressTicks}
            );
            continue;
        }

        if (entry.stage === "LARVA") {
            const progressTicks = entry.progressTicks + 1;
            remainingBrood.push(progressTicks >= larvaDuration
                ? {...entry, stage: "PUPA", progressTicks: 0}
                : {...entry, progressTicks}
            );
            continue;
        }

        // PUPA
        const progressTicks = entry.progressTicks + 1;

        if (progressTicks >= pupaDuration) {
            const antId = `ant-${nextAntId}`;
            nextAntId += 1;

            // Eclose exactly where the pupa was — that tile is a NURSERY tile
            // by the isPlaced guard above. Phase 6: with multiple nurseries a
            // fixed "first nursery tile" spawn point teleported every newborn
            // to NURSERY-0 no matter which nursery it developed in.
            const newAdult = createWorker(antId, { ...entry.position }, rngSeed)
            rngSeed = newAdult.seed;
            newAdults.push(newAdult.ant);
            // Not pushed to remainingBrood — this entry is gone, replaced by
            // the adult above, which frees its nursery tile for whatever
            // egg gets placed there next.
        } else {
            remainingBrood.push({...entry, progressTicks});
        }
    }

    return {
        brood: remainingBrood,
        newAdults,
        rngSeed,
    };
}