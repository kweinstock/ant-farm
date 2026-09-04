// Phase 2: flat top-down board only — no tile types read from grid.tiles yet
// (every cell renders identically). This is NOT the eventual nest-view.ts
// cutaway; it's the simplest possible thing that lets you see the grid
// bounds and watch the ant move one cell at a time.
import type { Grid } from "../../sim/world/grid"
import { CELL_SIZE } from "../config"

export function renderGrid(ctx: CanvasRenderingContext2D, grid: Grid): void {
    const width = grid.width * CELL_SIZE;
    const height = grid.height * CELL_SIZE;

    // Background
    ctx.fillStyle = "#e8d8b8";
    ctx.fillRect(0, 0, width, height);

    // Grid lines — one stroke() call per line rather than batching into a
    // single path. Wasteful at real scale (thousands of strokes/frame) but
    // irrelevant at 10x10; revisit if/when the grid grows.
    ctx.strokeStyle = "#c8b898"
    ctx.lineWidth = 1;

    for (let x = 0; x <= grid.width; x++) {
        const pixelX = x * CELL_SIZE;

        ctx.beginPath();
        ctx.moveTo(pixelX, 0);
        ctx.lineTo(pixelX, height);
        ctx.stroke();
    }

    for (let y = 0; y <= grid.height; y++) {
        const pixelY = y * CELL_SIZE;

        ctx.beginPath();
        ctx.moveTo(0, pixelY);
        ctx.lineTo(width, pixelY)
        ctx.stroke();
    }
}