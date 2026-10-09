import { describe, expect, it } from "vitest";

import {
    createStarterNest,
    chambersOf,
    allTilesOf,
    chamberAt,
    chamberIdAt,
    nearestChamberField,
    UNREACHABLE_DISTANCE,
    type Chamber,
} from "../../src/sim/world/nest";
import { GRID_WIDTH, GRID_HEIGHT } from "../../src/sim/params";
import { getIndex } from "../../src/sim/world/grid";

// Phase 6: a role is several chambers now. These cover the routing primitive
// (nearestChamberField) and the O(1) tile->chamber lookups everything leans on.

describe("multi-instance chambers", () => {
    const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
    const at = (id: string) => nest.distanceFields[id];

    it("chamberIdAt / chamberAt agree on every chamber tile and are empty off-chamber", () => {
        const claimed = new Set<string>();
        for (const chamber of nest.chambers) {
            for (const tile of chamber.tiles) {
                expect(chamberIdAt(nest, tile)).toBe(chamber.id);
                expect(chamberAt(nest, tile)).toBe(chamber.role);
                claimed.add(`${tile.x},${tile.y}`);
            }
        }
        // A tunnel tile belongs to no chamber.
        for (let y = 0; y < grid.height && claimed.size > 0; y++) {
            for (let x = 0; x < grid.width; x++) {
                if (!claimed.has(`${x},${y}`)) {
                    expect(chamberIdAt(nest, { x, y })).toBeUndefined();
                    expect(chamberAt(nest, { x, y })).toBeUndefined();
                    return; // one negative case is enough
                }
            }
        }
    });

    it("allTilesOf is exactly the union of the role's instances", () => {
        for (const role of ["NURSERY", "FOOD_STORAGE", "COMMONS"] as const) {
            const union = chambersOf(nest, role).flatMap((c) => c.tiles);
            expect(allTilesOf(nest, role)).toEqual(union);
            expect(chambersOf(nest, role).length).toBeGreaterThanOrEqual(2);
        }
    });

    it("each instance has its own distinct distance field, zero on its own tiles", () => {
        const nurseries = chambersOf(nest, "NURSERY");
        for (const chamber of nurseries) {
            const field = at(chamber.id);
            for (const tile of chamber.tiles) {
                expect(field[getIndex(grid, tile.x, tile.y)]).toBe(0);
            }
            // ...and non-zero on a different nursery's tiles.
            const other = nurseries.find((c) => c.id !== chamber.id)!;
            const otherTile = other.tiles[0];
            expect(field[getIndex(grid, otherTile.x, otherTile.y)]).toBeGreaterThan(0);
        }
    });

    it("nearestChamberField returns the closest instance by walking distance", () => {
        // Stand on a tile of the first FOOD_STORAGE; the nearest food-store
        // field must be that chamber's own (distance 0 where we stand).
        const stores = chambersOf(nest, "FOOD_STORAGE");
        const here = stores[0].tiles[0];
        const field = nearestChamberField(nest, "FOOD_STORAGE", here);
        expect(field).toBe(at(stores[0].id));
        expect(field![getIndex(grid, here.x, here.y)]).toBe(0);
    });

    it("nearestChamberField skips instances the eligible predicate rejects", () => {
        const stores = chambersOf(nest, "FOOD_STORAGE");
        const here = stores[0].tiles[0];

        // Reject the one we're standing on → must fall through to another.
        const reject0 = (c: Chamber) => c.id !== stores[0].id;
        const field = nearestChamberField(nest, "FOOD_STORAGE", here, reject0);
        expect(field).toBeDefined();
        expect(field).not.toBe(at(stores[0].id));
        expect(stores.slice(1).map((c) => at(c.id))).toContain(field);

        // Reject everything → undefined (caller then falls back / no-ops).
        expect(nearestChamberField(nest, "FOOD_STORAGE", here, () => false)).toBeUndefined();
    });

    it("nearestChamberField is deterministic and breaks ties by chamber id", () => {
        // From the exit mouth, resolve NURSERY twice — identical result.
        const mouth = chambersOf(nest, "EXIT")[0].tiles.reduce((a, b) => (b.y < a.y ? b : a));
        const a = nearestChamberField(nest, "NURSERY", mouth);
        const b = nearestChamberField(nest, "NURSERY", mouth);
        expect(a).toBe(b);
        expect(a).toBeDefined();
    });

    it("a QUEEN-seeking ant from anywhere reaches the one queen chamber", () => {
        // Sanity that the single-instance roles still resolve.
        const commons = allTilesOf(nest, "COMMONS")[0];
        const field = nearestChamberField(nest, "QUEEN", commons);
        expect(field).toBe(at(chambersOf(nest, "QUEEN")[0].id));
        expect(field![getIndex(grid, commons.x, commons.y)]).toBeLessThan(UNREACHABLE_DISTANCE);
    });
});
