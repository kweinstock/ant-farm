import { describe, expect, it } from "vitest";

import {
    createTrailField,
    trailAt,
    deposit,
    evaporate,
    strongestPassableNeighbor,
    MAX_TRAIL,
    MIN_TRAIL,
    FOLLOW_THRESHOLD,
    DEPOSIT_AMOUNT,
    SPREAD_FRAC,
} from "../../src/sim/pheromones";
import { createGrid, setTile, TILE } from "../../src/sim/world/grid";

function groundGrid(w: number, h: number) {
    const g = createGrid(w, h);
    g.tiles.fill(TILE.GROUND);
    return g;
}

describe("pheromone trail field", () => {
    it("deposit raises the target tile and its 4 orthogonal neighbours, clamped to MAX_TRAIL", () => {
        let f = createTrailField(10, 10);
        f = deposit(f, 5, 5, DEPOSIT_AMOUNT);

        expect(trailAt(f, 5, 5)).toBe(DEPOSIT_AMOUNT);
        expect(trailAt(f, 5, 4)).toBeCloseTo(DEPOSIT_AMOUNT * SPREAD_FRAC);
        expect(trailAt(f, 6, 5)).toBeCloseTo(DEPOSIT_AMOUNT * SPREAD_FRAC);
        expect(trailAt(f, 4, 4)).toBe(0); // diagonal — not spread to

        for (let i = 0; i < 100; i++) f = deposit(f, 5, 5, DEPOSIT_AMOUNT);
        expect(trailAt(f, 5, 5)).toBe(MAX_TRAIL);
    });

    it("deposit at a corner stays in bounds and doesn't wrap to the far corner", () => {
        let f = createTrailField(4, 4);
        f = deposit(f, 0, 0, DEPOSIT_AMOUNT);

        expect(trailAt(f, 0, 0)).toBe(DEPOSIT_AMOUNT);
        expect(trailAt(f, 1, 0)).toBeCloseTo(DEPOSIT_AMOUNT * SPREAD_FRAC);
        expect(trailAt(f, 0, 1)).toBeCloseTo(DEPOSIT_AMOUNT * SPREAD_FRAC);
        expect(trailAt(f, 3, 3)).toBe(0);
    });

    it("evaporate shrinks every cell and floors sub-MIN_TRAIL values to exactly 0", () => {
        let f = createTrailField(4, 4);
        f = deposit(f, 1, 1, 100);
        const before = trailAt(f, 1, 1);
        f = evaporate(f);
        expect(trailAt(f, 1, 1)).toBeLessThan(before);
        expect(trailAt(f, 1, 1)).toBeGreaterThan(0);

        let g = createTrailField(2, 2);
        g = deposit(g, 0, 0, MIN_TRAIL * 0.8); // a crumb already below the floor
        g = evaporate(g);
        expect(trailAt(g, 0, 0)).toBe(0);
    });

    it("strongestPassableNeighbor returns the strongest neighbour above FOLLOW_THRESHOLD, else undefined", () => {
        const grid = groundGrid(5, 5);
        let f = createTrailField(5, 5);

        expect(strongestPassableNeighbor(f, grid, 2, 2)).toBeUndefined();

        f = deposit(f, 3, 2, FOLLOW_THRESHOLD - 1); // below the follow gate
        expect(strongestPassableNeighbor(f, grid, 2, 2)).toBeUndefined();

        f = deposit(f, 3, 2, 50); // now well above
        expect(strongestPassableNeighbor(f, grid, 2, 2)).toEqual({ x: 3, y: 2 });
    });

    it("strongestPassableNeighbor never picks an impassable neighbour, even with the most trail on it", () => {
        const grid = groundGrid(5, 5);
        setTile(grid, 3, 2, TILE.SOIL); // wall the east neighbour of (2,2)
        let f = createTrailField(5, 5);
        f = deposit(f, 3, 2, 999);

        expect(strongestPassableNeighbor(f, grid, 2, 2)).toBeUndefined();
    });
});
