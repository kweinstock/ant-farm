// Top-down foraging ground — reads state.surface (world/surface.ts). Every
// tile is uniform GROUND (createSurface fills the whole grid with it, and
// nothing on the surface digs), so unlike nest-view.ts there's no per-tile
// type/role lookup — one flat fill instead of a per-cell loop for the
// ground itself, then the hole, food piles, the graveyard outline, and ants
// filtered to where === "surface".
import { PILE_START_AMOUNT } from "../../sim/world/surface";
import type { ColonyState } from "../../sim/state";
import { SURFACE_CELL_SIZE } from "../config";
import { drawAnt } from "./ants";

const GROUND_COLOR = "#c9b896";
const HOLE_COLOR = "#1a1208";
const HOLE_RADIUS_RATIO = 0.4;
const GRAVEYARD_OUTLINE_COLOR = "rgba(0, 0, 0, 0.25)";
const PILE_COLOR = "#5c8a3a";
const PILE_BASE_RADIUS_RATIO = 0.4;
const PILE_MIN_SCALE = 0.25;

export function renderSurfaceView(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    const { surface } = state;
    const cellSize = SURFACE_CELL_SIZE;

    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, 0, surface.grid.width * cellSize, surface.grid.height * cellSize);

    // Faint grid lines, same treatment as nest-view.ts, so both panes read
    // as one visual language.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= surface.grid.width; x++) {
        const pixelX = x * cellSize;
        ctx.beginPath();
        ctx.moveTo(pixelX, 0);
        ctx.lineTo(pixelX, surface.grid.height * cellSize);
        ctx.stroke();
    }
    for (let y = 0; y <= surface.grid.height; y++) {
        const pixelY = y * cellSize;
        ctx.beginPath();
        ctx.moveTo(0, pixelY);
        ctx.lineTo(surface.grid.width * cellSize, pixelY);
        ctx.stroke();
    }

    // Graveyard: outline only, reserved for 3c — nothing occupies it yet.
    const gy = surface.graveyard;
    ctx.strokeStyle = GRAVEYARD_OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(
        gy.x0 * cellSize,
        gy.y0 * cellSize,
        (gy.x1 - gy.x0 + 1) * cellSize,
        (gy.y1 - gy.y0 + 1) * cellSize,
    );

    // Food piles: radius/opacity scale with amount against PILE_START_AMOUNT
    // — same shrink-as-depleted treatment Phase 3's fixed piles used, just
    // normalized against a starting max instead of a per-pile capacity
    // (surface piles have none, see world/surface.ts).
    for (const pile of surface.foodPiles) {
        const fullness = Math.min(1, pile.amount / PILE_START_AMOUNT);
        if (fullness <= 0) {
            continue;
        }

        const scale = PILE_MIN_SCALE + (1 - PILE_MIN_SCALE) * fullness;
        const radius = cellSize * PILE_BASE_RADIUS_RATIO * scale;
        const centerX = pile.pos.x * cellSize + cellSize / 2;
        const centerY = pile.pos.y * cellSize + cellSize / 2;

        ctx.globalAlpha = 0.35 + 0.65 * fullness;
        ctx.fillStyle = PILE_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // The hole — the one tile a forager actually crosses through.
    const holeX = surface.holePos.x * cellSize + cellSize / 2;
    const holeY = surface.holePos.y * cellSize + cellSize / 2;
    ctx.fillStyle = HOLE_COLOR;
    ctx.beginPath();
    ctx.arc(holeX, holeY, cellSize * HOLE_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fill();

    for (const ant of state.ants.values()) {
        if (ant.location.where === "surface") {
            drawAnt(ctx, ant, cellSize);
        }
    }
}