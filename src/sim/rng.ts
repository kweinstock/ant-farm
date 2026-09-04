// Seeded PRNG (mulberry32). Deliberately a pure function, not a class with
// internal state: `seed` in, `{value, seed}` out. That keeps ColonyState a
// plain serializable object — every caller pulls state.rngSeed out, calls
// this, uses the value, and writes the returned `seed` back into state. If
// anything cached its own seed in a closure instead, replaying ticks after a
// Durable Object restart (Phase 6/7) would silently diverge from the version
// that ran before the restart.
export type RngResult = {
    value: number;
    seed: number;
}

export type Direction = {
    dx: number,
    dy: number
}

const DIRECTIONS_4: Direction[] = [
    {dx: 0, dy: -1}, // north
    {dx: 1, dy: 0}, // east
    {dx: 0, dy: 1}, // south
    {dx: -1, dy: 0}, // west
];

const DIRECTIONS_8: Direction[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

export function rng(seed: number): RngResult {
    // The "seed" that persists between calls is this incremented counter, NOT
    // the scrambled `t`. `t` is thrown away every call and only exists to
    // produce this call's `value` — that's what makes mulberry32 cheap (one
    // xorshift/multiply pass) while still passing basic randomness tests.
    const nextSeed = (seed + 0x6d2b79f5) >>> 0;

    let t = nextSeed
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    // >>> 0 forces an unsigned 32-bit int before dividing, so `value` lands in [0, 1).
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    return {
        value,
        seed: nextSeed,
    };
}

// Note: `diagnols` picks between 4-directional and 8-directional movement.
// Phase 1's grid (world/grid.ts getNeighbors) only ever offers 4-directional
// neighbors, so index.ts calls this with `false`. The 8-direction option is
// here for when diagonal movement is wired up later — until grid.ts supports
// it too, passing `true` would let the ant "choose" directions the neighbor
// check then rejects, silently biasing it toward standing still.
export function randomDirection(seed: number, diagnols = true): { value: Direction; seed: number} {
    const directions = diagnols ? DIRECTIONS_8 : DIRECTIONS_4;

    const result = rng(seed)
    const index = Math.floor(result.value * directions.length);

    return {
        value: directions[index],
        seed: result.seed,
    };
}

// Inclusive on both ends: randomInt(seed, 1, 3) can return 1, 2, or 3.
export function randomInt(seed: number, min: number, max: number): { value: number; seed: number } {
    const result = rng(seed);
    const value = Math.floor(result.value * (max - min + 1)) + min;

    return {
        value,
        seed: result.seed,
    };
}
