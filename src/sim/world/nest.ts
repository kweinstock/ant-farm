// Chambers, the starter nest layout, and per-chamber distance fields.
//
// The layout is a mirror-symmetric cross-section built from rects: a central
// trunk, two full-height bypass shafts, and worker chambers in left/right
// pairs hanging off the trunk. It's authored as parameters (LEFT_PAIRS,
// LEFT_DOORS, the corridor rects) rather than a flat tile list so "the left
// and right halves match" and "every chamber has exactly one doorway" are
// true by construction — test/sim/nest.test.ts checks both. Still no
// chamber-to-chamber adjacency graph (the roadmap mentions one); the
// per-chamber distance fields cover routing this phase.
import { GRID_HEIGHT, GRID_WIDTH } from "../params";
import { createGrid, getIndex, passableNeighbors, setTile, TILE, type Grid, type Position } from "./grid";

export type ChamberRole = "QUEEN" | "NURSERY" | "FOOD_STORAGE" | "COMMONS" | "EXIT";
export type ChamberId = string;

export type Chamber = {
    id: ChamberId;
    role: ChamberRole;
    tiles: Position[];
}

// Sentinel for "impassable or unreachable from this role's chamber" in a
// distance field. 0x7FFF (32767) is the max value an Int16Array's signed
// range can hold and comfortably distinct from any real distance this grid
// could ever produce (width + height is nowhere close).
export const UNREACHABLE_DISTANCE = 0x7fff;

export type Nest = {
    chambers: Chamber[];
    distanceFields: Record<ChamberId, Int16Array>;
    tileChamber: (ChamberId | undefined)[];
};

type Rect = {
    x0: number;
    y0: number; 
    x1: number; 
    y1: number
};

type ChamberDef = {
    role: Exclude<ChamberRole, "EXIT">;
    rect: Rect;
};

// Symmetric excavated nest built around one central trunk. The entrance
// shaft drops into a wide atrium; the trunk descends from there through a
// deep royal nursery and antechamber to the queen. Worker chambers hang off
// the trunk in mirror-image left/right pairs — each joined to the trunk (and
// to a full-height bypass shaft) by exactly ONE short 2-wide doorway. Every
// other chamber edge is left as undug SOIL, which is impassable, so ants can
// only enter through the door — no separate WALL tile needed. The two bypass
// shafts loop the trunk top-to-bottom so vertical traffic isn't forced
// through one column, and brood chambers sit OFF the trunk (a corridor of
// through-traffic is no place for eggs). The dug volume is kept well inside
// the grid — the SOIL margin on every side and between the chamber levels is
// deliberate room for the colony to excavate into later (Phase 11).
const MX = GRID_WIDTH - 1;
const mrect = (r: Rect): Rect => ({ x0: MX - r.x1, y0: r.y0, x1: MX - r.x0, y1: r.y1 });

// Vertical corridors, 2 tiles wide, carved as thin rects (mirror-safe,
// unlike a widened segment whose extra lane always sits on the same side).
const EXIT_SHAFT: Rect = { x0: 39, y0: 0, x1: 40, y1: 3 };
const TRUNK: Rect = { x0: 39, y0: 3, x1: 40, y1: 47 };
const SHAFT_L: Rect = { x0: 24, y0: 9, x1: 25, y1: 43 };
const CORRIDOR_RECTS: Rect[] = [TRUNK, SHAFT_L, mrect(SHAFT_L)];

// Centre-line chambers (self-symmetric). Only the atrium and antechamber sit
// on the trunk — both are thoroughfares by nature. The queen hangs off the
// trunk's bottom end; nothing routes through her.
const ATRIUM: ChamberDef = { role: "COMMONS", rect: { x0: 30, y0: 4, x1: 49, y1: 8 } };
const ANTECHAMBER: ChamberDef = { role: "COMMONS", rect: { x0: 32, y0: 40, x1: 47, y1: 43 } };
const QUEEN: ChamberDef = { role: "QUEEN", rect: { x0: 31, y0: 47, x1: 48, y1: 51 } };

// Left-column chambers, x 28..36 (mirrored to the right). Shallow -> deep:
// food store, commons, nursery. The nursery is the deepest, closest to the
// queen for a short nurse ferry, and reached by its own door — not by the
// trunk running through it.
const LEFT_COL = { x0: 28, x1: 36 };
type PairDef = { role: Exclude<ChamberRole, "EXIT">; y0: number; y1: number; door: number };
const LEFT_PAIRS: PairDef[] = [
    { role: "FOOD_STORAGE", y0: 11, y1: 16, door: 13 },
    { role: "COMMONS", y0: 20, y1: 25, door: 22 },
    { role: "NURSERY", y0: 29, y1: 35, door: 31 },
];

// Every 2-wide doorway, left side (mirrored to the right).
const LEFT_DOORS: Rect[] = [
    { x0: 26, y0: 6, x1: 29, y1: 7 },   // atrium <-> bypass shaft
    { x0: 26, y0: 41, x1: 31, y1: 42 }, // antechamber <-> bypass shaft
    // each left-column chamber <-> trunk (right of it) and <-> bypass shaft (left of it)
    ...LEFT_PAIRS.flatMap((p): Rect[] => [
        { x0: LEFT_COL.x1 + 1, y0: p.door, x1: 38, y1: p.door + 1 },
        { x0: 26, y0: p.door, x1: LEFT_COL.x0 - 1, y1: p.door + 1 },
    ]),
];

const CHAMBER_DEFS: ChamberDef[] = [
    ATRIUM, // COMMONS-0
    ...LEFT_PAIRS.flatMap((p): ChamberDef[] => {
        const left: Rect = { x0: LEFT_COL.x0, y0: p.y0, x1: LEFT_COL.x1, y1: p.y1 };
        return [
            { role: p.role, rect: left },
            { role: p.role, rect: mrect(left) },
        ];
    }),
    ANTECHAMBER, // COMMONS-3
    QUEEN, // QUEEN-0
];

const DOOR_RECTS: Rect[] = [...LEFT_DOORS, ...LEFT_DOORS.map(mrect)];

function tilesInRect(rect: Rect): Position[] {
    const tiles: Position[] = [];

    for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
            tiles.push({x, y});
        }
    }

    return tiles;
}

// Shared by exitMouth (public, takes a real Nest) and createStarterNest
// itself (which needs this same "topmost tile" logic on a Chamber it's
// still assembling, before any Nest object exists to call exitMouth on).
function shaftMouth(tiles: Position[]): Position {
    let mouth = tiles[0] ?? {x: 0, y: 0};

    for (const tile of tiles) {
        if (tile.y < mouth.y) {
            mouth = tile;
        }
    }

    return mouth;
}

// The one tile foraging.ts's crossExit checks against — not "somewhere in
// the EXIT chamber," but specifically the top of the shaft, since that's
// the tile the EXIT distance field now seeds from (see the special case in
// createStarterNest below) and the only tile a forager descending that
// field will actually arrive at.
export function exitMouth(nest: Nest): Position {
    return shaftMouth(chambersOf(nest, "EXIT")[0]?.tiles ?? []);
}

export function createStarterNest(width: number, height: number): { grid: Grid; nest: Nest } {
    // The layout rects are authored for exactly GRID_WIDTH x GRID_HEIGHT. On
    // a smaller grid, setTile's out-of-range writes silently no-op on the
    // Uint8Array — a half-dug, disconnected nest with no error. Fail loud.
    if (width !== GRID_WIDTH || height !== GRID_HEIGHT) {
        throw new Error(
            `createStarterNest: layout is authored for ${GRID_WIDTH}x${GRID_HEIGHT}, got ${width}x${height}`
        );
    }

    const grid = createGrid(width, height);
    const chambers: Chamber[] = [];

    const roleCounts: Partial<Record<ChamberRole, number>> = {};
    function nextChamberId(role: ChamberRole): ChamberId {
        const n = roleCounts[role] ?? 0;
        roleCounts[role] = n + 1;
        return `${role}-${n}`;
    }

    // 1. Carve chamber interiors.
    for (const def of CHAMBER_DEFS) {
        const tiles = tilesInRect(def.rect);
        for (const tile of tiles) {
            setTile(grid, tile.x, tile.y, TILE.CHAMBER);
        }
        chambers.push({ id: nextChamberId(def.role), role: def.role, tiles });
    }

    // 2. Carve the exit shaft.
    const exitTiles = tilesInRect(EXIT_SHAFT);
    for (const tile of exitTiles) {
        setTile(grid, tile.x, tile.y, TILE.EXIT);
    }
    chambers.push({ id: nextChamberId("EXIT"), role: "EXIT", tiles: exitTiles });

    // 3. Carve corridors and doorways — but never over a chamber or the
    //    exit. A doorway's job is to butt up against a chamber edge, not
    //    replace chamber floor; keeping chamber tiles pure CHAMBER is what
    //    stops an egg or a food deposit ever landing on a "tunnel" tile. Any
    //    chamber edge a corridor doesn't reach is just undug SOIL —
    //    impassable, so it's the wall, no separate tile type required.
    for (const rect of [...CORRIDOR_RECTS, ...DOOR_RECTS]) {
        for (const tile of tilesInRect(rect)) {
            if (grid.tiles[getIndex(grid, tile.x, tile.y)] === TILE.SOIL) {
                setTile(grid, tile.x, tile.y, TILE.TUNNEL);
            }
        }
    }

    // Chamber tiles that survived as real CHAMBER floor (all of them, given
    // step 3 never paves a chamber — but filter defensively so chamberAt /
    // the food gauge / egg placement can trust `chamber.tiles`).
    for (const chamber of chambers) {
        if (chamber.role === "EXIT") continue;
        chamber.tiles = chamber.tiles.filter(
            (t) => grid.tiles[getIndex(grid, t.x, t.y)] === TILE.CHAMBER
        );
    }

    const tileChamber: (ChamberId | undefined)[] = new Array(grid.width * grid.height).fill(undefined);
    for (const chamber of chambers) {
        for (const tile of chamber.tiles) {
            tileChamber[getIndex(grid, tile.x, tile.y)] = chamber.id;
        }
    }

    const distanceFields = {} as Record<ChamberId, Int16Array>;
    for (const chamber of chambers) {
        // EXIT is still the one deliberate special case — see the original
        // note: it seeds from shaftMouth only, not all its tiles, so a
        // descending forager lands on exactly the tile crossExit checks.
        // Now one BFS per chamber INSTANCE rather than per role — a nest
        // with 3 nurseries runs 3 independent BFS passes, not 1.
        const seedTiles = chamber.role === "EXIT" ? [shaftMouth(chamber.tiles)] : chamber.tiles;
        distanceFields[chamber.id] = distanceField(grid, seedTiles);
    }

    return {grid, nest: {chambers, distanceFields, tileChamber}};
}

// O(1) via tileChamber, bounds-checked against the grid dims the nest was
// built at (createStarterNest requires GRID_WIDTH x GRID_HEIGHT, so this is
// safe to assume here without threading a Grid through every call site).
export function chamberIdAt(nest: Nest, pos: Position): ChamberId | undefined {
    if (pos.x < 0 || pos.x >= GRID_WIDTH || pos.y < 0 || pos.y >= GRID_HEIGHT) {
        return undefined;
    }
    return nest.tileChamber[pos.y * GRID_WIDTH + pos.x];
}

// Same signature as before, so senses/jobs/brood/nest-view/weather-hud/
// nursery.test all keep working unchanged. Backed by chamberIdAt (O(1)) plus
// a scan of nest.chambers to resolve id -> role — a fixed ~12 entries
// regardless of nest size, not a scan of every tile like the old version.
export function chamberAt(nest: Nest, pos: Position): ChamberRole | undefined {
    const id = chamberIdAt(nest, pos);
    if (id === undefined) {
        return undefined;
    }
    return nest.chambers.find((chamber) => chamber.id === id)?.role;
}

export function chambersOf(nest: Nest, role: ChamberRole): Chamber[] {
    return nest.chambers.filter((chamber) => chamber.role === role);
}

// Flattened tiles across every instance of the role. Replaces tilesOf at
// every "give me the role's tiles" call site (tests, the food gauge render,
// brood eclosion, the queen lay gate, state.ts spawn placement) — those
// don't care which instance a tile came from, just the full set.
export function allTilesOf(nest: Nest, role: ChamberRole): Position[] {
    return chambersOf(nest, role).flatMap((chamber) => chamber.tiles);
}

// The resolution choke point: among all instances of `role`, optionally
// filtered by `eligible` (e.g. NURSERY instances under capacity), pick the
// one minimizing true walking distance from fromPos — not straight-line —
// and return THAT chamber's distance field, for the caller to descend same
// as before. Ties broken by chamber-id order (candidates are sorted, then
// the first strictly-smaller distance wins, so an earlier id keeps the win
// on a tie). Pure and deterministic: no RNG, same inputs always pick the
// same chamber.
export function nearestChamberField(nest: Nest, role: ChamberRole, fromPos: Position, eligible?: (chamber: Chamber) => boolean): Int16Array | undefined {
    const candidates = chambersOf(nest, role)
        .filter((chamber) => !eligible || eligible(chamber))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const index = fromPos.y * GRID_WIDTH + fromPos.x;

    let best: Chamber | undefined;
    let bestDistance = UNREACHABLE_DISTANCE + 1;

    for (const chamber of candidates) {
        const field = nest.distanceFields[chamber.id];
        const distance = field ? field[index] : UNREACHABLE_DISTANCE;
        if (distance < bestDistance) {
            best = chamber;
            bestDistance = distance;
        }
    }

    return best ? nest.distanceFields[best.id] : undefined;
}

// Memoised single-target distance fields. `distanceField(grid, [tile])` is a
// pure function of the grid (static for the whole run — no digging until
// Phase 11) and the tile, so the result can be cached and reused. Undertakers
// walking to a corpse and nurses walking to an egg / nursery tile
// (ants/undertaking.ts's moveToNestPoint) call this every tick; without the
// cache that's a fresh full-grid BFS + Int16Array allocation per ant per
// tick, which is what made the Phase 6 nest expansion tank the tick rate.
// Keyed by grid identity via a WeakMap, so a discarded ColonyState's fields
// are collected with it (tests build many).
const tileFieldCache = new WeakMap<Grid, Map<string, Int16Array>>();

export function fieldToTile(grid: Grid, target: Position): Int16Array {
    let byTarget = tileFieldCache.get(grid);
    if (byTarget === undefined) {
        byTarget = new Map();
        tileFieldCache.set(grid, byTarget);
    }
    const key = `${target.x},${target.y}`;
    let field = byTarget.get(key);
    if (field === undefined) {
        field = distanceField(grid, [target]);
        byTarget.set(key, field);
    }
    return field;
}

// Multi-source BFS: every tile of `chamberTiles` seeds the queue at distance
// 0 simultaneously (not one BFS per tile), so a multi-tile chamber measures
// "distance to the nearest tile of this chamber," not distance to one
// arbitrarily chosen tile within it. No RNG involved, but the neighbor
// iteration order is still fixed (via passableNeighbors, which itself fixes
// direction order — see grid.ts) — that's what makes the resulting field
// byte-identical every run, not just "probably the same."
export function distanceField(grid: Grid, chamberTiles: Position[]): Int16Array {
    const field = new Int16Array(grid.width * grid.height).fill(UNREACHABLE_DISTANCE);
    const queue: Position[] = [];

    for (const tile of chamberTiles) {
        const index = getIndex(grid, tile.x, tile.y);
        if (field[index] === UNREACHABLE_DISTANCE) {
            field[index] = 0;
            queue.push(tile);
        }
    }

    let head = 0;
    while (head < queue.length) {
        const current = queue[head];
        head += 1;

        const currentDistance = field[getIndex(grid, current.x, current.y)];

        for (const neighbor of passableNeighbors(grid, current.x, current.y)) {
            const neighborIndex = getIndex(grid, neighbor.x, neighbor.y);

            if (field[neighborIndex] === UNREACHABLE_DISTANCE) {
                field[neighborIndex] = currentDistance + 1;
                queue.push(neighbor);
            }
        }
    }

    return field;
}