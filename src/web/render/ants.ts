// Shared by both views (render/nest-view.ts, render/surface-view.ts) — each
// filters state.ants by ant.location.where itself and calls this once per
// ant it owns. cellSize is a parameter, not a module constant, because the
// two views scale differently (config.ts's CELL_SIZE vs
// SURFACE_CELL_SIZE) — one drawAnt serves both without duplicating the
// caste-radius/color logic per view.
//
// drawCorpse lives here too rather than in its own render/corpses.ts — it's
// a couple of constants and one small draw call, the same size class as
// drawAnt, and both views already import from this file.
import type { Ant } from "../../sim/ants/ant";
import type { Corpse } from "../../sim/corpses";

const WORKER_RADIUS_RATIO = 0.3;
const QUEEN_RADIUS_RATIO = 0.45;
const WORKER_COLOR = "#2b2118";
const QUEEN_COLOR = "#8a1c3b";
const CARRY_DOT_RADIUS_RATIO = 0.09;
const EGG_CARRY_DOT_COLOR = "#fbf1d0";
const FOOD_CARRY_DOT_COLOR = "#5c8a3a";
const CORPSE_CARRY_DOT_COLOR = "#8a8478";

// Noticeably smaller than a worker (WORKER_RADIUS_RATIO 0.3) and drawn as a
// squashed ellipse rather than a circle, so a corpse reads as "a small body
// lying down" rather than just a dimmer, smaller ant.
const CORPSE_RADIUS_RATIO = 0.16;
const CORPSE_VERTICAL_SQUASH = 0.7;
const CORPSE_COLOR = "#5a5248";

export function drawAnt(ctx: CanvasRenderingContext2D, ant: Ant, cellSize: number, carryingCorpse = false): void {
    const isQueen = ant.caste === "QUEEN";
    const pos = ant.location.pos;

    const centerX = pos.x * cellSize + cellSize / 2;
    const centerY = pos.y * cellSize + cellSize / 2;
    const radius = cellSize * (isQueen ? QUEEN_RADIUS_RATIO : WORKER_RADIUS_RATIO);

    ctx.fillStyle = isQueen ? QUEEN_COLOR : WORKER_COLOR;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    const carryDotRadius = cellSize * CARRY_DOT_RADIUS_RATIO;
    const carryDotY = centerY - radius - carryDotRadius;

    // Independent checks, not if/else — a forager never carries eggs and a
    // nurse never carries food (ant.ts's carrying/carryingFood comment), and
    // an undertaker never carries either (corpses.ts's assignUndertakers
    // candidate filter excludes anyone already carrying), so in practice at
    // most one of these three ever fires — but nothing here assumes that.
    if (ant.carrying.length > 0) {
        ctx.fillStyle = EGG_CARRY_DOT_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, carryDotY, carryDotRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    if (ant.carryingFood > 0) {
        ctx.fillStyle = FOOD_CARRY_DOT_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, carryDotY, carryDotRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // `carryingCorpse` is passed in rather than read off `ant.undertaking`
    // here — undertaking covers the whole assignment (walk to the corpse,
    // pick it up, haul it, drop it), but this dot should only show during
    // the haul leg, same as the two dots above only show while actual cargo
    // is held. The caller builds this from state.corpses' carriedBy, not
    // from ant.undertaking !== undefined — see nest-view.ts/surface-view.ts.
    if (carryingCorpse) {
        ctx.fillStyle = CORPSE_CARRY_DOT_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, carryDotY, carryDotRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function drawCorpse(
    ctx: CanvasRenderingContext2D,
    corpse: Corpse,
    cellSize: number,
    offset: { dx: number; dy: number } = { dx: 0, dy: 0 }
): void {
    const pos = corpse.location.pos;
    const centerX = pos.x * cellSize + cellSize / 2 + offset.dx;
    const centerY = pos.y * cellSize + cellSize / 2 + offset.dy;
    const radiusX = cellSize * CORPSE_RADIUS_RATIO;
    const radiusY = radiusX * CORPSE_VERTICAL_SQUASH;

    ctx.fillStyle = CORPSE_COLOR;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
}