import { describe, expect, it } from "vitest";

import {
    createStarterNest,
    tilesOf,
    UNREACHABLE_DISTANCE,
    GRID_WIDTH,
    GRID_HEIGHT,
    type ChamberRole,
} from "../../src/sim/world/nest";
import { isPassable, passableNeighbors, getIndex } from "../../src/sim/world/grid";

const ROLES: ChamberRole[] = ["QUEEN", "NURSERY", "FOOD_STORAGE", "COMMONS", "EXIT"];

describe("starter nest", () => {
    const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);

    it("fails loud on a grid size the layout was not authored for", () => {
        expect(() => createStarterNest(GRID_WIDTH + 1, GRID_HEIGHT)).toThrow();
        expect(() => createStarterNest(GRID_WIDTH, GRID_HEIGHT - 1)).toThrow();
    });

    it("has every role present as a non-empty chamber", () => {
        for (const role of ROLES) {
            expect(tilesOf(nest, role).length).toBeGreaterThan(0);
        }
    });

    it("is a single connected passable component (every chamber reachable from every other)", () => {
        // BFS from one QUEEN tile over passable neighbours. If every passable
        // tile in the whole grid is reachable from here, then every chamber
        // is reachable from every other.
        const start = tilesOf(nest, "QUEEN")[0];
        const seen = new Set<string>([`${start.x},${start.y}`]);
        const queue = [start];
        for (let head = 0; head < queue.length; head++) {
            for (const n of passableNeighbors(grid, queue[head].x, queue[head].y)) {
                const key = `${n.x},${n.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    queue.push(n);
                }
            }
        }

        let passableCount = 0;
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                if (isPassable(grid, x, y)) passableCount++;
            }
        }

        expect(seen.size).toBe(passableCount);
    });

    it("every role's distance field reaches every passable tile — no unreachable pockets", () => {
        for (const role of ROLES) {
            const field = nest.distanceFields[role];
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) {
                    if (isPassable(grid, x, y)) {
                        expect(field[getIndex(grid, x, y)]).toBeLessThan(UNREACHABLE_DISTANCE);
                    }
                }
            }
        }
    });

    it("a role's own tiles sit at distance 0 in its field", () => {
        for (const role of ROLES) {
            const field = nest.distanceFields[role];
            for (const tile of tilesOf(nest, role)) {
                expect(field[getIndex(grid, tile.x, tile.y)]).toBe(0);
            }
        }
    });
});
