// Per-ant food memory (decision 5, Phase 4; extended Phase 7 review).
//
// Two lists, both short-lived and individual-within-a-lifetime — no
// heritable learning, no route counters (that needs genetics, Phase 9):
//
//   foodSites   — tiles where this ant actually picked food up. It heads
//                 back to the freshest one, but senses.ts only offers it a
//                 site that STILL has a pile, so a drained spot drops out of
//                 routing on its own.
//   emptyPatches — patches this ant walked into and found bare. For
//                 EMPTY_PATCH_TTL_TICKS it won't pick that patch again as a
//                 fresh exploration target, so a colony spreads across the
//                 ring instead of every forager piling onto whichever patch
//                 it happened to find first.
import type { Position } from "../world/grid";
import { MAX_REMEMBERED, MEMORY_TTL_TICKS, EMPTY_PATCH_TTL_TICKS, MAX_EMPTY_PATCHES_REMEMBERED, PATCH_QUALITY_EMA_ALPHA, MAX_PREDATOR_SIGHTINGS, PREDATOR_SIGHTING_TTL_TICKS, PATCH_QUALITY_RICHNESS_WEIGHT, PREDATOR_SIGHTING_RICHNESS_WEIGHT, ABSORB_MAX_TRANSFER, LEARNING_BASELINE, LEARNING_MIN, LEARNING_MAX, REINFORCE_STEP } from "../params";

export type LearningWeights = {
    trailTrust: number;
    memoryTrust: number;
    patchTrust: number;
    fleeSensitivity: number;
}

export type AntMemory = {
    foodSites: { pos: Position; tick: number }[];
    emptyPatches: { patchIndex: number; tick: number }[];
    patchQuality: Record<number, number>;
    predatorSightings: {pos: Position; tick: number}[];
    learning: LearningWeights;
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function emptyMemory(): AntMemory {
    return {
        foodSites: [],
        emptyPatches: [],
        patchQuality: {},
        predatorSightings: [],
        learning: {
            trailTrust: LEARNING_BASELINE,
            memoryTrust: LEARNING_BASELINE,
            patchTrust: LEARNING_BASELINE,
            fleeSensitivity: LEARNING_BASELINE,
        },
    };
}

export function rememberFoodSite(memory: AntMemory, pos: Position, tick: number): AntMemory {
    const deduped = memory.foodSites.filter((site) => !(site.pos.x === pos.x && site.pos.y === pos.y));
    const foodSites = [{ pos, tick }, ...deduped].slice(0, MAX_REMEMBERED);

    return { ...memory, foodSites };
}

export function rememberEmptyPatch(memory: AntMemory, patchIndex: number, tick: number): AntMemory {
    const deduped = memory.emptyPatches.filter((e) => e.patchIndex !== patchIndex);
    const emptyPatches = [{ patchIndex, tick }, ...deduped].slice(0, MAX_EMPTY_PATCHES_REMEMBERED);

    return { ...memory, emptyPatches };
}

export function patchKnownEmpty(memory: AntMemory, patchIndex: number, nowTick: number): boolean {
    return memory.emptyPatches.some(
        (e) => e.patchIndex === patchIndex && nowTick - e.tick < EMPTY_PATCH_TTL_TICKS,
    );
}

// Freshest un-expired remembered food site for which `stillHasFood` is true —
// the caller (senses.ts) checks the live pile list, so a site that's been
// drained since the ant last saw it is simply skipped.
export function bestRememberedSite(
    memory: AntMemory,
    nowTick: number,
    stillHasFood: (pos: Position) => boolean,
): Position | undefined {
    let best: { pos: Position; tick: number } | undefined;

    for (const site of memory.foodSites) {
        if (nowTick - site.tick >= MEMORY_TTL_TICKS) continue;
        if (!stillHasFood(site.pos)) continue;
        if (best === undefined || site.tick > best.tick) {
            best = site;
        }
    }

    return best?.pos;
}

export function updatePatchQuality(memory: AntMemory, patchIndex: number, amountPickedUp: number): AntMemory {
    const prior = memory.patchQuality[patchIndex] ?? amountPickedUp;
    const next = prior + PATCH_QUALITY_EMA_ALPHA * (amountPickedUp - prior);

    return { ...memory, patchQuality: { ...memory.patchQuality, [patchIndex]: next } };
}

export function rememberPredatorSighting(memory: AntMemory, pos: Position, tick: number): AntMemory {
    const predatorSightings = [{ pos, tick }, ...memory.predatorSightings].slice(0, MAX_PREDATOR_SIGHTINGS);
    return { ...memory, predatorSightings };
}

export function richness(memory: AntMemory, nowTick: number): number {
    let score = 0;

    for (const site of memory.foodSites) {
        const age = nowTick - site.tick;
        if (age < MEMORY_TTL_TICKS) {
            score += 1 - age / MEMORY_TTL_TICKS;
        }
    }

    score += Object.keys(memory.patchQuality).length * PATCH_QUALITY_RICHNESS_WEIGHT;

    for (const sighting of memory.predatorSightings) {
        const age = nowTick - sighting.tick;
        if (age < PREDATOR_SIGHTING_TTL_TICKS) {
            score += (1 - age / PREDATOR_SIGHTING_TTL_TICKS) * PREDATOR_SIGHTING_RICHNESS_WEIGHT;
        }
    }

    return score;
}

export function absorb(poorer: AntMemory, richer: AntMemory, tick: number): AntMemory {
    const newFoodSites = richer.foodSites
        .filter((rs) => !poorer.foodSites.some((ps) => ps.pos.x === rs.pos.x && ps.pos.y === rs.pos.y))
        .slice(0, ABSORB_MAX_TRANSFER)
        .map((s) => ({ pos: s.pos, tick }));
    const foodSites = [...newFoodSites, ...poorer.foodSites].slice(0, MAX_REMEMBERED);

    const newEmptyPatches = richer.emptyPatches
        .filter((re) => !poorer.emptyPatches.some((pe) => pe.patchIndex === re.patchIndex))
        .slice(0, ABSORB_MAX_TRANSFER)
        .map((e) => ({ patchIndex: e.patchIndex, tick }));
    const emptyPatches = [...newEmptyPatches, ...poorer.emptyPatches].slice(0, MAX_EMPTY_PATCHES_REMEMBERED);

    const patchQuality = { ...poorer.patchQuality };
    let patchesTransferred = 0;
    for (const key of Object.keys(richer.patchQuality)) {
        if (patchesTransferred >= ABSORB_MAX_TRANSFER) break;
        const idx = Number(key);
        if (!(idx in patchQuality)) {
            patchQuality[idx] = richer.patchQuality[idx];
            patchesTransferred += 1;
        }
    }

    const newSightings = richer.predatorSightings
        .filter(
            (rs) =>
                !poorer.predatorSightings.some((ps) => ps.pos.x === rs.pos.x && ps.pos.y === rs.pos.y),
        )
        .slice(0, ABSORB_MAX_TRANSFER)
        .map((s) => ({ pos: s.pos, tick }));
    const predatorSightings = [...newSightings, ...poorer.predatorSightings].slice(0, MAX_PREDATOR_SIGHTINGS);

    return { ...poorer, foodSites, emptyPatches, patchQuality, predatorSightings };
}

export function reinforce(learning: LearningWeights, source: "trail" | "memory" | "patch" | "visible", outcome: "success" | "failure"): LearningWeights {
    if (source === "visible") {
        return learning;
    }

    const key: keyof LearningWeights = source === "trail" ? "trailTrust" : source === "memory" ? "memoryTrust" : "patchTrust";
    const delta = outcome === "success" ? REINFORCE_STEP : -REINFORCE_STEP;

    return { ...learning, [key]: clamp(learning[key] + delta, LEARNING_MIN, LEARNING_MAX) };
}