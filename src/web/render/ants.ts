// Shared by both views (render/nest-view.ts, render/surface-view.ts) — each
// filters state.ants by ant.location.where itself and calls this once per
// ant it owns. cellSize is a parameter, not a module constant, because the
// two views scale differently (config.ts's CELL_SIZE vs
// SURFACE_CELL_SIZE) — one drawAnt serves both without duplicating the
// caste-radius/color logic per view.
import type { Ant } from "../../sim/ants/ant";

const WORKER_RADIUS_RATIO = 0.3;
const QUEEN_RADIUS_RATIO = 0.45;
const WORKER_COLOR = "#2b2118";
const QUEEN_COLOR = "#8a1c3b";
const CARRY_DOT_RADIUS_RATIO = 0.09;
const EGG_CARRY_DOT_COLOR = "#fbf1d0";
const FOOD_CARRY_DOT_COLOR = "#5c8a3a";

export function drawAnt(ctx: CanvasRenderingContext2D, ant: Ant, cellSize: number): void {
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
    // nurse never carries food (ant.ts's carrying/carryingFood comment), so
    // in practice at most one ever fires, but nothing here assumes that.
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
}