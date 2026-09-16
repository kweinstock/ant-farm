// Grid tiles + passability. Phase 3a: tiles stop being uniform — a freshly
// created grid is solid undug SOIL (value 0, so a zero-filled Uint8Array is
// correct "nothing dug yet" by construction, no initialization loop needed),
// and world/nest.ts's createStarterNest carves TUNNEL/CHAMBER/EXIT into it.
// WALL is reserved here but unused beyond maybe the grid's outer ring — no
// wall-specific logic exists yet, it's just a distinct value so "undug SOIL"
// and "deliberately impassable WALL" aren't the same tile type.

export type Position = {
    x: number;
    y: number;
};

// Small integers because `tiles` is a Uint8Array — an object/string enum
// wouldn't fit in one byte per tile. `as const` + the derived TileType union
// (rather than a plain `enum`) keeps these as literal numbers TypeScript can
// narrow on, without pulling in TS's own enum runtime object.
export const TILE = {
    SOIL: 0,
    TUNNEL: 1,
    CHAMBER: 2,
    WALL: 3,
    EXIT: 4,
    GROUND: 5,
    // Phase 7: surface obstacles. Two distinct types, not one — rendering
    // wants to draw a rock lump differently from a tree canopy — but both
    // are impassable, same as WALL. isPassable's whitelist below means
    // neither needs any special-casing to become blocked; they're blocked
    // simply by not being on the list.
    ROCK: 6,
    TREE: 7,
} as const;

export type TileType = (typeof TILE)[keyof typeof TILE]

// `tiles` is a flat, row-major array rather than a 2D array of arrays. Same
// data, but one contiguous block of memory instead of N separate row objects
// — cheaper to allocate/copy/serialize at real scale.
export type Grid = {
    width: number;
    height: number;
    tiles: Uint8Array;
};

export function createGrid(width: number, height: number): Grid {
    // A freshly allocated Uint8Array is zero-filled by the platform, and 0 is
    // TILE.SOIL — "solid undug earth" is the default with no explicit
    // initialization loop required. That correctness depends on SOIL staying
    // 0 in the TILE map above; don't renumber it without checking this.
    return {
        width,
        height,
        tiles: new Uint8Array(width * height),
    };
}

// Row-major: index = row * width + column. Every tiles[...] access in this
// file and elsewhere has to agree on this convention.
export function getIndex(grid: Grid, x: number, y: number): number {
    return y * grid.width + x;
}

export function isInBounds(grid: Grid, x: number, y: number): boolean {
    return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

export function tileAt(grid: Grid, x: number, y: number): TileType {
    return grid.tiles[getIndex(grid, x, y)] as TileType;
}

// Mutates `grid.tiles` in place — the one deliberate break from this
// codebase's otherwise-universal "return a new copy" convention (see
// rng.ts, world/resources.ts, colony/brood.ts, etc.). Safe here because the
// only caller in Phase 3a is createStarterNest, building a Grid that hasn't
// been placed into a ColonyState yet — the same "mutate while under
// construction, then treat as fixed" pattern createInitialState already
// uses for its ants Map. Nothing in the running sim expects a Grid inside a
// live ColonyState to change (there's no digging mechanic yet); if that
// changes later, setTile needs to return a new Grid instead, and every
// caller needs to stop assuming this is a no-op-returning mutation.
export function setTile(grid: Grid, x: number, y: number, type: TileType): void {
    grid.tiles[getIndex(grid, x, y)] = type;
}

// Not passable: SOIL (undug), WALL (deliberately blocked), and — Phase 7 —
// ROCK/TREE (surface obstacles). Passable: TUNNEL, CHAMBER, EXIT, GROUND —
// anywhere an ant can actually stand or walk through. This is the one
// predicate the whole movement system (wander, every distance-field BFS,
// everything in ants/movement.ts) should lean on — duplicating this check
// inline anywhere else risks it drifting out of sync with this definition.
//
// Deliberately a whitelist, not a blacklist: ROCK/TREE need no explicit
// exclusion here, they're impassable simply by not appearing in the list
// below. Keep it that way — a blacklist would silently pass any future
// tile type someone adds and forgets to exclude.
export function isPassable(grid: Grid, x: number, y: number): boolean {
    if (!isInBounds(grid, x,y)) {
        return false;
    }

    const tile = tileAt(grid, x, y);
    return tile === TILE.TUNNEL || tile === TILE.CHAMBER || tile ===  TILE.EXIT || tile === TILE.GROUND;
}


// Shared by anything scoring candidate tiles by proximity — movement.ts's
// stepToward, world/nest.ts's nearestTileOf, world/surface.ts's
// nearestPile, ants/senses.ts's sight-radius check. One copy instead of
// four near-identical ones was starting to drift risk for zero reason —
// this is pure arithmetic, not something that should ever vary by caller.
export function manhattanDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// 4-directional only — deliberately matches rng.ts's DIRECTIONS_4, not
// DIRECTIONS_8. index.ts calls randomDirection(seed, false) to stay in sync;
// if this list ever grows to include diagonals, that call needs to flip too,
// or the ant will "pick" directions this function can never confirm as a
// valid neighbor (see the note above randomDirection in rng.ts).
export function getNeighbors(grid: Grid, x: number, y: number): Position[] {
    const neighbors: Position[] = [];

    const directions: Position[] = [
        {x: 0, y: -1}, // up
        {x: 1, y: 0},  // right
        {x: 0, y: 1},  // down
        {x: -1, y: 0}, // left
    ];

    for (const direction of directions) {
        const nx = x + direction.x;
        const ny = y + direction.y;

        if (isInBounds(grid, nx, ny)) {
            neighbors.push({x: nx, y: ny})
        }
    }

    return neighbors;
}

// The 4-neighbors that are BOTH in bounds AND passable. This is what
// movement actually needs (wander's fallback-to-staying-put check, and the
// distance-field BFS this phase adds) — giving it one home means the
// passability check can't be forgotten in one call site while it's present
// in another. Built on getNeighbors + isPassable rather than duplicating the
// direction list a third time.
export function passableNeighbors(grid: Grid, x: number, y: number): Position[] {
    return getNeighbors(grid, x, y).filter((neighbor) => isPassable(grid, neighbor.x, neighbor.y));
}

// Sentinel for "impassable or unreachable from the seed tile(s)" in a
// distance field. 0x7FFF (32767) is the max value an Int16Array's signed
// range can hold and comfortably distinct from any real distance either
// grid this codebase builds could ever produce.
//
// Moved here from world/nest.ts in Phase 7: this and distanceField/
// fieldToTile below are pure grid operations with no nest-specific
// concepts (chambers, roles) baked in — nest.ts was just the first
// consumer. The surface becomes a second real consumer this phase
// (obstacle-aware routing to the hole/patches/graveyard), so this is where
// they belong. nest.ts re-exports all three so existing call sites that
// import them from "./nest" keep working unchanged.
export const UNREACHABLE_DISTANCE = 0x7fff;

// Multi-source BFS: every tile of `seedTiles` starts the queue at distance
// 0 simultaneously (not one BFS per tile), so a multi-tile source measures
// "distance to the nearest seed tile," not distance to one arbitrarily
// chosen tile among them. No RNG involved, but the neighbor iteration
// order is still fixed (via passableNeighbors, which itself fixes
// direction order above) — that's what makes the resulting field
// byte-identical every run, not just "probably the same."
export function distanceField(grid: Grid, seedTiles: Position[]): Int16Array {
    const field = new Int16Array(grid.width * grid.height).fill(UNREACHABLE_DISTANCE);
    const queue: Position[] = [];

    for (const tile of seedTiles) {
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

// Memoised single-target distance fields. distanceField(grid, [tile]) is a
// pure function of the grid (static for a whole run on both the nest and
// the surface — no digging, no surface terraforming) and the tile, so the
// result can be cached and reused. Keyed by grid identity via a WeakMap,
// so a discarded Grid's fields are collected with it (tests build many —
// both nest grids and, as of Phase 7, surface grids).
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

export function hasLineOfSight(grid: Grid, a: Position, b: Position): boolean {
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;

    const dx = Math.abs(x1 - x0);
    const sx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
    const dy = -Math.abs(y1 - y0);
    const sy = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
    let err = dx + dy;

    let first = true; // the first point plotted is `a` itself — skip it

    while (!(x0 === x1 && y0 === y1)) {
        if (!first) {
            const tile = tileAt(grid, x0, y0);
            if (tile === TILE.ROCK || tile === TILE.TREE) {
                return false;
            }
        }
        first = false;

        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }

    return true;
}