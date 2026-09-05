// Low-level locomotion: step toward a target tile, follow a pheromone gradient,
// wall/collision handling, speed from traits + terrain + weather (mud in RAIN
// slows). Movement cost is reported back so lifecycle.ts can bill energy.

import { randomDirection } from "../rng";
import { getNeighbors, type Grid, type Position } from "../world/grid";

export function wander(grid: Grid, position: Position, rngSeed: number): {position: Position, seed: number} {
    const directionResult = randomDirection(rngSeed, false);
    const neighbors = getNeighbors(grid, position.x, position.y);

    const target: Position = {
        x: position.x + directionResult.value.dx,
        y: position.y + directionResult.value.dy,
    };

    const canMove = neighbors.some((neighbor) => neighbor.x === target.x && neighbor.y === target.y);

    return {
        position: canMove ? target : position,
        seed: directionResult.seed,
    };
}
