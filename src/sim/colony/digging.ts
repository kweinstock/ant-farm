// The digger assignment pass — mirrors corpses.ts's assignUndertakers
// almost exactly: digging is a transient override (Ant.digging?,
// ants/ant.ts) on top of NURSE/FORAGER, not a Job value, so workforce.ts's
// nurse/forager split stays untouched. Only does anything while
// state.pendingDigPlan exists; no plan, no diggers, full stop.
import { rng } from "../rng";
import { manhattanDistance, type Position } from "../world/grid";
import { frontierTiles, bootstrapFrontierTile } from "../world/nest";
import type { Ant, AntId } from "../ants/ant";
import type { ColonyState } from "../state";
import type { DigPlan } from "./decisions";
import { DIGGERS_PER_FRONTIER_TILE, MAX_DIGGER_FRACTION } from "../params";

type WeightedCandidate = {
    ant: Ant;
    tile: Position;
    weight: number;
};

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
    return { picked: pool[pool.length - 1], seed: roll.seed };
}

function nearestUnclaimedTile(ant: Ant, tiles: Position[]): Position | undefined {
    let nearest: Position | undefined;
    let nearestDistance = Infinity;

    for (const tile of tiles) {
        const distance = manhattanDistance(ant.location.pos, tile);
        if (distance < nearestDistance) {
            nearest = tile;
            nearestDistance = distance;
        }
    }

    return nearest;
}

export function assignDiggers(state: ColonyState): { ants: Map<AntId, Ant>; pendingDigPlan: DigPlan | undefined; rngSeed: number } {
    const rawPlan = state.pendingDigPlan;
    if (!rawPlan) {
        return { ants: state.ants, pendingDigPlan: undefined, rngSeed: state.rngSeed };
    }

    const workers = Array.from(state.ants.values()).filter((ant) => ant.caste === "WORKER");

    // Prune claims/progress for any ant that no longer exists, or is no
    // longer actually assigned to this plan (died, or got pulled elsewhere).
    // Bug found in review: nothing released a dead digger's claim — only the
    // digger ITSELF clears its own claim, on the tick it finishes its tile
    // (jobs.ts's "dig" case) — so a digger that died mid-dig (predator,
    // starvation, old age, all routine) permanently squatted its frontier
    // tile forever. Once every frontier tile was claimed by ghosts, the plan
    // could never assign a replacement and would never complete — and since
    // scoreNurseryExpansion/scoreFoodStoreCrowding both refuse to propose
    // anything new while a plan is pending, ONE dead digger during the
    // bootstrap tile (a single tile, so it only takes one death) could
    // permanently block every future structural decision for the rest of
    // the run.
    const stillAssigned = (antId: AntId): boolean => state.ants.get(antId)?.digging?.planId === rawPlan.id;
    const prunedClaims = Object.fromEntries(Object.entries(rawPlan.claims).filter(([antId]) => stillAssigned(antId)));
    const prunedProgress = Object.fromEntries(Object.entries(rawPlan.progress).filter(([antId]) => stillAssigned(antId)));
    const plan: DigPlan = { ...rawPlan, claims: prunedClaims, progress: prunedProgress };

    const alreadyDigging = workers.filter((ant) => ant.digging?.planId === plan.id).length;

    // No chamber yet: treat "one bootstrap tile outstanding" as the whole
    // frontier, so exactly one digger gets sent to break ground.
    const candidateTiles: Position[] =
        plan.chamberId !== undefined
            ? frontierTiles(state.grid, state.nest, plan.chamberId)
            : (() => {
                  const tile = bootstrapFrontierTile(state.grid, state.nest, plan.near);
                  return tile ? [tile] : [];
              })();

    const desiredRaw = Math.round(candidateTiles.length * DIGGERS_PER_FRONTIER_TILE);
    const maxDiggers = Math.floor(MAX_DIGGER_FRACTION * workers.length);
    const desired = Math.max(0, Math.min(desiredRaw, maxDiggers));
    const toAssign = Math.max(0, desired - alreadyDigging);

    if (toAssign === 0) {
        return { ants: state.ants, pendingDigPlan: plan, rngSeed: state.rngSeed };
    }

    const candidates = workers
        .filter(
            (ant) =>
                ant.location.where === "nest" &&
                ant.carrying.length === 0 &&
                ant.carryingFood === 0 &&
                ant.undertaking === undefined &&
                ant.digging === undefined,
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const claimedTiles = new Set<string>(Object.values(plan.claims).map((t) => `${t.x},${t.y}`));
    const pickedAnts = new Set<AntId>();
    const picks: { antId: AntId; tile: Position }[] = [];
    let rngSeed = state.rngSeed;

    for (let n = 0; n < toAssign; n++) {
        const unclaimed = candidateTiles.filter((t) => !claimedTiles.has(`${t.x},${t.y}`));
        if (unclaimed.length === 0) break;

        const pool: WeightedCandidate[] = [];
        for (const ant of candidates) {
            if (pickedAnts.has(ant.id)) continue;
            const tile = nearestUnclaimedTile(ant, unclaimed);
            if (!tile) continue;
            const distance = manhattanDistance(ant.location.pos, tile);
            pool.push({ ant, tile, weight: 1 / (distance + 1) });
        }
        if (pool.length === 0) break;

        const result = pickWeighted(pool, rngSeed);
        picks.push({ antId: result.picked.ant.id, tile: result.picked.tile });
        claimedTiles.add(`${result.picked.tile.x},${result.picked.tile.y}`);
        pickedAnts.add(result.picked.ant.id);
        rngSeed = result.seed;
    }

    const ants = new Map(state.ants);
    const claims = { ...plan.claims };
    for (const pick of picks) {
        const ant = ants.get(pick.antId);
        if (ant) {
            ants.set(pick.antId, { ...ant, digging: { planId: plan.id } });
            claims[pick.antId] = pick.tile;
        }
    }

    return { ants, pendingDigPlan: { ...plan, claims }, rngSeed };
}