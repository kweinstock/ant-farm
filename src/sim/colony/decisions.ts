// Colony-level decisions: every DECISION_INTERVAL_TICKS, score each
// registered proposal kind against current state; if the best clears
// DECISION_THRESHOLD, commit it. Scoring is pure and RNG-free — it has to
// be, since it runs unconditionally on a fixed cadence and nothing should
// perturb the RNG stream just from evaluating whether to act. Committing is
// the one place a proposal may spend RNG (graveyard relocation needs a
// random candidate search) — that's fine specifically because committing
// only happens when a proposal has already won, a state-driven event, not a
// per-tick coin flip like spawnFoodPiles' roll.
//
// The nursery/food-store relocation proposals don't move anything on the
// spot — this phase's nest is still create-once in every way except this
// hook. Committing one just drops a DigPlan onto state.pendingDigPlan for
// the excavation work (Phase 11, later items) to pick up and clear. Until
// that lands, a won nursery/food-store proposal is inert: the plan sits on
// state and nothing acts on it yet.
import type { ColonyState } from "../state";
import type { ChamberRole, Chamber } from "../world/nest";
import { chambersOf, exitMouth, UNREACHABLE_DISTANCE } from "../world/nest";
import type { Position } from "../world/grid";
import { manhattanDistance, tileAt, TILE } from "../world/grid";
import type { Surface, Rect } from "../world/surface";
import { tempAtDepth } from "../environment/temperature";
import { randomInt } from "../rng";
import { GRID_WIDTH, DECISION_THRESHOLD, GRAVEYARD_THREAT_CAP, NURSERY_COLD_TEMP, NURSERY_COLD_SCALE, FOOD_STORE_TRAVEL_THRESHOLD, FOOD_STORE_TRAVEL_SCALE, MAX_SPAWN_ATTEMPTS, HOLE_EXCLUSION_RADIUS, DECISION_INTERVAL_TICKS } from "../params";

export type DigPlan = {
    id: string;
    // Excludes QUEEN too, not just EXIT — she's never moved and a new
    // chamber is never created for her (bootstrapFrontierTile/frontierTiles
    // already refuse to dig FROM her chamber; this closes the matching gap
    // on the "what could a plan dig TOWARD" side, so a future proposal type
    // can't accidentally type-check its way into building her a second
    // chamber).
    role: Exclude<ChamberRole, "EXIT" | "QUEEN">;
    near: Position;
    reason: "cold" | "crowded";
    chamberId?: string;
    claims: Record<string, Position>;
    progress: Record<string, number>;
};

export type Proposal = {
    kind: string;
    score: number;
    commit: (state: ColonyState) => Partial<ColonyState>;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function chamberCentre(chamber: Chamber): Position {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tile of chamber.tiles) {
        minX = Math.min(minX, tile.x);
        maxX = Math.max(maxX, tile.x);
        minY = Math.min(minY, tile.y);
        maxY = Math.max(maxY, tile.y);
    }
    return { x: Math.floor((minX + maxX) / 2), y: Math.floor((minY + maxY) / 2) };
}

function rectClear(surface: Surface, rect: Rect): boolean {
    if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 >= surface.grid.width || rect.y1 >= surface.grid.height) {
        return false;
    }

    const centre: Position = { x: Math.floor((rect.x0 + rect.x1) / 2), y: Math.floor((rect.y0 + rect.y1) / 2) };
    if (manhattanDistance(centre, surface.holePos) < HOLE_EXCLUSION_RADIUS) return false;

    for (const patch of surface.patches) {
        if (rect.x0 <= patch.x1 && rect.x1 >= patch.x0 && rect.y0 <= patch.y1 && rect.y1 >= patch.y0) {
            return false;
        }
    }

    for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
            if (tileAt(surface.grid, x, y) !== TILE.GROUND) return false;
        }
    }

    return true;
}

// Same size as the current plot, relocated to a fresh candidate spot via
// rejection sampling — same shape as spawnFoodPiles' search, but testing a
// whole rect's footprint instead of one tile. Every attempt advances the
// seed regardless of accept/reject, so a failed search still leaves the RNG
// stream at a fixed, attempt-count-bounded point rather than one that
// depends on how many tries it took to succeed.
function relocateGraveyard(state: ColonyState): Partial<ColonyState> {
    const { surface } = state;
    const width = surface.graveyard.x1 - surface.graveyard.x0;
    const height = surface.graveyard.y1 - surface.graveyard.y0;

    let seed = state.rngSeed;
    let candidate: Rect | undefined;

    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const xRoll = randomInt(seed, 0, Math.max(0, surface.grid.width - 1 - width));
        const yRoll = randomInt(xRoll.seed, 0, Math.max(0, surface.grid.height - 1 - height));
        seed = yRoll.seed;

        const rect: Rect = { x0: xRoll.value, y0: yRoll.value, x1: xRoll.value + width, y1: yRoll.value + height };
        if (rectClear(surface, rect)) {
            candidate = rect;
            break;
        }
    }

    if (candidate === undefined) {
        return { rngSeed: seed };
    }

    return { surface: { ...surface, graveyard: candidate }, rngSeed: seed };
}

function scoreGraveyardRelocation(state: ColonyState): Proposal | undefined {
    const threat = state.env.graveyardThreat;
    if (threat <= 0) return undefined;

    return {
        kind: "relocateGraveyard",
        score: clamp01(threat / GRAVEYARD_THREAT_CAP),
        commit: relocateGraveyard,
    };
}

function scoreNurseryExpansion(state: ColonyState): Proposal | undefined {
    if (state.pendingDigPlan !== undefined) return undefined;

    const nurseries = chambersOf(state.nest, "NURSERY");
    if (nurseries.length === 0) return undefined;

    let coldest: { chamber: Chamber; avgTemp: number } | undefined;
    for (const chamber of nurseries) {
        const avgTemp =
            chamber.tiles.reduce((sum, t) => sum + tempAtDepth(state.env.ambientTemp, t.y), 0) / chamber.tiles.length;
        if (coldest === undefined || avgTemp < coldest.avgTemp) {
            coldest = { chamber, avgTemp };
        }
    }
    if (coldest === undefined || coldest.avgTemp >= NURSERY_COLD_TEMP) return undefined;

    const deficit = NURSERY_COLD_TEMP - coldest.avgTemp;
    const target = coldest.chamber;

    return {
        kind: "expandNursery",
        score: clamp01(deficit / NURSERY_COLD_SCALE),
        commit: (s) => ({
            pendingDigPlan: {
                id: `dig-${s.simTime}`,
                role: "NURSERY",
                near: chamberCentre(target),
                reason: "cold",
                claims: {},
                progress: {},
            },
        }),
    };
}

function scoreFoodStoreCrowding(state: ColonyState): Proposal | undefined {
    if (state.pendingDigPlan !== undefined) return undefined;

    const stores = chambersOf(state.nest, "FOOD_STORAGE");
    if (stores.length === 0) return undefined;

    const mouth = exitMouth(state.nest);
    const mouthIndex = mouth.y * GRID_WIDTH + mouth.x;

    let total = 0;
    let count = 0;
    for (const store of stores) {
        const field = state.nest.distanceFields[store.id];
        if (!field) continue;
        const d = field[mouthIndex];
        if (d >= UNREACHABLE_DISTANCE) continue;
        total += d;
        count += 1;
    }
    if (count === 0) return undefined;

    const avgDist = total / count;
    if (avgDist <= FOOD_STORE_TRAVEL_THRESHOLD) return undefined;

    return {
        kind: "relocateFoodStore",
        score: clamp01((avgDist - FOOD_STORE_TRAVEL_THRESHOLD) / FOOD_STORE_TRAVEL_SCALE),
        commit: (s) => ({
            pendingDigPlan: {
                id: `dig-${s.simTime}`,
                role: "FOOD_STORAGE",
                near: exitMouth(s.nest),
                reason: "crowded",
                claims: {},
                progress: {},
            },
        }),
    };
}

const PROPOSAL_SCORERS: ((state: ColonyState) => Proposal | undefined)[] = [
    scoreGraveyardRelocation,
    scoreNurseryExpansion,
    scoreFoodStoreCrowding,
];

export function evaluateDecisions(state: ColonyState): Partial<ColonyState> | undefined {
    if (state.simTime % DECISION_INTERVAL_TICKS !== 0) return undefined;

    const proposals = PROPOSAL_SCORERS
        .map((score) => score(state))
        .filter((p): p is Proposal => p !== undefined);

    if (proposals.length === 0) return undefined;

    const best = proposals.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score < DECISION_THRESHOLD) return undefined;

    return best.commit(state);
}