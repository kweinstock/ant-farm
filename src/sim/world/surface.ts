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
import { createGrid, getIndex, getNeighbors, isInBounds, manhattanDistance, passableNeighbors, setTile, tileAt, TILE, type Grid, type Position } from "./grid";
import { randomInt } from "../rng";
import { createTrailField, type TrailField } from "../pheromones";
import { FERTILE_PATCHES, FOOD_PILE_START_AMOUNT, FOOD_TILE_CAPACITY, FOREST_CLUMP_SCALE, FOREST_DETAIL_SCALE, FOREST_SEED_BASE, FOREST_SEED_VARIATION, HOLE_EXCLUSION_RADIUS, MAX_PILES, MAX_SPAWN_ATTEMPTS, PATCH_CLEARING_FACTOR, PATCH_SPAWN_BIAS, PILE_DECAY_TICKS, PILE_SPAWN_CHANCE, ROCK_FRACTION } from "../params";
import { forageAbundance, type Season } from "../environment/season";

export type FoodPileId = string;

// `capacity` is the per-tile ceiling (FOOD_TILE_CAPACITY): takeFromPile only
// ever drains `amount`, but spawnFoodPiles tops a pile back up on a repeat
// spawn, never past `capacity`. Still no self-regrow — a pile at 0 that
// nothing re-seeds decays out via ageFoodPiles.
export type FoodPile = {
    id: FoodPileId;
    pos: Position;
    amount: number;
    capacity: number;
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
    patches: Rect[];
    foodPiles: FoodPile[];
    nextPileId: number;
    trail: TrailField;
};

function inRect(pos: Position, rect: Rect): boolean {
    return pos.x >= rect.x0 && pos.x <= rect.x1 && pos.y >= rect.y0 && pos.y <= rect.y1;
}

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

// Pure integer hash -> uint32. Deterministic, cross-engine stable.
function hash2(x: number, y: number, salt: number): number {
    let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    h = h ^ (h >>> 16);
    return h >>> 0;
}

const unit = (x: number, y: number, salt: number): number => hash2(x, y, salt) / 4294967296;

// Value noise: hash the integer lattice, smoothstep-interpolate. `scale` is
// the lattice spacing in tiles — bigger = broader features. Pure float math
// on integer-derived inputs, so byte-identical every run.
function valueNoise(x: number, y: number, scale: number, salt: number): number {
    const gx = x / scale;
    const gy = y / scale;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const a = unit(x0, y0, salt);
    const b = unit(x0 + 1, y0, salt);
    const c = unit(x0, y0 + 1, salt);
    const d = unit(x0 + 1, y0 + 1, salt);

    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
}

// Per-tile probability that this cell seeds cover. FOREST_SEED_BASE, nudged
// by up to +/-FOREST_SEED_VARIATION as the (two-octave, [0,1)) value noise
// drifts around 0.5. A narrow band, so the forest scatters evenly with only
// a gentle regional ebb — no bare stretches, no walls.
function forestSeedChance(x: number, y: number): number {
    const noise = 0.4 * valueNoise(x, y, FOREST_CLUMP_SCALE, 101) + 0.6 * valueNoise(x, y, FOREST_DETAIL_SCALE, 202);
    return FOREST_SEED_BASE + FOREST_SEED_VARIATION * (noise - 0.5) * 2;
}

function bfsGroundIndices(grid: Grid, start: Position): Set<number> {
    const seen = new Set<number>([getIndex(grid, start.x, start.y)]);
    const queue: Position[] = [start];
    for (let head = 0; head < queue.length; head++) {
        for (const n of passableNeighbors(grid, queue[head].x, queue[head].y)) {
            const i = getIndex(grid, n.x, n.y);
            if (!seen.has(i)) {
                seen.add(i);
                queue.push(n);
            }
        }
    }
    return seen;
}

// After the forest scatter, some GROUND can end up walled into a pocket.
// Each pass: BFS the reachable set from the hole, take the first
// still-unreachable GROUND tile, BFS again from THERE treating obstacles as
// passable until it touches the reachable set, and clear the obstacles on
// that shortest cut. One pocket connected per pass; the empty grid is
// connected so a cut always exists. Fully deterministic (fixed BFS order).
function repairConnectivity(grid: Grid, holePos: Position, graveyard: Rect): void {
    const w = grid.width;
    const total = grid.width * grid.height;

    for (let pass = 0; pass < 40; pass++) {
        const reachable = bfsGroundIndices(grid, holePos);

        let firstUnreachable = -1;
        for (let i = 0; i < total; i++) {
            if (grid.tiles[i] === TILE.GROUND && !reachable.has(i)) {
                firstUnreachable = i;
                break;
            }
        }
        if (firstUnreachable < 0) return;

        // BFS from the pocket over ALL in-bounds tiles, tracking parents, to
        // the nearest reachable GROUND tile.
        const parent = new Map<number, number>([[firstUnreachable, -1]]);
        const queue = [firstUnreachable];
        let hit = -1;
        for (let head = 0; head < queue.length && hit < 0; head++) {
            const cur = queue[head];
            const cx = cur % w;
            const cy = (cur - cx) / w;
            for (const n of getNeighbors(grid, cx, cy)) {
                const i = getIndex(grid, n.x, n.y);
                if (parent.has(i)) continue;
                parent.set(i, cur);
                if (reachable.has(i)) {
                    hit = i;
                    break;
                }
                queue.push(i);
            }
        }

        // Walk the path back, converting any obstacle on it to GROUND.
        for (let node = hit; node >= 0; node = parent.get(node) ?? -1) {
            const nx = node % w;
            const ny = (node - nx) / w;
            const t = grid.tiles[node];
            if ((t === TILE.ROCK || t === TILE.TREE) && !inRect({ x: nx, y: ny }, graveyard)) {
                grid.tiles[node] = TILE.GROUND;
            }
        }
    }
}

function carveForest(grid: Grid, patches: Rect[], holePos: Position, graveyard: Rect): void {
    const inAnyPatch = (x: number, y: number) => patches.some((p) => inRect({ x, y }, p));

    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (tileAt(grid, x, y) !== TILE.GROUND) continue; // already part of a 2x2 canopy
            if (manhattanDistance({ x, y }, holePos) < HOLE_EXCLUSION_RADIUS) continue;
            if (inRect({ x, y }, graveyard)) continue;

            let chance = forestSeedChance(x, y);
            if (inAnyPatch(x, y)) chance *= PATCH_CLEARING_FACTOR;
            if (unit(x, y, 505) >= chance) continue;

            // A TREE is always a 2x2 canopy — place one if the whole block is
            // eligible GROUND (and doesn't spill its canopy into a patch, the
            // hole radius, or the graveyard). Everything else this seed wants
            // (block won't fit, or the rock roll wins) is a single ROCK.
            const canopyFits =
                unit(x, y, 303) >= ROCK_FRACTION &&
                [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => {
                    const bx = x + dx;
                    const by = y + dy;
                    return (
                        isInBounds(grid, bx, by) &&
                        tileAt(grid, bx, by) === TILE.GROUND &&
                        manhattanDistance({ x: bx, y: by }, holePos) >= HOLE_EXCLUSION_RADIUS &&
                        !inRect({ x: bx, y: by }, graveyard) &&
                        !inAnyPatch(bx, by)
                    );
                });

            if (canopyFits) {
                setTile(grid, x, y, TILE.TREE);
                setTile(grid, x + 1, y, TILE.TREE);
                setTile(grid, x, y + 1, TILE.TREE);
                setTile(grid, x + 1, y + 1, TILE.TREE);
            } else {
                setTile(grid, x, y, TILE.ROCK);
            }
        }
    }

    repairConnectivity(grid, holePos, graveyard);

    // Repair carves the odd doorway through a canopy, leaving a 1-3 tile TREE
    // fragment. A tree is a 2x2 or it's nothing — clear any fragment back to
    // ground (never adds cover, so it can't undo the repair).
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (tileAt(grid, x, y) !== TILE.TREE) continue;
            const inFullBlock = [[-1, -1], [-1, 0], [0, -1], [0, 0]].some(([ox, oy]) =>
                [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => {
                    const bx = x + ox + dx;
                    const by = y + oy + dy;
                    return isInBounds(grid, bx, by) && tileAt(grid, bx, by) === TILE.TREE;
                }),
            );
            if (!inFullBlock) setTile(grid, x, y, TILE.GROUND);
        }
    }
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

    // Dead centre — foragers emerge into the middle of the forest and pick a
    // direction, rather than always heading "up" from one edge.
    const holePos: Position = { x: Math.floor(width / 2), y: Math.floor(height / 2) };

    // Just outside the hole exclusion, a little south-east of it — close
    // enough that hauling a body out and back is a short detour, not a trek
    // across the map. Undertakers drop bodies here (graveyardSlot spreads
    // them across its tiles); decay, not capacity, is what bounds the pile.
    const graveyard: Rect = {
        x0: holePos.x + HOLE_EXCLUSION_RADIUS + 1,
        y0: holePos.y + 2,
        x1: holePos.x + HOLE_EXCLUSION_RADIUS + 6,
        y1: holePos.y + 5,
    };

    // Copy, not a reference to the module constant — nothing mutates
    // surface.patches today, but a shared-mutable-array footgun isn't worth
    // leaving armed.
    const patches: Rect[] = FERTILE_PATCHES.map((p) => ({ ...p }));

    carveForest(grid, patches, holePos, graveyard);

    return {
        grid,
        holePos,
        graveyard,
        patches,
        foodPiles: [],
        nextPileId: 1,
        trail: createTrailField(width, height),
    };
}

export function spawnFoodPiles(surface: Surface, rngSeed: number, season: Season): { surface: Surface; seed: number } {
    const chanceRoll = randomInt(rngSeed, 0, 1_000_000);
    let seed = chanceRoll.seed;

    const shouldTrySpawn = chanceRoll.value / 1_000_000 < PILE_SPAWN_CHANCE * forageAbundance(season);

    if (!shouldTrySpawn) {
        return { surface, seed };
    }
    // The MAX_PILES cap is on *new* tiles — a spawn that lands on a tile that
    // already has a pile tops it up instead (checked in the loop), and that
    // stays allowed at the cap so the tiles foragers actually visit keep
    // getting restocked.
    const atCap = surface.foodPiles.length >= MAX_PILES;

    // Roll 2: patch vs. open. Roll 3: which patch — rolled unconditionally
    // even when the open branch wins, purely so the RNG cadence for a
    // "tried to spawn" tick is fixed regardless of which branch gets used;
    // the open branch just never reads patchIndexRoll.value for real.
    const patchBiasRoll = randomInt(seed, 0, 1_000_000);
    seed = patchBiasRoll.seed;
    const targetsPatch = patchBiasRoll.value / 1_000_000 < PATCH_SPAWN_BIAS;

    const patchIndexRoll = randomInt(seed, 0, Math.max(0, surface.patches.length - 1));
    seed = patchIndexRoll.seed;
    const patch = surface.patches[patchIndexRoll.value];

    const useOpen = !targetsPatch || patch === undefined;

    let xMin: number, xMax: number, yMin: number, yMax: number;
    if (useOpen) {
        xMin = 0;
        xMax = surface.grid.width - 1;
        yMin = 0;
        yMax = surface.grid.height - 1;
    } else {
        xMin = patch.x0;
        xMax = patch.x1;
        yMin = patch.y0;
        yMax = patch.y1;
    }

    // Rejection sampling: roll a random in-bounds tile, retry if it lands in
    // the hole's exclusion radius or the graveyard rect. Every attempt
    // advances the seed regardless of accept/reject, so the RNG cadence this
    // tick is fixed by MAX_SPAWN_ATTEMPTS' worst case, not by how many
    // attempts happened to succeed — same principle as queen.ts's
    // unconditional roll-then-gate.
    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const xRoll = randomInt(seed, xMin, xMax);
        const yRoll = randomInt(xRoll.seed, yMin, yMax);
        seed = yRoll.seed;

        const candidate: Position = { x: xRoll.value, y: yRoll.value };

        if (manhattanDistance(candidate, surface.holePos) < HOLE_EXCLUSION_RADIUS) {
            continue;
        }
        if (inRect(candidate, surface.graveyard)) {
            continue;
        }
        if (tileAt(surface.grid, candidate.x, candidate.y) !== TILE.GROUND) {
            continue;
        }

        const existing = surface.foodPiles.find(
            (p) => p.pos.x === candidate.x && p.pos.y === candidate.y,
        );

        if (existing !== undefined) {
            if (existing.amount >= FOOD_TILE_CAPACITY) {
                // This tile is already maxed — treat it like any other reject
                // and try somewhere else.
                continue;
            }
            const foodPiles = surface.foodPiles.map((p) =>
                p.id === existing.id
                    ? { ...p, amount: Math.min(p.amount + FOOD_PILE_START_AMOUNT, FOOD_TILE_CAPACITY), ageTicks: 0 }
                    : p,
            );
            return { surface: { ...surface, foodPiles }, seed };
        }

        if (atCap) {
            // No pile here and the map is full of distinct piles — can't add a
            // new tile. Keep sampling; another candidate might land on an
            // existing pile that still has headroom.
            continue;
        }

        const pile: FoodPile = {
            id: `pile-${surface.nextPileId}`,
            pos: candidate,
            amount: Math.min(FOOD_PILE_START_AMOUNT, FOOD_TILE_CAPACITY),
            capacity: FOOD_TILE_CAPACITY,
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

export function groundConnectedFromHole(surface: Surface): Set<string> {
    const grid = surface.grid;
    const visited = new Set<string>();
    const start = surface.holePos;
    visited.add(`${start.x},${start.y}`);

    const queue: Position[] = [start];
    let head = 0;
    while (head < queue.length) {
        const current = queue[head];
        head += 1;

        for (const neighbor of passableNeighbors(grid, current.x, current.y)) {
            const key = `${neighbor.x},${neighbor.y}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push(neighbor);
            }
        }
    }

    return visited;
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