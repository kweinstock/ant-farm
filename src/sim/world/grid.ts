export type Position = {
    x: number;
    y: number;
};

// `tiles` is a flat, row-major array rather than a 2D array of arrays. Same
// data, but one contiguous block of memory instead of N separate row objects
// — cheaper to allocate/copy/serialize once this scales to a real grid and
// thousands of ants scanning it every tick. Phase 1 doesn't read `tiles` for
// anything yet (no tile types, no walls) — it exists so state.ts has
// somewhere to hold the world, and so getNeighbors has bounds to respect.
export type Grid = {
    width: number;
    height: number;
    tiles: Uint8Array;
};

export function createGrid(width: number, height: number): Grid {
    return {
        width,
        height,
        tiles: new Uint8Array(width * height),
    };
}

// Row-major: index = row * width + column. Not used yet (nothing reads
// `tiles` in Phase 1) but this is the convention every future tiles[...]
// access has to agree on.
export function getIndex(grid: Grid, x: number, y: number): number {
    return y * grid.width + x;
}

export function isInBounds(grid: Grid, x: number, y: number): boolean {
    return (
        x >= 0 &&
        x < grid.width &&
        y >= 0 &&
        y < grid.height
    );
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