// The surface trail layer (decision 1: state.surface.trail, same dims as
// surface.grid). Only TRAIL exists this phase — the header comment above
// this rewrite sketched ALARM/RECRUIT too, but Phase 4 is scoped to
// foraging memory + collective trail-following only (see the phase's
// "Decisions to lock in" note on heritability being out of scope until
// genetics/Phase 9). Those two are left for whichever later phase actually
// needs them rather than stubbed out here unused.
//
// Every function here is a pure copy-modify over a TrailField — no ant, no
// ColonyState, no RNG. At surface size (40x28 = 1120 cells), copying the
// whole Float32Array every deposit/evaporate call is trivial next to
// anything else a tick already does; there's no reason to chase in-place
// mutation for this.
//
// deposit and evaporate are the two operations state.ts's tick composes
// per-cell, independently, once per tick — so composing them tick-by-tick
// (N x step(1)) has to land on exactly the same floats as one step(N) that
// internally loops the same way. Two things make that hold: deposit's clamp
// to MAX_TRAIL is an exact ceiling (min() is associative/order-independent
// regardless of how many times it's applied), and evaporate's floor of
// anything below MIN_TRAIL to exactly 0 stops the multiply-by-0.95 chain
// from asymptotically approaching but never reaching 0 — without that
// floor, accumulated denormal dust could differ by float rounding depending
// on how many evaporate() calls ran, which would break the equality
// determinism.test.ts checks.
import { passableNeighbors, type Grid, type Position } from "./world/grid";

// UNTUNED STARTING POINTS, same spirit as world/surface.ts's pile params —
// expect to revisit once foragers are actually laying trail and there's a
// real network to look at.
//
// With these numbers: one deposit puts DEPOSIT_AMOUNT (40) on the ant's own
// tile and DEPOSIT_AMOUNT * SPREAD_FRAC (12) on each open neighbor — both
// comfortably above FOLLOW_THRESHOLD (5) after a single pass, so a trail is
// followable the very next tick rather than needing several foragers to
// reinforce it first. EVAPORATION_FACTOR (0.95) roughly halves a cell's
// value every ~14 ticks, so an unreinforced crumb drops below MIN_TRAIL (1)
// and floors to 0 well within one round trip's timescale.
export const MAX_TRAIL = 200;
export const EVAPORATION_FACTOR = 0.95;
export const MIN_TRAIL = 1;
export const SPREAD_FRAC = 0.3;
export const FOLLOW_THRESHOLD = 5;
export const DEPOSIT_AMOUNT = 40;

export type TrailField = {
    width: number;
    height: number;
    cells: Float32Array;
};

function index(field: TrailField, x: number, y: number): number {
    return y * field.width + x;
}

export function createTrailField(width: number, height: number): TrailField {
    return {
        width,
        height,
        cells: new Float32Array(width * height),
    };
}

export function trailAt(field: TrailField, x: number, y: number): number {
    return field.cells[index(field, x, y)];
}

export function deposit(field: TrailField, x: number, y: number, amount: number): TrailField {
    const cells = field.cells.slice();

    cells[index(field, x, y)] = Math.min(MAX_TRAIL, cells[index(field, x, y)] + amount);

    const offsets: Position[] = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
    ];

    for (const offset of offsets) {
        const nx = x + offset.x;
        const ny = y + offset.y;
        if (nx < 0 || nx >= field.width || ny < 0 || ny >= field.height) {
            continue;
        }
        const i = index(field, nx, ny);
        cells[i] = Math.min(MAX_TRAIL, cells[i] + amount * SPREAD_FRAC);
    }

    return { ...field, cells };
}

export function evaporate(field: TrailField): TrailField {
    const cells = field.cells.slice();

    for (let i = 0; i < cells.length; i++) {
        const decayed = cells[i] * EVAPORATION_FACTOR;
        cells[i] = decayed < MIN_TRAIL ? 0 : decayed;
    }

    return {...field, cells};
}

// The passable neighbor with the highest trail value, or undefined if none
// exceeds FOLLOW_THRESHOLD — "no trail worth following here," not "follow
// the strongest of four near-zero crumbs." Ties go to whichever direction
// getNeighbors/passableNeighbors visits first (up, right, down, left, per
// world/grid.ts) since the comparison below is strict `>`, never `>=` — no
// RNG involved, so senses.ts's perceive() can call this and stay
// deterministic like everything else it computes.
//
// `awayFrom` gives the follow a DIRECTION. Returning foragers deposit trail
// all the way from the pile back to the hole and converge as they near it,
// so trail density is a hill peaking a few tiles out from the hole and
// falling off in both directions. A plain "step to the strongest neighbor"
// walks an outbound forager UP that hill — toward the hole, where the ants
// came from, not toward the food — and then oscillates on the ridge. Passing
// the hole position as `awayFrom` restricts the follow to neighbors strictly
// farther from it, so the trail is followed outbound, toward the food.
export function strongestPassableNeighbor(
    field: TrailField,
    grid: Grid,
    x: number,
    y: number,
    awayFrom?: Position,
): Position | undefined {
    let best: Position | undefined;
    let bestTrail = FOLLOW_THRESHOLD;

    const hereDist = awayFrom ? Math.abs(x - awayFrom.x) + Math.abs(y - awayFrom.y) : 0;

    for (const neighbor of passableNeighbors(grid, x, y)) {
        if (awayFrom) {
            const nbDist = Math.abs(neighbor.x - awayFrom.x) + Math.abs(neighbor.y - awayFrom.y);
            if (nbDist <= hereDist) {
                continue;
            }
        }
        const trail = trailAt(field, neighbor.x, neighbor.y);
        if (trail > bestTrail) {
            best = neighbor;
            bestTrail = trail;
        }
    }

    return best;
}