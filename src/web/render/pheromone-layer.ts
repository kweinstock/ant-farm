// Optional toggle: the surface trail layer (pheromones.ts's TrailField) as a
// translucent heat-map so visitors can watch trail networks form and decay.
// Phase 4 only wires up TRAIL — ALARM/RECRUIT don't exist yet (see
// pheromones.ts's own header on why those two are deferred rather than
// stubbed out unused).
//
// Pure draw, no state read beyond what's passed in — same contract as
// render/ants.ts's drawAnt/drawCorpse. cellSize is a parameter rather than
// importing SURFACE_CELL_SIZE directly, same reasoning as everywhere else
// in render/: this file doesn't need to assume which view it's drawn into.
import { trailAt, type TrailField } from "../../sim/pheromones";
import { MAX_TRAIL, MIN_TRAIL } from "../../sim/params";

// Warm amber — deliberately distinct from surface-view.ts's PILE_COLOR
// (green) and ants.ts's CORPSE_COLOR (grey), so a stained trail doesn't get
// visually confused with either.
const TRAIL_COLOR_RGB = "199, 120, 40";
const TRAIL_MAX_ALPHA = 0.6;

export function renderTrail(ctx: CanvasRenderingContext2D, trail: TrailField, cellSize: number): void {
    for (let y = 0; y < trail.height; y++) {
        for (let x = 0; x < trail.width; x++) {
            const value = trailAt(trail, x, y);
            if (value < MIN_TRAIL) {
                continue;
            }

            const alpha = TRAIL_MAX_ALPHA * Math.min(1, value / MAX_TRAIL);
            ctx.fillStyle = `rgba(${TRAIL_COLOR_RGB}, ${alpha})`;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }
}