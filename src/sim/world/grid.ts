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

// Not passable: SOIL (undug) and WALL (deliberately blocked). Passable:
// TUNNEL, CHAMBER, EXIT — anywhere an ant can actually stand or walk
// through. This is the one predicate the whole movement system (wander,
// the distance-field BFS, everything in ants/movement.ts) should lean on —
// duplicating this check inline anywhere else risks it drifting out of sync
// with this definition.
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