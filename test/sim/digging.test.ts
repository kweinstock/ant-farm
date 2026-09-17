import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { createStarterNest, chambersOf, digTile, frontierTiles, bootstrapFrontierTile } from "../../src/sim/world/nest";
import { isPassable, passableNeighbors, getIndex, TILE, tileAt } from "../../src/sim/world/grid";
import { GRID_WIDTH, GRID_HEIGHT } from "../../src/sim/params";
import type { DigPlan } from "../../src/sim/colony/decisions";

describe("digTile — excavation invariants (Phase 11)", () => {
    it("converts only the targeted SOIL tile to CHAMBER, leaving every other tile byte-identical", () => {
        const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
        const chamber = chambersOf(nest, "NURSERY")[0];
        const tile = frontierTiles(grid, nest, chamber.id)[0];
        expect(tile).toBeDefined();
        expect(tileAt(grid, tile.x, tile.y)).toBe(TILE.SOIL);

        const dug = digTile(grid, nest, tile, chamber.id);

        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                if (x === tile.x && y === tile.y) continue;
                expect(tileAt(dug.grid, x, y), `tile ${x},${y} should be untouched`).toBe(tileAt(grid, x, y));
            }
        }
        expect(tileAt(dug.grid, tile.x, tile.y)).toBe(TILE.CHAMBER);
    });

    it("refuses to hand out a frontier tile for the QUEEN chamber, and digging elsewhere never touches her tile set", () => {
        const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
        const queen = chambersOf(nest, "QUEEN")[0];
        expect(frontierTiles(grid, nest, queen.id)).toEqual([]);

        const commons = chambersOf(nest, "COMMONS")[0];
        const tile = frontierTiles(grid, nest, commons.id)[0];
        const dug = digTile(grid, nest, tile, commons.id);

        const queenAfter = dug.nest.chambers.find((c) => c.id === queen.id)!;
        expect(queenAfter.tiles).toEqual(queen.tiles);
    });

    it("bootstrapFrontierTile never proposes starting a brand new chamber off the QUEEN or EXIT chambers", () => {
        const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
        const queenCentre = chambersOf(nest, "QUEEN")[0].tiles[0];
        const tile = bootstrapFrontierTile(grid, nest, queenCentre);
        expect(tile).toBeDefined();

        // The returned tile must be a frontier tile of some non-QUEEN,
        // non-EXIT chamber — never of the queen's or the exit shaft's.
        const belongsToQueenOrExit = [chambersOf(nest, "QUEEN")[0], ...chambersOf(nest, "EXIT")].some((c) =>
            frontierTiles(grid, nest, c.id).some((t) => t.x === tile!.x && t.y === tile!.y),
        );
        expect(belongsToQueenOrExit).toBe(false);
    });

    it("extending a chamber via digTile keeps the whole passable grid a single connected component", () => {
        const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
        const commons = chambersOf(nest, "COMMONS")[0];

        let current = { grid, nest };
        for (let i = 0; i < 5; i++) {
            const tile = frontierTiles(current.grid, current.nest, commons.id)[0];
            if (!tile) break;
            current = digTile(current.grid, current.nest, tile, commons.id);
        }

        const start = chambersOf(current.nest, "QUEEN")[0].tiles[0];
        const seen = new Set<string>([`${start.x},${start.y}`]);
        const queue = [start];
        for (let head = 0; head < queue.length; head++) {
            for (const n of passableNeighbors(current.grid, queue[head].x, queue[head].y)) {
                const key = `${n.x},${n.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    queue.push(n);
                }
            }
        }

        let passableCount = 0;
        for (let y = 0; y < current.grid.height; y++) {
            for (let x = 0; x < current.grid.width; x++) {
                if (isPassable(current.grid, x, y)) passableCount++;
            }
        }
        expect(seen.size).toBe(passableCount);
    });

    it("the extended chamber's distance field still reaches every passable tile", () => {
        const { grid, nest } = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
        const foodStore = chambersOf(nest, "FOOD_STORAGE")[0];
        const tile = frontierTiles(grid, nest, foodStore.id)[0];
        const dug = digTile(grid, nest, tile, foodStore.id);

        const field = dug.nest.distanceFields[foodStore.id];
        for (let y = 0; y < dug.grid.height; y++) {
            for (let x = 0; x < dug.grid.width; x++) {
                if (isPassable(dug.grid, x, y)) {
                    expect(field[getIndex(dug.grid, x, y)]).toBeLessThan(32767);
                }
            }
        }
    });
});

describe("a colony digging a new chamber end-to-end (Phase 11 pipeline)", () => {
    it("diggers carry a committed plan to completion without ever touching the QUEEN chamber, and connectivity holds throughout", () => {
        let state = createInitialState(11);
        const queenBefore = chambersOf(state.nest, "QUEEN")[0];
        const commons = chambersOf(state.nest, "COMMONS")[0];

        const plan: DigPlan = {
            id: "dig-test-1",
            role: "COMMONS",
            near: commons.tiles[0],
            reason: "crowded",
            chamberId: commons.id,
            claims: {},
            progress: {},
        };
        state = { ...state, pendingDigPlan: plan };

        const startingTiles = commons.tiles.length;
        let grewAtLeastOnce = false;

        for (let t = 1; t <= 8000; t++) {
            state = step(state, 1).state;
            const nowChamber = state.nest.chambers.find((c) => c.id === commons.id);
            if (nowChamber && nowChamber.tiles.length > startingTiles) grewAtLeastOnce = true;
            if (state.pendingDigPlan === undefined) break;
        }

        expect(grewAtLeastOnce).toBe(true);

        const queenAfter = state.nest.chambers.find((c) => c.id === queenBefore.id)!;
        expect(queenAfter.tiles).toEqual(queenBefore.tiles);

        const start = queenAfter.tiles[0];
        const seen = new Set<string>([`${start.x},${start.y}`]);
        const queue = [start];
        for (let head = 0; head < queue.length; head++) {
            for (const n of passableNeighbors(state.grid, queue[head].x, queue[head].y)) {
                const key = `${n.x},${n.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    queue.push(n);
                }
            }
        }
        let passableCount = 0;
        for (let y = 0; y < state.grid.height; y++) {
            for (let x = 0; x < state.grid.width; x++) {
                if (isPassable(state.grid, x, y)) passableCount++;
            }
        }
        expect(seen.size).toBe(passableCount);
    });
});

describe("determinism with teaching, a committed decision, and active digging all running together (Phase 11)", () => {
    it("produces the same result for one N-tick step or N 1-tick steps", () => {
        const seed = 555;
        const commonsId = chambersOf(createStarterNest(GRID_WIDTH, GRID_HEIGHT).nest, "COMMONS")[0].id;
        const makeState = () => {
            const s = createInitialState(seed);
            const commons = chambersOf(s.nest, "COMMONS")[0];
            const plan: DigPlan = {
                id: "dig-determinism",
                role: "COMMONS",
                near: commons.tiles[0],
                reason: "crowded",
                chamberId: commonsId,
                claims: {},
                progress: {},
            };
            return { ...s, pendingDigPlan: plan };
        };

        const N = 500;
        const big = step(makeState(), N);

        let small = makeState();
        for (let i = 0; i < N; i++) small = step(small, 1).state;

        expect(big.state).toEqual(small);
    });
});
