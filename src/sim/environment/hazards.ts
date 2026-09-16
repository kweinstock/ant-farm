// Server-only threats. Visitors CANNOT trigger, place, or remove any of these:
//   predator      a real roaming agent (Phase 10): spawns at a random map
//                 edge, walks a distance field toward a waypoint on the far
//                 side (exactly like a forager routes to its target), locks
//                 onto and chases the nearest visible ant, and only ever
//                 despawns by walking off the opposite edge — no timer.
//   flooding      heavy RAIN can inundate shallow tunnels; ants must haul brood up
//   cold snap     sudden temperature drop; cold-death risk
//   disease       contagion spreading ant-to-ant; undertakers + midden hygiene slow it
// Frequency/severity scale with season + weather, plus (Phase 10) how many
// bodies are sitting in the graveyard — both how often she shows up and
// where she wanders once she's here.
//
// Phase 5 scope was predator + cold-death only; Phase 10 is what makes the
// predator a real agent instead of a hovering hazard field. Flooding and
// disease are still deferred.

import { rng, randomInt } from "../rng";
import { fieldToTile, hasLineOfSight, isPassable, manhattanDistance, type Grid, type Position } from "../world/grid";
import { moveToward, stepToward } from "../ants/movement";
import type { AntId } from "../ants/ant";
import type { Season } from "./season";
import type { WeatherKind } from "./weather";
import { PREDATOR_APPEAR_CHANCE, PREDATOR_SEASON_MULT, PREDATOR_WEATHER_MULT, PREDATOR_VISION_RADIUS, PREDATOR_STRIKE_RANGE, PREDATOR_HUNT_PATIENCE_TICKS, PREDATOR_HUNT_COOLDOWN_TICKS, GRAVEYARD_ATTRACTION_MULT, COLD_DEATH_TEMP, COLD_DEATH_CHANCE_AT_ZERO } from "../params";

type Edge = "N" | "E" | "S" | "W";
const EDGES: Edge[] = ["N", "E", "S", "W"];

export type Predator = {
    pos: Position;
    entryEdge: Edge;
    // The real destination — a far-edge point or (Phase 10) the graveyard —
    // preserved across however many hunts happen along the way. Distinct
    // from where she's actually stepping this tick (an ant's position, while
    // hunting): a hunt used to overwrite this directly, which meant the
    // instant one ended she'd already forgotten where she was headed and
    // pick a brand-new random waypoint — and if another ant was visible
    // immediately (routine right outside a busy hole), she'd never resume a
    // real crossing at all. Bug found in review: "stuck in a spot for years"
    // / "camping the hole".
    roamTargetPos: Position;
    huntingAntId?: AntId;
    // Consecutive ticks spent continuously hunting (any target, resets on
    // disengage). Paired with huntCooldownTicks below to force her to give
    // up a stale chase and actually travel for a while before she's allowed
    // to get distracted by the next ant that wanders past.
    huntStreak: number;
    huntCooldownTicks: number;
};

function edgePoint(grid: Grid, edge: Edge, along: number): Position {
    switch (edge) {
        case "N": return {x: along, y: 0};
        case "S": return {x: along, y: grid.height - 1};
        case "W": return {x: 0, y: along};
        default: return {x: grid.width - 1, y: along};
    }
}

function edgeLength(grid: Grid, edge: Edge): number {
    return edge === "N" || edge === "S" ? grid.width : grid.height;
}

function oppositeEdge(edge: Edge): Edge {
    return edge === "N" ? "S" : edge === "S" ? "N" : edge === "E" ? "W" : "E";
}

function isOnEdge(grid: Grid, pos: Position): boolean {
    return pos.x === 0 || pos.x === grid.width - 1 || pos.y === 0 || pos.y === grid.height - 1;
}

const MAX_EDGE_POINT_ATTEMPTS = 20;

// A random point along a specific edge, rejection-sampled for passability —
// same principle as world/surface.ts's spawnFoodPiles. Bug found in review:
// picking a raw point with no passability check could land on a ROCK/TREE
// tile scattered right up to the map edge; a predator or ant can never
// actually occupy an impassable tile, so a target there could be approached
// but never exactly reached — advancePredator's arrival check
// (pos === roamTargetPos) would then never fire, and she'd orbit that one
// spot forever, unable to despawn or redirect to the graveyard ("stuck
// trying to leave but can't"). Every attempt advances the seed regardless of
// accept/reject, same as spawnFoodPiles, so the RNG cadence is fixed by the
// worst case, not by how many attempts happened to succeed. The deterministic
// full-edge scan fallback only matters if an entire edge is somehow solid
// obstacle, which a real generated surface shouldn't produce.
function passablePointOnEdge(grid: Grid, edge: Edge, seed: number): {pos: Position, seed: number} {
    let currentSeed = seed;
    for (let attempt = 0; attempt < MAX_EDGE_POINT_ATTEMPTS; attempt++) {
        const along = randomInt(currentSeed, 0, edgeLength(grid, edge) - 1);
        currentSeed = along.seed;
        const candidate = edgePoint(grid, edge, along.value);
        if (isPassable(grid, candidate.x, candidate.y)) {
            return { pos: candidate, seed: currentSeed };
        }
    }
    for (let along = 0; along < edgeLength(grid, edge); along++) {
        const candidate = edgePoint(grid, edge, along);
        if (isPassable(grid, candidate.x, candidate.y)) {
            return { pos: candidate, seed: currentSeed };
        }
    }
    return { pos: edgePoint(grid, edge, 0), seed: currentSeed };
}

function freshEdgeWaypoint(grid: Grid, seed: number): {pos: Position, seed: number} {
    const edgeRoll = randomInt(seed, 0, EDGES.length - 1);
    return passablePointOnEdge(grid, EDGES[edgeRoll.value], edgeRoll.seed);
}

function graveyardAppearanceMult(bodyCount: number): number {
    return 1 + GRAVEYARD_ATTRACTION_MULT * bodyCount;
}

function graveyardPullChance(bodyCount: number): number {
    return Math.min(GRAVEYARD_ATTRACTION_MULT * bodyCount, 0.9);
}

export function advancePredator(predator: Predator | undefined, env: { season: Season; weatherKind: WeatherKind }, grid: Grid, ants: { id: AntId; pos: Position }[], graveyard: { bodyCount: number; centre: Position }, seed: number, ): { predator: Predator | undefined; seed: number; appeared: boolean; left: boolean } {
    if (predator === undefined) {
        const roll = rng(seed);
        const chance =
            PREDATOR_APPEAR_CHANCE *
            PREDATOR_SEASON_MULT[env.season] *
            PREDATOR_WEATHER_MULT[env.weatherKind] *
            graveyardAppearanceMult(graveyard.bodyCount);

        if (roll.value >= chance) {
            return { predator: undefined, seed: roll.seed, appeared: false, left: false };
        }

        const edgeRoll = randomInt(roll.seed, 0, EDGES.length - 1);
        const entryEdge = EDGES[edgeRoll.value];
        const entryPoint = passablePointOnEdge(grid, entryEdge, edgeRoll.seed);
        const startPos = entryPoint.pos;
        const targetEdge = oppositeEdge(entryEdge);
        const targetPoint = passablePointOnEdge(grid, targetEdge, entryPoint.seed);
        const roamTargetPos = targetPoint.pos;

        return {
            predator: { pos: startPos, entryEdge, roamTargetPos, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 },
            seed: targetPoint.seed,
            appeared: true,
            left: false,
        };
    }

    let huntingAntId = predator.huntingAntId;
    let huntStreak = predator.huntStreak;
    let huntCooldownTicks = predator.huntCooldownTicks;
    let roamTargetPos = predator.roamTargetPos;
    let currentSeed = seed;
    let huntTargetPos: Position | undefined;

    if (huntingAntId !== undefined) {
        const stillTracked = ants.find((a) => a.id === huntingAntId);
        const stillVisible =
            stillTracked !== undefined &&
            manhattanDistance(stillTracked.pos, predator.pos) <= PREDATOR_VISION_RADIUS &&
            hasLineOfSight(grid, predator.pos, stillTracked.pos);

        if (stillVisible) {
            huntTargetPos = stillTracked.pos;
        } else {
            huntingAntId = undefined;
        }
    }

    // Patience ran out on an active hunt — drop it regardless of visibility
    // and refuse to re-engage for a while. Without this, as long as SOME ant
    // is always somewhere nearby (routine right outside a busy hole), she'd
    // never run out of things to chase and would never resume roamTargetPos.
    if (huntingAntId !== undefined && huntStreak >= PREDATOR_HUNT_PATIENCE_TICKS) {
        huntingAntId = undefined;
        huntTargetPos = undefined;
        huntCooldownTicks = PREDATOR_HUNT_COOLDOWN_TICKS;
    }

    if (huntingAntId === undefined && huntCooldownTicks <= 0) {
        let nearest: { id: AntId; pos: Position } | undefined;
        let nearestDist = PREDATOR_VISION_RADIUS + 1;
        for (const a of ants) {
            const d = manhattanDistance(a.pos, predator.pos);
            if (d < nearestDist && hasLineOfSight(grid, predator.pos, a.pos)) {
                nearest = a;
                nearestDist = d;
            }
        }
        if (nearest !== undefined) {
            huntingAntId = nearest.id;
            huntTargetPos = nearest.pos;
        }
    }

    huntStreak = huntingAntId !== undefined ? huntStreak + 1 : 0;
    if (huntingAntId === undefined && huntCooldownTicks > 0) {
        huntCooldownTicks -= 1;
    }

    if (huntingAntId === undefined && predator.pos.x === roamTargetPos.x && predator.pos.y === roamTargetPos.y) {
        if (isOnEdge(grid, predator.pos)) {
            const gateRoll = rng(currentSeed);
            currentSeed = gateRoll.seed;
            if (gateRoll.value < graveyardPullChance(graveyard.bodyCount)) {
                roamTargetPos = graveyard.centre;
            } else {
                return { predator: undefined, seed: currentSeed, appeared: false, left: true };
            }
        } else {
            // Not on an edge, unhunted, and just arrived — the only way
            // that happens is she reached the graveyard pull-point. Pick a
            // fresh far-edge waypoint and keep going; no gate here, she
            // already paid the graveyard visit that got her redirected here.
            const fresh = freshEdgeWaypoint(grid, currentSeed);
            roamTargetPos = fresh.pos;
            currentSeed = fresh.seed;
        }
    }

    // Hunting uses greedy stepToward, not a routed distance field: the
    // target is a live ant's position and changes every tick, so
    // fieldToTile's memoized-per-target cache (world/grid.ts) would never
    // get reused — one fresh whole-grid BFS per tick, cached forever under a
    // key nothing ever revisits, growing without bound over a long run. This
    // is the exact problem undertaker corpse-fetch hit and was fixed the
    // same way (ants/undertaking.ts's decideUndertaker comment). Roaming
    // toward roamTargetPos keeps the routed field — that target holds for
    // many ticks, so the cache actually pays for itself, same as a
    // forager's go-home route.
    const moveResult = huntingAntId !== undefined
        ? stepToward(grid, predator.pos, huntTargetPos!, currentSeed)
        : moveToward(grid, fieldToTile(grid, roamTargetPos), predator.pos, currentSeed);

    return {
        predator: {
            pos: moveResult.position,
            entryEdge: predator.entryEdge,
            roamTargetPos,
            huntingAntId,
            huntStreak,
            huntCooldownTicks,
        },
        seed: moveResult.seed,
        appeared: false,
        left: false,
    };
}

export function predatorCanStrike(predator: Predator | undefined, ant: { id: AntId; pos: Position }): boolean {
    if (predator === undefined || predator.huntingAntId !== ant.id) {
        return false;
    }
    return manhattanDistance(predator.pos, ant.pos) <= PREDATOR_STRIKE_RANGE;
}

export function coldDeathChance(tempAtTile: number): number {
    if (tempAtTile > COLD_DEATH_TEMP) return 0;
    return (COLD_DEATH_TEMP - tempAtTile) * COLD_DEATH_CHANCE_AT_ZERO;
}