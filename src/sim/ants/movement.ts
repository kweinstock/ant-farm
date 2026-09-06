// Locomotion: undirected wander, and goal-directed movement along a
// precomputed distance field (world/nest.ts). Both functions take `grid` and
// route every move through passability — that's the one thing this file
// should never skip, now that most of the world is solid, impassable SOIL.

import { rng, randomInt } from "../rng";
import { getIndex, passableNeighbors, type Grid, type Position } from "../world/grid";

// 20% of the time, ignore the gradient and wander among ALL passable
// neighbors instead of stepping toward the target. That's the noise that
// stops every ant tracing the identical shortest-path tile and forming a
// rigid conga line down one corridor.
const NOISE_PROBABILITY = 0.2;

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
    const candidates = useNoise ? neighbors : bestNeighbors;

    const pick = randomInt(noiseRoll.seed, 0, candidates.length - 1);

    return {
        position: candidates[pick.value],
        seed: pick.seed,
    };
}