// Colony-level job allocation, run once per tick (index.ts) after births.
//
// Nurse count follows the brood, not age: one nurse per NURSE_BROOD_PER_NURSE
// brood entries, capped so there are never more nurses than foragers (i.e. at
// most half the workers). The nurses are the OLDEST workers — young ants do
// the foraging, older ants stay in and mind the nursery.
//
// ants/jobs.ts's assignJob still sets a worker's job at eclosion, but this
// pass overrides it every tick, so a colony whose founding cohort has aged
// out still keeps a nursery staffed (a bare age cutoff deadlocks: no nurses
// -> brood dies -> no new nurses eclose).
//
// Deterministic: stable sort by (ageTicks desc, id), no RNG. A forager out on
// the surface can be recalled to nursing — behavior.ts rule 0 / decideNurse
// walks a stranded nurse home. That wastes the trip, but a colony short on
// brood care needs the hands.

import type { Ant, AntId, Job } from "../ants/ant";
import type { ColonyState } from "../state";
import { NURSE_BROOD_PER_NURSE } from "../params";

export function desiredNurseCount(broodLoad: number, totalWorkers: number): number {
    if (totalWorkers <= 0) return 0;

    const forBrood = Math.ceil(Math.max(broodLoad, 0) / NURSE_BROOD_PER_NURSE);
    // Never more nurses than foragers: cap at half the workforce.
    const ceiling = Math.floor(totalWorkers / 2);

    return Math.min(forBrood, ceiling);
}

export function reassignJobs(state: ColonyState): Map<AntId, Ant> {
    // Every brood entry needs a nurse — eggs in the queen chamber need
    // ferrying, placed brood needs tending — so key off the whole brood
    // count, not just what's landed in the nursery.
    const broodLoad = state.brood.length;

    const workers = [...state.ants.values()]
        .filter((a) => a.caste === "WORKER")
        .sort((a, b) => b.ageTicks - a.ageTicks || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    if (workers.length === 0) return state.ants;

    const target = desiredNurseCount(broodLoad, workers.length);

    let changed = false;
    const next = new Map(state.ants);
    workers.forEach((ant, i) => {
        const job: Job = i < target ? "NURSE" : "FORAGER";
        if (ant.job !== job) {
            next.set(ant.id, { ...ant, job });
            changed = true;
        }
    });

    return changed ? next : state.ants;
}
