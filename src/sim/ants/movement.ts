// Locomotion: undirected wander, goal-directed movement along a precomputed
// distance field (world/nest.ts, nest-side only), and PHASE 3b's stepToward
// — a greedy step toward an arbitrary target point, for the surface, which
// has no distance field at all (see world/surface.ts's header: the surface
// is obstacle-free, so a greedy Manhattan step is always optimal, and
// precomputing a field for it would be pure overhead). All three route
// through passableNeighbors, which now returns GROUND tiles too — nothing
// here needs to know or care which grid it's called on.
import { NOISE_PROBABILITY } from "../params";
import { rng, randomInt } from "../rng";
import { fieldToTile, getIndex, manhattanDistance, passableNeighbors, type Grid, type Position } from "../world/grid";

// Picks uniformly among the passable neighbors of `position` — not "roll a
// direction, then check if it happens to be valid," which is what Phase 3
// did and which biased ants toward freezing near walls (more blocked
// directions meant a higher chance the roll landed on one of them). Staying
// put now only happens when there's truly nowhere passable to go.
export function wander(grid: Grid, position: Position, rngSeed: number): {position: Position, seed: number} {
    const neighbors = passableNeighbors(grid, position.x, position.y);

    if (neighbors.length === 0) {
        // Shouldn't happen inside a connected, dug nest — nest.test.ts's
        // full-connectivity check means every passable tile has at least
        // one passable neighbor by construction — but a stray isolated tile
        // from a future hand-edited layout would otherwise crash the pick
        // below on an empty array. Staying put is the safe fallback.
        return {position, seed: rngSeed}
    }

    const pick = randomInt(rngSeed, 0, neighbors.length - 1);

    return {
        position: neighbors[pick.value],
        seed: pick.seed,
    };
}

export function moveToward(grid: Grid, distanceField: Int16Array, position: Position, rngSeed: number): {position: Position, seed: number} {
    const hereIndex = getIndex(grid, position.x, position.y);

    if (distanceField[hereIndex] === 0) {
        // Already standing on a tile of the target chamber — "toward" no
        // longer means anything from here. Falling through to wander lets
        // the ant mill around the room instead of freezing on the one tile
        // it arrived at, which is what a distance-field-only approach would
        // otherwise do once distance can't decrease any further.
        return wander(grid, position, rngSeed);
    }

    const neighbors = passableNeighbors(grid, position.x, position.y);

    if (neighbors.length === 0) {
        return {position, seed: rngSeed};
    }

    const neighborDistances = neighbors.map((neighbor) => distanceField[getIndex(grid, neighbor.x, neighbor.y)]);
    const minDistance = Math.min(...neighborDistances);

    // Assumes at least one neighbor's distance is meaningfully smaller than
    // "unreachable" — true as long as the nest stays fully connected
    // (nest.test.ts's job to guarantee). If that ever stopped holding, this
    // would silently pick among equally-unreachable neighbors rather than
    // crash — wrong movement, not a visible failure.
    const bestNeighbors = neighbors.filter((_, i) => neighborDistances[i] === minDistance);

    // Two RNG draws, threaded in sequence: first decides gradient-following
    // vs. noise, second picks uniformly among whichever candidate set that
    // decision landed on.
    const noiseRoll = rng(rngSeed);
    const useNoise = noiseRoll.value < NOISE_PROBABILITY;
    const candidates = useNoise ? neighbors : (bestNeighbors.length > 0 ? bestNeighbors : neighbors);

    const pick = randomInt(noiseRoll.seed, 0, candidates.length - 1);

    return {
        position: candidates[pick.value],
        seed: pick.seed,
    };
}

export function surfaceRouteStep(grid: Grid, pos: Position, target: Position, rngSeed: number): {position: Position, seed: number} {
    return moveToward(grid, fieldToTile(grid, target), pos, rngSeed);
}

export function stepToward(grid: Grid, pos: Position, target: Position, rngSeed: number): {position: Position, seed: number} {
    if (pos.x === target.x && pos.y === target.y) {
        return wander(grid, pos, rngSeed);
    }

    const neighbors = passableNeighbors(grid, pos.x, pos.y);

    if (neighbors.length === 0) {
        return {position: pos, seed: rngSeed};
    }

    const neighborDistances = neighbors.map((neighbor) => manhattanDistance(neighbor, target));
    const minDistance = Math.min(...neighborDistances);
    const bestNeighbors = neighbors.filter((_, i) => neighborDistances[i] === minDistance);

    const noiseRoll = rng(rngSeed);
    const useNoise = noiseRoll.value < NOISE_PROBABILITY;
    const candidates = useNoise ? neighbors : (bestNeighbors.length > 0 ? bestNeighbors : neighbors);

    const pick = randomInt(noiseRoll.seed, 0, candidates.length - 1);

    return {
        position: candidates[pick.value],
        seed: pick.seed,
    };
}