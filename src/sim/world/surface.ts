// The surface: a separate top-down coordinate space from the nest's side-on
// cross-section (world/grid.ts / world/nest.ts). Reuses the same Grid type
// and helpers — GROUND is just another passable TileType — so every
// movement helper in movement.ts works on both grids without knowing which
// one it's looking at. No BFS here: the surface is obstacle-free (uniform
// GROUND, no walls), so a distance field would be pure overhead — a greedy
// Manhattan step toward a target (movement.ts's stepToward) is always
// optimal on an open grid. This grid exists for structure, spawning, and
// rendering, not for pathing.
//
// SURFACE_WIDTH/HEIGHT and the pile-spawn params live here — the module that
// consumes them (spawnFoodPiles / ageFoodPiles) — rather than in state.ts,
// mirroring how world/nest.ts owns GRID_WIDTH/GRID_HEIGHT and
// world/resources.ts owns EAT_AMOUNT. state.ts and the renderer import from
// here; nothing here imports back, so there's one dependency direction
// (state.ts -> surface.ts) and no cycle.
import { createGrid, manhattanDistance, TILE, type Grid, type Position } from "./grid";
import { randomInt } from "../rng";

export const SURFACE_WIDTH = 40;
export const SURFACE_HEIGHT = 28;

// Probed over 10k ticks (seed 12345): 3-8 piles steady, store held 350-500,
// population ~40-58 while queened. Left as-is.
export const MAX_PILES = 10;
export const PILE_START_AMOUNT = 250;
// Rolled once per tick in spawnFoodPiles. At this rate, once foodPiles.length
// is below MAX_PILES, a spawn attempt succeeds roughly every 20 ticks on
// average — a guess at "3-5 piles exist steadily," not a derived value.
export const PILE_SPAWN_CHANCE = 0.05;
// Comfortably longer than one round trip (~70-100 ticks per the economy
// note) so a pile a forager is actively walking toward doesn't expire out
// from under it in the common case.
export const PILE_DECAY_TICKS = 400;

// Piles never spawn this close to the hole — keeps the immediate mouth of
// the shaft clear instead of a pile spawning right where foragers emerge,
// which would make "find food" trivial and remove the travel time the whole
// economy is built around.
const HOLE_EXCLUSION_RADIUS = 5;

// Bounded retry count for spawnFoodPiles' rejection sampling below. Every
// attempt (accepted or not) draws two RNG values, so this bounds the RNG
// cost of a tick where most of the map is excluded — it does NOT bound
// correctness: failing to find a tile in this many tries just means no pile
// spawns this tick, which is indistinguishable from PILE_SPAWN_CHANCE not
// having rolled at all.
const MAX_SPAWN_ATTEMPTS = 20;

export type FoodPileId = string;

// No `capacity`, no regrow — unlike the nest's foodStore, a surface pile is
// a one-time, depleting resource. Once takeFromPile/ageFoodPiles drives
// `amount` to 0 it's gone for good; a new pile is a new id, not a refill.
export type FoodPile = {
    id: FoodPileId;
    pos: Position;
    amount: number;
    ageTicks: number;
};

type Rect = {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

export type Surface = {
    grid: Grid;
    holePos: Position;
    graveyard: Rect;
    foodPiles: FoodPile[];
    nextPileId: number;
};

function inRect(pos: Position, rect: Rect): boolean {
    return pos.x >= rect.x0 && pos.x <= rect.x1 && pos.y >= rect.y0 && pos.y <= rect.y1;
}

// Soft target: a grave tile prefers to hold this many bodies before the next
// one spills to another tile. Not a hard cap — a busy colony's graveyard can
// exceed the rect's whole capacity (decay is what actually bounds it), and
// then bodies just pile deeper on the least-crowded tiles.
export const CORPSE_PER_GRAVE_TILE = 2;

export function inGraveyard(surface: Surface, pos: Position): boolean {
    return inRect(pos, surface.graveyard);
}

function graveyardTiles(surface: Surface): Position[] {
    const { x0, x1, y0, y1 } = surface.graveyard;
    const tiles: Position[] = [];
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            tiles.push({ x, y });
        }
    }
    return tiles;
}

// Where a hauled body actually gets set down: the graveyard tile with the
// fewest bodies already on it (so the pile spreads instead of stacking on one
// spot), ties broken by nearness to `near` — the undertaker's own position —
// so a body lands roughly where its carrier walked in. `corpses` is scanned
// for placed graveyard bodies only (carried ones are mid-haul, their position
// is a lie synced to the carrier). Fully deterministic: no RNG, fixed tile
// order, deterministic corpse list.
export function graveyardSlot(surface: Surface, corpses: { location: { where: string; pos: Position }; carriedBy?: unknown }[], near: Position): Position {
    const occupancy = new Map<string, number>();
    for (const corpse of corpses) {
        if (corpse.carriedBy === undefined && corpse.location.where === "surface" && inRect(corpse.location.pos, surface.graveyard)) {
            const key = `${corpse.location.pos.x},${corpse.location.pos.y}`;
            occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
        }
    }

    let best: Position | undefined;
    let bestCount = Infinity;
    let bestDist = Infinity;

    for (const tile of graveyardTiles(surface)) {
        const count = occupancy.get(`${tile.x},${tile.y}`) ?? 0;
        const dist = Math.abs(tile.x - near.x) + Math.abs(tile.y - near.y);
        if (count < bestCount || (count === bestCount && dist < bestDist)) {
            best = tile;
            bestCount = count;
            bestDist = dist;
        }
    }

    return best ?? { x: surface.graveyard.x0, y: surface.graveyard.y0 };
}


// Ids are assigned as `pile-${n}` in strictly increasing n (see
// createSurface/spawnFoodPiles' nextPileId counter, which — like
// nextBroodId/nextAntId elsewhere — only ever increments, even across piles
// that later get removed). Comparing that suffix numerically, not the id
// string itself, is what keeps "ties broken by id" correct past pile-9 -> 
// pile-10: string comparison would sort "pile-10" before "pile-2".
function pileIdOrder(id: FoodPileId): number {
    return Number(id.split("-")[1]);
}

export function createSurface(width: number, height: number): Surface {
    const grid = createGrid(width, height);
    grid.tiles.fill(TILE.GROUND);

    // Bottom-centre: meets the nest shaft's top if the two views are ever
    // stacked vertically in the render (render/surface-view.ts, file 12).
    const holePos: Position = { x: Math.floor(width / 2), y: height - 1 };

    // A patch beside the hole, clear of the hole and its spawn-exclusion
    // radius. Undertakers drop bodies here (graveyardSlot spreads them across
    // its tiles). Sized for the steady-state buried count a busy colony
    // carries in the decay pipeline (~30-40) at CORPSE_PER_GRAVE_TILE each,
    // though decay — not capacity — is the real bound.
    const graveyard: Rect = {
        x0: holePos.x + HOLE_EXCLUSION_RADIUS + 1,
        y0: holePos.y - 3,
        x1: holePos.x + HOLE_EXCLUSION_RADIUS + 6,
        y1: holePos.y,
    };

    return {
        grid,
        holePos,
        graveyard,
        foodPiles: [],
        nextPileId: 1,
    };
}

export function spawnFoodPiles(surface: Surface, rngSeed: number): { surface: Surface; seed: number } {
    const chanceRoll = randomInt(rngSeed, 0, 1_000_000);
    let seed = chanceRoll.seed;

    const shouldTrySpawn = chanceRoll.value / 1_000_000 < PILE_SPAWN_CHANCE;

    if (!shouldTrySpawn || surface.foodPiles.length >= MAX_PILES) {
        return { surface, seed };
    }

    // Rejection sampling: roll a random in-bounds tile, retry if it lands in
    // the hole's exclusion radius or the graveyard rect. Every attempt
    // advances the seed regardless of accept/reject, so the RNG cadence this
    // tick is fixed by MAX_SPAWN_ATTEMPTS' worst case, not by how many
    // attempts happened to succeed — same principle as queen.ts's
    // unconditional roll-then-gate.
    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const xRoll = randomInt(seed, 0, surface.grid.width - 1);
        const yRoll = randomInt(xRoll.seed, 0, surface.grid.height - 1);
        seed = yRoll.seed;

        const candidate: Position = { x: xRoll.value, y: yRoll.value };

        if (manhattanDistance(candidate, surface.holePos) < HOLE_EXCLUSION_RADIUS) {
            continue;
        }
        if (inRect(candidate, surface.graveyard)) {
            continue;
        }

        const pile: FoodPile = {
            id: `pile-${surface.nextPileId}`,
            pos: candidate,
            amount: PILE_START_AMOUNT,
            ageTicks: 0,
        };

        return {
            surface: {
                ...surface,
                foodPiles: [...surface.foodPiles, pile],
                nextPileId: surface.nextPileId + 1,
            },
            seed,
        };
    }

    // Every candidate this tick landed in an excluded zone — surface is
    // small/crowded enough that this is plausible, not a bug. No spawn, but
    // the seed still reflects every attempt made.
    return { surface, seed };
}

export function ageFoodPiles(surface: Surface): Surface {
    const foodPiles = surface.foodPiles
        .map((pile) => ({ ...pile, ageTicks: pile.ageTicks + 1 }))
        .filter((pile) => pile.amount > 0 && pile.ageTicks <= PILE_DECAY_TICKS);

    return { ...surface, foodPiles };
}

export function takeFromPile(surface: Surface, pileId: FoodPileId, amount: number): { surface: Surface; taken: number } {
    const pile = surface.foodPiles.find((entry) => entry.id === pileId);

    if (!pile) {
        // Pile could have decayed out from under a forager between
        // perceive() and act() only if something re-perceives mid-tick,
        // which nothing here does — but the caller (jobs.ts's pickUpFood
        // handler) shouldn't have to special-case a missing pile, so this is
        // a harmless no-op rather than a thrown error.
        return { surface, taken: 0 };
    }

    const taken = Math.min(amount, pile.amount);

    const foodPiles = surface.foodPiles.map((entry) =>
        entry.id === pileId ? { ...entry, amount: entry.amount - taken } : entry
    );

    return { surface: { ...surface, foodPiles }, taken };
}

export function nearestPile(surface: Surface, pos: Position): FoodPile | undefined {
    let nearest: FoodPile | undefined = undefined;
    let nearestDistance = Infinity;

    for (const pile of surface.foodPiles) {
        const distance = manhattanDistance(pile.pos, pos);

        if (
            distance < nearestDistance ||
            (distance === nearestDistance && nearest !== undefined && pileIdOrder(pile.id) < pileIdOrder(nearest.id))
        ) {
            nearest = pile;
            nearestDistance = distance;
        }
    }

    return nearest;
}