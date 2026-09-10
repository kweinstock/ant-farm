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
import { MAX_REMEMBERED, MEMORY_TTL_TICKS, EMPTY_PATCH_TTL_TICKS, MAX_EMPTY_PATCHES_REMEMBERED } from "../params";

export type AntMemory = {
    foodSites: { pos: Position; tick: number }[];
    emptyPatches: { patchIndex: number; tick: number }[];
};

export function emptyMemory(): AntMemory {
    return { foodSites: [], emptyPatches: [] };
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
