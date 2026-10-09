import { describe, expect, it } from "vitest";

import { createSurface, spawnFoodPiles, groundConnectedFromHole, inGraveyard } from "../../src/sim/world/surface";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { tileAt, TILE, isPassable, manhattanDistance } from "../../src/sim/world/grid";
import { SURFACE_WIDTH, SURFACE_HEIGHT, FERTILE_PATCHES } from "../../src/sim/params";

type Rect = { x0: number; y0: number; x1: number; y1: number };
const inRect = (x: number, y: number, r: Rect) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
const inAnyPatch = (x: number, y: number) => FERTILE_PATCHES.some((p) => inRect(x, y, p));

describe("surface ecology (Phase 7)", () => {
    const surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);

    it("createSurface is deterministic — identical grid every call", () => {
        const a = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);
        const b = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);
        expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
        expect(a.graveyard).toEqual(b.graveyard);
        expect(a.patches).toEqual(b.patches);
    });

    it("the graveyard sits just outside the hole — a short haul, not on top of it — and is clear of obstacles", () => {
        const gvCentre = {
            x: Math.floor((surface.graveyard.x0 + surface.graveyard.x1) / 2),
            y: Math.floor((surface.graveyard.y0 + surface.graveyard.y1) / 2),
        };
        const d = manhattanDistance(gvCentre, surface.holePos);
        expect(d).toBeGreaterThan(6); // clear of the hole exclusion
        expect(d).toBeLessThan(SURFACE_WIDTH / 4); // near the colony, not across the map

        for (let y = surface.graveyard.y0; y <= surface.graveyard.y1; y++) {
            for (let x = surface.graveyard.x0; x <= surface.graveyard.x1; x++) {
                expect(tileAt(surface.grid, x, y)).toBe(TILE.GROUND);
            }
        }
    });

    it("the forest floor is scattered ROCK/TREE, never in the graveyard or on the hole, and patches read as clearings", () => {
        let obstacles = 0;
        let patchTiles = 0;
        let patchObstacles = 0;
        for (let y = 0; y < SURFACE_HEIGHT; y++) {
            for (let x = 0; x < SURFACE_WIDTH; x++) {
                const t = tileAt(surface.grid, x, y);
                // The only surface tile types are GROUND + the two obstacles.
                expect(t === TILE.GROUND || t === TILE.ROCK || t === TILE.TREE).toBe(true);
                if (inAnyPatch(x, y)) patchTiles += 1;
                if (t === TILE.ROCK || t === TILE.TREE) {
                    obstacles += 1;
                    if (inAnyPatch(x, y)) patchObstacles += 1;
                    expect(inGraveyard(surface, { x, y })).toBe(false);
                    expect(manhattanDistance({ x, y }, surface.holePos)).toBeGreaterThanOrEqual(6);
                }
            }
        }
        // A real forest floor — not the pre-Phase-7 handful.
        expect(obstacles).toBeGreaterThan(300);
        const totalTiles = SURFACE_WIDTH * SURFACE_HEIGHT;
        const openDensity = (obstacles - patchObstacles) / (totalTiles - patchTiles);
        const patchDensity = patchObstacles / patchTiles;
        // Patches are clearings: much sparser cover than the open forest.
        expect(patchDensity).toBeLessThan(openDensity / 2);
    });

    it("every TREE tile belongs to a complete 2x2 canopy; rocks are single tiles", () => {
        for (let y = 0; y < SURFACE_HEIGHT; y++) {
            for (let x = 0; x < SURFACE_WIDTH; x++) {
                if (tileAt(surface.grid, x, y) !== TILE.TREE) continue;
                const inBlock = [[-1, -1], [-1, 0], [0, -1], [0, 0]].some(([ox, oy]) =>
                    [[0, 0], [1, 0], [0, 1], [1, 1]].every(
                        ([dx, dy]) => tileAt(surface.grid, x + ox + dx, y + oy + dy) === TILE.TREE,
                    ),
                );
                expect(inBlock, `TREE at ${x},${y} is not part of a full 2x2`).toBe(true);
            }
        }
    });

    it("the forest is evenly scattered — no map-spanning bare clearing", () => {
        // Largest fully-open (GROUND-only) axis-aligned square anywhere on the
        // map. A patchy noise field with hard thresholds would leave big
        // deserts; the modulated scatter shouldn't.
        const clearBelow: number[][] = Array.from({ length: SURFACE_HEIGHT }, () => new Array(SURFACE_WIDTH).fill(0));
        for (let y = SURFACE_HEIGHT - 1; y >= 0; y--) {
            for (let x = 0; x < SURFACE_WIDTH; x++) {
                clearBelow[y][x] =
                    tileAt(surface.grid, x, y) === TILE.GROUND ? 1 + (y + 1 < SURFACE_HEIGHT ? clearBelow[y + 1][x] : 0) : 0;
            }
        }
        let maxSquare = 0;
        for (let y = 0; y < SURFACE_HEIGHT; y++) {
            let width = 0;
            for (let x = 0; x < SURFACE_WIDTH; x++) {
                if (clearBelow[y][x] === 0) {
                    width = 0;
                    continue;
                }
                width += 1;
                let minH = Infinity;
                for (let k = x - width + 1; k <= x; k++) minH = Math.min(minH, clearBelow[y][k]);
                maxSquare = Math.max(maxSquare, Math.min(width, minH));
            }
        }
        expect(maxSquare).toBeLessThan(22);
    });

    it("obstacles never wall anything off — every GROUND tile is reachable from the hole", () => {
        const reached = groundConnectedFromHole(surface);
        let passable = 0;
        for (let y = 0; y < SURFACE_HEIGHT; y++) {
            for (let x = 0; x < SURFACE_WIDTH; x++) {
                if (isPassable(surface.grid, x, y)) passable += 1;
            }
        }
        expect(reached.size).toBe(passable);

        // Explicitly: every *open* patch tile and every graveyard tile is
        // reachable (patches carry sparse obstacles now; those aren't tiles
        // you can stand on, so they're not expected in the reachable set).
        for (const patch of FERTILE_PATCHES) {
            for (let y = patch.y0; y <= patch.y1; y++) {
                for (let x = patch.x0; x <= patch.x1; x++) {
                    if (tileAt(surface.grid, x, y) !== TILE.GROUND) continue;
                    expect(reached.has(`${x},${y}`), `patch tile ${x},${y} unreachable`).toBe(true);
                }
            }
        }
        for (let y = surface.graveyard.y0; y <= surface.graveyard.y1; y++) {
            for (let x = surface.graveyard.x0; x <= surface.graveyard.x1; x++) {
                expect(tileAt(surface.grid, x, y)).toBe(TILE.GROUND); // graveyard is always clear
                expect(reached.has(`${x},${y}`), `graveyard tile ${x},${y} unreachable`).toBe(true);
            }
        }
    });

    it("food spawns overwhelmingly inside fertile patches, never on an obstacle", () => {
        // Force many spawns: after each spawn, clear the pile list so the next
        // call spawns again.
        let s = surface;
        let seed = 777;
        let inPatch = 0;
        let open = 0;

        for (let i = 0; i < 40000 && inPatch + open < 3000; i++) {
            const r = spawnFoodPiles(s, seed, "SPRING");
            seed = r.seed;
            if (r.surface.foodPiles.length > s.foodPiles.length) {
                const p = r.surface.foodPiles[r.surface.foodPiles.length - 1];
                expect(tileAt(s.grid, p.pos.x, p.pos.y)).toBe(TILE.GROUND); // never rock/tree
                if (inAnyPatch(p.pos.x, p.pos.y)) inPatch += 1;
                else open += 1;
                s = { ...r.surface, foodPiles: [] };
            } else {
                s = r.surface;
            }
        }

        expect(inPatch + open).toBeGreaterThan(500); // the loop actually produced spawns
        expect(inPatch / (inPatch + open)).toBeGreaterThan(0.8);
    });

    it("in a running colony, no ant ever stands on an obstacle, and foraging still feeds the store", () => {
        let state = createInitialState(20260909);
        let everRestocked = false;
        let prevStore = state.foodStore.amount;

        for (let t = 0; t < 3000; t++) {
            state = step(state, 1).state;
            for (const ant of state.ants.values()) {
                if (ant.location.where !== "surface") continue;
                const t2 = tileAt(state.surface.grid, ant.location.pos.x, ant.location.pos.y);
                expect(t2 === TILE.ROCK || t2 === TILE.TREE, `ant on obstacle at ${ant.location.pos.x},${ant.location.pos.y}`).toBe(false);
            }
            if (state.foodStore.amount > prevStore) everRestocked = true;
            prevStore = state.foodStore.amount;
        }

        expect(everRestocked).toBe(true);
        expect(state.ants.has(state.queenId)).toBe(true); // didn't starve out
    });

    it("determinism holds across the patch-biased spawn + obstacle routing", () => {
        const seed = 13579;
        const big = step(createInitialState(seed), 2500);
        let small = createInitialState(seed);
        for (let i = 0; i < 2500; i++) small = step(small, 1).state;
        expect(big.state).toEqual(small);
    });
});
