// Maintains cached population counts by caste, job, age band, and life stage, so
// the HUD and balance logic never scan every ant. Recomputed incrementally on
// birth/death/reassignment. Feeds Stats DTO (shared/protocol.ts).

import type { ColonyState } from "../state";

export type Demography = {
    population: number;
    nurses: number;
    foragers: number;
    broodCount: number;
};

export function getDemography(state: ColonyState): Demography {
    let nurses = 0;
    let foragers = 0;

    for (const ant of state.ants.values()) {
        if (ant.caste !== "WORKER") {
            continue;
        }

        if (ant.job === "NURSE") {
            nurses += 1;
        } else if (ant.job === "FORAGER") {
            foragers += 1;
        }
    }

    return {
        population: state.ants.size,
        nurses,
        foragers,
        broodCount: state.brood.length,
    };
}
