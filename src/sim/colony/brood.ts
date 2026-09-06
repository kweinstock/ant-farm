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
import { chamberAt, tilesOf } from "../world/nest";
import type { Position } from "../world/grid";

const EGG_DURATION_TICKS = 30;
const LARVA_DURATION_TICKS = 60;
const PUPA_DURATION_TICKS = 50;


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
    const position: Position = queen ? queen.position : {x: 0, y: 0};

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

    const nurseryTiles = tilesOf(state.nest, "NURSERY");
    // Any nursery tile works as an eclosion spawn point — one physical room,
    // not meaningfully different spots, same reasoning state.ts uses for the
    // queen's own starting tile. Falls back to (0,0) only in the degenerate
    // case of an empty NURSERY chamber, which the hand-authored layout never
    // actually produces.
    const eclosionPosition: Position = nurseryTiles[0] ?? {x: 0, y: 0}

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
            remainingBrood.push(progressTicks >= EGG_DURATION_TICKS 
                ? {...entry, stage: "LARVA", progressTicks: 0}
                : {...entry, progressTicks}
            );
            continue;
        }

        if (entry.stage === "LARVA") {
            const progressTicks = entry.progressTicks + 1;
            remainingBrood.push(progressTicks >= LARVA_DURATION_TICKS
                ? {...entry, stage: "PUPA", progressTicks: 0}
                : {...entry, progressTicks}
            );
            continue;
        }

        // PUPA
        const progressTicks = entry.progressTicks + 1;

        if (progressTicks >= PUPA_DURATION_TICKS) {
            const antId = `ant-${nextAntId}`;
            nextAntId += 1;

            const newAdult = createWorker(antId, eclosionPosition, rngSeed)
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