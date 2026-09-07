// Corpses + the undertaker override. A dead ant (ants/lifecycle.ts, wired in
// file 9) leaves a Corpse behind at its death spot instead of just
// vanishing. Corpses are small and self-cleaning: up to ~2 per tile is pure
// render flavor (no occupancy mechanic — see world/surface.ts's graveyard,
// decision 4), and CORPSE_DECAY_TICKS is the one real bound, so a stalled or
// dying colony can't leak corpse entities forever even if no undertaker
// ever reaches them.
//
// Undertaking is a transient override on an ant (Ant.undertaking?, added in
// ants/ant.ts, file 4), not a Job value — job stays the stable age-based
// NURSE/FORAGER, and when undertaking clears, decide() just falls back to
// whatever job already was. assignUndertakers below is what sets that
// override; ants/undertaking.ts (file 7) is what an undertaking ant
// actually does tick to tick.
import { rng } from "./rng";
import { manhattanDistance } from "./world/grid";
import { inGraveyard, type Surface } from "./world/surface";
import type { Ant, AntId, AntLocation } from "./ants/ant";
import type { ColonyState } from "./state";

// UNTUNED STARTING POINTS, same spirit as world/surface.ts's pile params —
// expect to revisit after watching a run with natural deaths in it.
// CORPSE_DECAY_TICKS is deliberately generous: longer than any plausible
// haul (nest depth + graveyard walk is nowhere near this), so it only ever
// fires as the leak-prevention backstop, not as a normal outcome.
export const UNDERTAKER_PER_CORPSE = 0.5;
export const MAX_UNDERTAKER_FRACTION = 0.3;
export const CORPSE_DECAY_TICKS = 600;

export type CorpseId = string;

export type Corpse = {
    id: CorpseId;
    location: AntLocation;
    ageTicks: number;
    carriedBy?: AntId;
};

type WeightedCandidate = {
    ant: Ant;
    corpse: Corpse;
    weight: number;
}

export function createCorpse(deadAnt: Ant, id: CorpseId): Corpse {
    return {
        id,
        location: deadAnt.location,
        ageTicks: 0,
        carriedBy: undefined,
    };
}

export function corpseById(state: ColonyState, id: CorpseId): Corpse | undefined {
    return state.corpses.find((corpse) => corpse.id === id);
}

// A corpse still wants an undertaker unless it's already resting in the
// graveyard. Buried corpses stay in state.corpses (they age/decay there) but
// must not be assignment targets — otherwise surface foragers get drafted to
// "re-bury" bodies that are already buried, and nest undertakers get sent
// chasing a corpse at surface coords the nest grid can't represent.
export function corpseNeedsUndertaker(surface: Surface, corpse: Corpse): boolean {
    if (corpse.carriedBy !== undefined) {
        return false;
    }
    return !(corpse.location.where === "surface" && inGraveyard(surface, corpse.location.pos));
}

export function ageCorpses(corpses: Corpse[]): Corpse[] {
    return corpses
        .map((corpse) => ({...corpse, ageTicks: corpse.ageTicks + 1}))
        .filter((corpse) => corpse.ageTicks <= CORPSE_DECAY_TICKS);
}

function corpseIdOrder(id: CorpseId): number {
    return Number(id.split("-")[1]);
}

function nearestCorpseInSameSpace(ant: Ant, corpses: Corpse[]): Corpse | undefined {
    let nearest: Corpse | undefined = undefined;
    let nearestDistance = Infinity;

    for (const corpse of corpses) {
        if (corpse.location.where !== ant.location.where) {
            continue;
        }

        const distance = manhattanDistance(ant.location.pos, corpse.location.pos);

        // On a distance tie, lowest corpse id wins — matches nearestPile in
        // world/surface.ts. (The earlier `corpseIdOrder(nearest.id)` alone was
        // always truthy, so ties silently went to whichever corpse came later
        // in the array.)
        if (
            distance < nearestDistance ||
            (distance === nearestDistance && nearest !== undefined && corpseIdOrder(corpse.id) < corpseIdOrder(nearest.id))
        ) {
            nearest = corpse;
            nearestDistance = distance;
        }
    }

    return nearest;
}

function pickWeighted(pool: WeightedCandidate[], rngSeed: number): { picked: WeightedCandidate; seed: number } {
    const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
    const roll = rng(rngSeed);
    let threshold = roll.value * totalWeight;

    for (let i = 0; i < pool.length; i++) {
        threshold -= pool[i].weight;
        if (threshold <= 0) {
            return { picked: pool[i], seed: roll.seed };
        }
    }

    // Floating-point: threshold never quite crossed 0. Last entry.
    return { picked: pool[pool.length - 1], seed: roll.seed };
}

export function assignUndertakers(state: ColonyState): { ants: Map<AntId, Ant>; rngSeed: number } {
    const workers = Array.from(state.ants.values()).filter((ant) => ant.caste === "WORKER");

    const alreadyUndertaking = workers.filter((ant) => ant.undertaking !== undefined).length;

    // "Pending" = not yet at rest in the graveyard (a body mid-haul still
    // counts — the job isn't done until it's down). Buried corpses stay in
    // state.corpses to age out, so total corpse count would badly overstate
    // how many workers are actually needed.
    const pendingCorpses = state.corpses.filter(
        (corpse) => !(corpse.location.where === "surface" && inGraveyard(state.surface, corpse.location.pos))
    );

    const desiredRaw = Math.round(pendingCorpses.length * UNDERTAKER_PER_CORPSE);
    const maxUndertakers = Math.floor(MAX_UNDERTAKER_FRACTION * workers.length);
    const desired = Math.max(0, Math.min(desiredRaw, maxUndertakers));

    const toAssign = Math.max(0, desired - alreadyUndertaking);

    if (toAssign === 0) {
        return { ants: state.ants, rngSeed: state.rngSeed };
    }

    const candidates = workers
        .filter((ant) => ant.carrying.length === 0 && ant.carryingFood === 0 && ant.undertaking === undefined)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // Rebuild the pool before EVERY pick, targeting each remaining candidate
    // at its nearest UNCLAIMED corpse. Without this, a cluster of corpses (the
    // die-off case) would send several undertakers at the same body while
    // others sit unattended — one of them buries it, the rest chase a corpse
    // that's already moving and eventually re-inter an already-buried one.
    const picks: { antId: AntId; corpseId: CorpseId }[] = [];
    // Seed with corpses that undertakers from PREVIOUS ticks are already on —
    // the per-pick de-dup below only knows about picks made in this call, so
    // without this, a new undertaker gets stacked onto a corpse someone is
    // already hauling. When that hauler buries it (moving it surface-side),
    // the stacked ant is left chasing a corpse at surface coords that the
    // nest grid can't represent.
    const claimedCorpses = new Set<CorpseId>(
        workers.filter((ant) => ant.undertaking !== undefined).map((ant) => ant.undertaking!.corpseId)
    );
    const pickedAnts = new Set<AntId>();
    let rngSeed = state.rngSeed;

    for (let n = 0; n < toAssign; n++) {
        const unclaimed = state.corpses.filter(
            (corpse) => corpseNeedsUndertaker(state.surface, corpse) && !claimedCorpses.has(corpse.id)
        );

        const pool: WeightedCandidate[] = [];
        for (const ant of candidates) {
            if (pickedAnts.has(ant.id)) {
                continue;
            }
            const corpse = nearestCorpseInSameSpace(ant, unclaimed);
            if (!corpse) {
                continue;
            }
            const distance = manhattanDistance(ant.location.pos, corpse.location.pos);
            pool.push({ ant, corpse, weight: 1 / (distance + 1) });
        }

        if (pool.length === 0) {
            break;
        }

        const result = pickWeighted(pool, rngSeed);
        picks.push({ antId: result.picked.ant.id, corpseId: result.picked.corpse.id });
        claimedCorpses.add(result.picked.corpse.id);
        pickedAnts.add(result.picked.ant.id);
        rngSeed = result.seed;
    }

    const ants = new Map(state.ants);
    for (const pick of picks) {
        const ant = ants.get(pick.antId);
        if (ant) {
            ants.set(pick.antId, { ...ant, undertaking: { corpseId: pick.corpseId } });
        }
    }

    return { ants, rngSeed };
}