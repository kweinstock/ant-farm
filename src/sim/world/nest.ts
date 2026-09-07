// Chambers, the starter nest layout, and per-role distance fields. The
// layout below is hand-authored, not procedural — sketched on paper first
// (see this response's ASCII rendering) to make sure every chamber touches
// a tunnel and the whole dug volume is one connected component. No
// chamber-to-chamber adjacency graph yet (the roadmap mentions one) — the
// per-tile distance fields already give movement everything it needs this
// phase; build the graph only if a later phase wants higher-level routing
// ("go through commons, avoid the nursery").
import { createGrid, getIndex, manhattanDistance, passableNeighbors, setTile, TILE, type Grid, type Position } from "./grid";

export type ChamberRole = "QUEEN" | "NURSERY" | "FOOD_STORAGE" | "COMMONS" | "EXIT";

export type Chamber = {
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
    distanceFields: Record<ChamberRole, Int16Array>;
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

type TunnelSegment = {
    from: Position;
    to: Position;
};

// This layout assumes exactly this grid size — see createStarterNest's
// runtime check below for why a mismatch fails loudly instead of silently
// corrupting the nest.
export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 16;

// Hand-authored, matching the ASCII sketch: queen chamber deep and central,
// nursery immediately beside it, food store and commons off a central
// tunnel higher up.
const CHAMBER_DEFS: ChamberDef[] = [
    { role: "COMMONS", rect: { x0: 10, y0: 3, x1: 14, y1: 5 } },
    { role: "FOOD_STORAGE", rect: { x0: 4, y0: 8, x1: 6, y1: 9 } },
    { role: "QUEEN", rect: { x0: 10, y0: 13, x1: 12, y1: 14 } },
    { role: "NURSERY", rect: { x0: 13, y0: 13, x1: 15, y1: 14 } },
];

// Three straight runs: commons down to the main corridor, the main corridor
// itself, and the descent from the corridor down to queen depth.
const TUNNEL_SEGMENTS: TunnelSegment[] = [
    { from: { x: 12, y: 6 }, to: { x: 12, y: 6 } },
    { from: { x: 4, y: 7 }, to: { x: 19, y: 7 } },
    { from: { x: 12, y: 8 }, to: { x: 12, y: 12 } },
];

// The exit shaft is its own thing, not a CHAMBER_DEFS entry — its tiles get
// TILE.EXIT, not TILE.CHAMBER, and it still becomes its own Chamber record
// with role "EXIT" so chamberAt/tilesOf/nearestTileOf all treat it the same
// as any other role.
const EXIT_SHAFT: Rect = { x0: 12, y0: 0, x1: 12, y1: 2 };

function tilesInRect(rect: Rect): Position[] {
    const tiles: Position[] = [];

    for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
            tiles.push({x, y});
        }
    }

    return tiles;
}

function tilesInSegment(segment: TunnelSegment): Position[] {
    const {from, to} = segment;

    if (from.x !== to.x && from.y !== to.y) {
        throw new Error(`Tunnel segment ${JSON.stringify(segment)} is not a straight run`);
    }

    const tiles: Position[] = [];

    if (from.x === to.x) {
        const [y0, y1] = from.y < to.y ? [from.y, to.y] : [to.y, from.y];
        for (let y = y0; y <= y1; y++) {
            tiles.push({x: from.x, y});
        }
    } else {
        const [x0, x1] = from.x <= to.x ? [from.x, to.x] : [to.x, from.x];
        for (let x = x0; x <= x1; x++) {
            tiles.push({ x, y: from.y });
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
    return shaftMouth(tilesOf(nest, "EXIT"));
}

export function createStarterNest(width: number, height: number): { grid: Grid; nest: Nest } {
    // The CHAMBER_DEFS / TUNNEL_SEGMENTS / EXIT_SHAFT rects are authored for
    // exactly GRID_WIDTH x GRID_HEIGHT. On a smaller grid, setTile's out-of-
    // range writes silently no-op on the Uint8Array — you'd get a
    // half-dug, disconnected nest with no error. Fail loud instead.
    if (width !== GRID_WIDTH || height !== GRID_HEIGHT) {
        throw new Error(
            `createStarterNest: layout is authored for ${GRID_WIDTH}x${GRID_HEIGHT}, got ${width}x${height}`
        );
    }

    const grid = createGrid(width, height);
    const chambers: Chamber[] = [];

    for (const def of CHAMBER_DEFS) {
        const tiles = tilesInRect(def.rect);

        for (const tile of tiles) {
            setTile(grid, tile.x, tile.y, TILE.CHAMBER);
        }

        chambers.push({role: def.role, tiles});
    }

    for (const segment of TUNNEL_SEGMENTS) {
        for (const tile of tilesInSegment(segment)) {
            setTile(grid, tile.x, tile.y, TILE.TUNNEL);
        }
    }

    const exitTiles = tilesInRect(EXIT_SHAFT);
    for (const tile of exitTiles) {
        setTile(grid, tile.x, tile.y, TILE.EXIT);
    }
    chambers.push({role: "EXIT", tiles: exitTiles});

    // Computed once, here, and stored on the returned Nest rather than
    // cached in a module-level variable — the nest is static in Phase 3a (no
    // digging), so this never needs to be recomputed mid-run, and storing it
    // on the struct instead of a hidden cache keeps step() pure and makes
    // Phase 7 deserialization trivial (recompute in the DO constructor from
    // the same grid + chamber data, don't try to serialize a hidden cache).
    const distanceFields = {} as Record<ChamberRole, Int16Array>;
    for (const chamber of chambers) {
        // EXIT is the one deliberate special case here. Every other chamber
        // seeds its field from ALL of its own tiles (multi-source BFS:
        // "distance to the nearest tile of this chamber") — but EXIT seeds
        // from only the mouth tile. If it seeded from all three shaft tiles
        // like everything else, the other two shaft tiles would ALSO read
        // distance 0, and moveToward would happily consider the field
        // "arrived" one or two tiles short of the actual mouth. 3b's
        // crossExit action fires at exactly one tile (exitMouth), so
        // "descend the EXIT field to distance 0" needs to land a forager
        // there specifically, not anywhere in the shaft.
        const seedTiles = chamber.role === "EXIT" ? [shaftMouth(chamber.tiles)] : chamber.tiles;
        distanceFields[chamber.role] = distanceField(grid, seedTiles);
    }

    return {grid, nest: {chambers, distanceFields}};
}

// Scans every chamber's tile list — roughly 5 chambers, ~35 tiles total at
// this nest size. Cheap enough per call for now; if profiling ever says
// otherwise, the fix is a Map<tileIndex, ChamberRole> built once alongside
// the chambers in createStarterNest, not a rewrite of this function's
// callers.
export function chamberAt(nest: Nest, pos: Position): ChamberRole | undefined {
    for (const chamber of nest.chambers) {
        for (const tile of chamber.tiles) {
            if (tile.x === pos.x && tile.y === pos.y) {
                return chamber.role;
            }
        }
    }
    return undefined;
}

export function tilesOf(nest: Nest, role: ChamberRole): Position[] {
    const chamber = nest.chambers.find((c) => c.role === role);
    return chamber ? chamber.tiles : [];
}

// Straight-line distance among a chamber's own tiles, NOT walking distance
// through tunnels — that's fine for "which tile in this chamber should I aim
// for," since the distance field (below) is what actually handles real
// pathing once movement is heading toward the chamber generally. This
// function also knows nothing about occupancy — "nearest tile," not
// "nearest free tile." Anything that cares about capacity (nursery slots
// capped at 3) has to filter tilesOf's result itself before or instead of
// calling this.
export function nearestTileOf(nest: Nest, role: ChamberRole, pos: Position): Position | undefined {
    const tiles = tilesOf(nest, role);

    if (tiles.length === 0) {
        return undefined;
    }

    let nearest = tiles[0];
    let nearestDistance = manhattanDistance(nearest, pos)

    for (const tile of tiles.slice(1)) {
        const distance = manhattanDistance(tile, pos);
        if (distance < nearestDistance) {
            nearest = tile;
            nearestDistance = distance;
        }
    }

    return nearest;
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