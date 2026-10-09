import { describe, expect, it } from "vitest";

import {
    createStarterNest,
    chambersOf,
    allTilesOf,
    UNREACHABLE_DISTANCE,
    type ChamberRole,
} from "../../src/sim/world/nest";
import { GRID_WIDTH, GRID_HEIGHT } from "../../src/sim/params";
import { isPassable, passableNeighbors, getIndex, TILE, tileAt } from "../../src/sim/world/grid";

const ROLES: ChamberRole[] = ["QUEEN", "NURSERY", "FOOD_STORAGE", "COMMONS", "EXIT"];

describe("starter nest", () => {
    const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);

    it("fails loud on a grid size the layout was not authored for", () => {
        expect(() => createStarterNest(GRID_WIDTH + 1, GRID_HEIGHT)).toThrow();
        expect(() => createStarterNest(GRID_WIDTH, GRID_HEIGHT - 1)).toThrow();
    });

    it("has the Phase 6 multi-instance chamber set", () => {
        // Roadmap: 2-3 NURSERY, 2-3 FOOD_STORAGE, 4-5 COMMONS, one QUEEN, one EXIT.
        expect(chambersOf(nest, "QUEEN").length).toBe(1);
        expect(chambersOf(nest, "EXIT").length).toBe(1);
        expect(chambersOf(nest, "NURSERY").length).toBeGreaterThanOrEqual(2);
        expect(chambersOf(nest, "FOOD_STORAGE").length).toBeGreaterThanOrEqual(2);
        expect(chambersOf(nest, "COMMONS").length).toBeGreaterThanOrEqual(4);
        for (const role of ROLES) {
            expect(allTilesOf(nest, role).length).toBeGreaterThan(0);
        }
        // Chamber ids are unique and stable-looking (`ROLE-n`).
        const ids = nest.chambers.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of nest.chambers) expect(c.id).toBe(`${c.role}-${ids.filter((id) => id.startsWith(`${c.role}-`)).indexOf(c.id)}`);
    });

    it("keeps the QUEEN chamber away from every nursery", () => {
        // "not adjacent to a nursery — nurses walk a real distance". Assert the
        // queen chamber shares no tile-adjacency with any NURSERY tile.
        const queenTiles = new Set(allTilesOf(nest, "QUEEN").map((t) => `${t.x},${t.y}`));
        for (const nt of allTilesOf(nest, "NURSERY")) {
            for (const d of [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 0]]) {
                expect(queenTiles.has(`${nt.x + d[0]},${nt.y + d[1]}`)).toBe(false);
            }
        }
    });

    it("is a single connected passable component (every chamber reachable from every other)", () => {
        const start = chambersOf(nest, "QUEEN")[0].tiles[0];
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

        // Every chamber instance has at least one tile in the reachable set.
        for (const chamber of nest.chambers) {
            expect(chamber.tiles.some((t) => seen.has(`${t.x},${t.y}`))).toBe(true);
        }
    });

    it("every chamber instance's distance field reaches every passable tile", () => {
        for (const chamber of nest.chambers) {
            const field = nest.distanceFields[chamber.id];
            expect(field).toBeDefined();
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) {
                    if (isPassable(grid, x, y)) {
                        expect(field[getIndex(grid, x, y)]).toBeLessThan(UNREACHABLE_DISTANCE);
                    }
                }
            }
        }
    });

    it("each chamber's own tiles sit at distance 0 in its own field — except EXIT (mouth only)", () => {
        for (const chamber of nest.chambers) {
            const field = nest.distanceFields[chamber.id];

            if (chamber.role === "EXIT") {
                const mouth = chamber.tiles.reduce((a, b) => (b.y < a.y ? b : a));
                expect(field[getIndex(grid, mouth.x, mouth.y)]).toBe(0);
                const nonMouthZero = chamber.tiles.some(
                    (t) => (t.x !== mouth.x || t.y !== mouth.y) && field[getIndex(grid, t.x, t.y)] === 0
                );
                expect(nonMouthZero).toBe(false);
                continue;
            }

            for (const tile of chamber.tiles) {
                expect(field[getIndex(grid, tile.x, tile.y)]).toBe(0);
            }
        }
    });

    it("every tunnel run is at least 2 wide — no 1-tile pinch points", () => {
        // Invariant: each TUNNEL tile belongs to at least one fully-passable
        // 2x2 square. A 1-wide corridor (or a 1-wide kink in a 2-wide one)
        // has a tunnel tile that no 2x2 passable block contains.
        const passable = (x: number, y: number) => isPassable(grid, x, y);
        const in2x2 = (x: number, y: number) =>
            [[-1, -1], [-1, 0], [0, -1], [0, 0]].some(([ox, oy]) => {
                const bx = x + ox;
                const by = y + oy;
                return passable(bx, by) && passable(bx + 1, by) && passable(bx, by + 1) && passable(bx + 1, by + 1);
            });

        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                if (tileAt(grid, x, y) === TILE.TUNNEL) {
                    expect(in2x2(x, y), `tunnel tile ${x},${y} is not in any passable 2x2 block`).toBe(true);
                }
            }
        }
    });

    it("every chamber tile is real CHAMBER floor — no corridor paves a chamber", () => {
        // A tunnel over a chamber tile still counts as that chamber via
        // tileChamber, so an egg / food deposit could land on what renders as
        // a tunnel. chamber.tiles must only hold genuine CHAMBER tiles.
        for (const chamber of nest.chambers) {
            if (chamber.role === "EXIT") continue;
            for (const t of chamber.tiles) {
                expect(tileAt(grid, t.x, t.y), `${chamber.id} tile ${t.x},${t.y}`).toBe(TILE.CHAMBER);
            }
            expect(chamber.tiles.length).toBeGreaterThan(0);
        }
    });

    it("the layout is mirror-symmetric about the vertical centre line", () => {
        const mx = grid.width - 1;
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                expect(tileAt(grid, x, y), `tile ${x},${y} vs its mirror`).toBe(tileAt(grid, mx - x, y));
            }
        }
    });

    it("worker chambers are dirt-walled except for their doorways", () => {
        // The FOOD_STORAGE / COMMONS / NURSERY left-right pairs each connect
        // to the rest of the nest through exactly two 2-wide doorways (trunk +
        // bypass shaft) = 4 open perimeter tiles. Every other edge is solid
        // dirt (undug SOIL is impassable — that's the wall, no WALL tile).
        const pairChambers = nest.chambers.filter(
            (c) => c.role === "FOOD_STORAGE" || (c.role === "COMMONS" && c.id !== "COMMONS-0" && c.id !== "COMMONS-3"),
        ).concat(nest.chambers.filter((c) => c.role === "NURSERY"));
        expect(pairChambers.length).toBeGreaterThanOrEqual(6);

        for (const chamber of pairChambers) {
            const own = new Set(chamber.tiles.map((t) => `${t.x},${t.y}`));
            let openEdges = 0;
            let solidEdges = 0;
            for (const t of chamber.tiles) {
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    if (own.has(`${t.x + dx},${t.y + dy}`)) continue;
                    if (isPassable(grid, t.x + dx, t.y + dy)) openEdges += 1;
                    else solidEdges += 1;
                }
            }
            expect(openEdges, `${chamber.id} open edge tiles`).toBeLessThanOrEqual(4);
            expect(solidEdges, `${chamber.id} should be mostly walled by dirt`).toBeGreaterThan(openEdges * 2);
        }
    });
});
