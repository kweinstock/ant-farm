// Maintains cached population counts by caste, job, age band, and life stage, so
// the HUD and balance logic never scan every ant. Recomputed incrementally on
// birth/death/reassignment. Feeds Stats DTO (shared/protocol.ts).

import type { ColonyState } from "../state";

export type Demography = {
    population: number;
    nurses: number;
    foragers: number;
    broodCount: number;
    asleep: number;
    awakeNurses: number;
    awakeForagers: number;
};

export function getDemography(state: ColonyState): Demography {
    let nurses = 0;
    let foragers = 0;
    let asleep = 0;
    let awakeNurses = 0;
    let awakeForagers = 0;

    for (const ant of state.ants.values()) {
        if (ant.asleep) {
            asleep += 1;
        }

        if (ant.caste !== "WORKER") {
            continue;
        }

        if (ant.job === "NURSE") {
            nurses += 1;
            if (!ant.asleep) awakeNurses += 1;
        } else if (ant.job === "FORAGER") {
            foragers += 1;
            if (!ant.asleep) awakeForagers += 1;
        }
    }

    return {
        population: state.ants.size,
        nurses,
        foragers,
        broodCount: state.brood.length,
        asleep, 
        awakeNurses,
        awakeForagers,
    };
}
