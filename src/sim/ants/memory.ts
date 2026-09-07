// Per-ant food memory (decision 5, Phase 4). Deliberately narrower than this
// file's original stub suggested: no pathStats (route success/failure
// counters), no dangerSpots, no quality field, and no heritable learning
// rate — those all implied more machinery than this phase wants. Phase 4's
// learning is individual-within-a-lifetime only: a worker remembers a
// handful of tiles that had food, forgets them after a while, and that's
// it. "Over generations" needs genetics (Phase 9) to make anything
// heritable; test/sim/learning.test.ts measures the collective (trail
// network, pheromones.ts) + individual (this file) effect within one run,
// not a generational trend.
//
// Implicit-success-only, per decision 5: a site is remembered exactly when
// pickUpFood actually finds a pile there (ants/foraging.ts calls
// rememberFoodSite from inside that handler) — there's no separate
// "route worked" signal to track, so nothing here needs a counter.
import type { Position } from "../world/grid";

// UNTUNED STARTING POINTS, same spirit as pheromones.ts's constants.
// MAX_REMEMBERED (3) is decision 5's own number. MEMORY_TTL_TICKS is sized
// against world/surface.ts's PILE_DECAY_TICKS (400) — a remembered site is
// "a place that had food," and once the pile there has had time to fully
// decay, walking back to it on memory alone is more likely to waste a trip
// than pay off. Set a bit below PILE_DECAY_TICKS rather than equal to it,
// since remembering happens at the moment of a successful pickup, which is
// itself already sometime after the pile spawned at ageTicks: 0.
export const MAX_REMEMBERED = 3;
export const MEMORY_TTL_TICKS = 300;

export type AntMemory = {
    foodSites: { pos: Position; tick: number }[];
};

export function emptyMemory(): AntMemory {
    return { foodSites: [] };
}

export function rememberFoodSite(memory: AntMemory, pos: Position, tick: number): AntMemory {
    const deduped = memory.foodSites.filter((site) => !(site.pos.x === pos.x && site.pos.y === pos.y));
    const foodSites = [{ pos, tick }, ...deduped].slice(0, MAX_REMEMBERED);

    return { ...memory, foodSites };
}


export function bestRememberedSite(memory: AntMemory, nowTick: number): Position | undefined {
    let best: { pos: Position; tick: number } | undefined;

    for (const site of memory.foodSites) {
        if (nowTick - site.tick >= MEMORY_TTL_TICKS) {
            continue;
        }
        if (best === undefined || site.tick > best.tick) {
            best = site;
        }
    }

    return best?.pos;
}
