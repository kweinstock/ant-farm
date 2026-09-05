// Pre-adult pipeline: EGG -> LARVA -> PUPA -> ADULT with per-stage timers scaled
// by chamber temperature/humidity (nurses move brood between chambers to
// optimize — see ants/jobs.ts). Larvae must be fed by nurses or they die.
// On eclosion, creates an Ant (ants/ant.ts) with traits from genetics/inheritance.ts
// and a name from names/generator.ts; emits Birth.

import { randomInt } from "../rng";
import type { Ant } from "../ants/ant";
import { createWorker } from "../ants/ant";
import { ColonyState, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS } from "../state";
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
    tendedThisTick: boolean;
}

export function layEgg(state: ColonyState): Brood {
    const queen = state.ants.get(state.queenId);
    const position: Position = queen ? queen.position : {x: 0, y: 0};

    return {
        id: `brood-${state.nextBroodId}`,
        stage: "EGG",
        progressTicks: 0,
        position,
        tendedThisTick: false,
    };
}

export function advanceBrood(state: ColonyState): {brood: Brood[]; newAdults: Ant[]; rngSeed: number} {
    const newAdults: Ant[] = [];
    const remainingBrood: Brood[] = [];

    let nextAntId = state.nextAntId;
    let rngSeed = state.rngSeed;

    // Falls back to (0,0) only if the queen is already gone — a degenerate,
    // queenless colony that's winding down anyway (no new eggs, just existing
    // brood finishing). Not worth a real "nursery tile" concept until
    // world/nest.ts chambers exist.
    const queen = state.ants.get(state.queenId);
    const nurseryPosition: Position = queen ? queen.position : {x: 0, y: 0};

    for (const entry of state.brood) {
        if (entry.stage === "EGG") {
            const progressTicks = entry.progressTicks + 1;
            remainingBrood.push(progressTicks >= EGG_DURATION_TICKS 
                ? {...entry, stage: "LARVA", progressTicks: 0, tendedThisTick: false}
                : {...entry, progressTicks, tendedThisTick: false}
            );
            continue;
        }

        if (entry.stage === "LARVA") {
            const progressTicks = entry.tendedThisTick ? entry.progressTicks + 1 : entry.progressTicks;
            remainingBrood.push(progressTicks >= LARVA_DURATION_TICKS
                ? {...entry, stage: "PUPA", progressTicks: 0, tendedThisTick: false}
                : {...entry, progressTicks, tendedThisTick: false}
            );
            continue;
        }

        // PUPA
        const progressTicks = entry.progressTicks + 1;

        if (progressTicks >= PUPA_DURATION_TICKS) {
            const antId = `ant-${nextAntId}`;
            nextAntId += 1;
            const lifespanResult = randomInt(rngSeed, MIN_LIFESPAN_TICKS, MAX_LIFESPAN_TICKS);
            rngSeed = lifespanResult.seed;

            newAdults.push(createWorker(antId, nurseryPosition, lifespanResult.value));
        } else {
            remainingBrood.push({...entry, progressTicks, tendedThisTick:false});
        }
    }

    return {
        brood: remainingBrood,
        newAdults,
        rngSeed,
    };
}