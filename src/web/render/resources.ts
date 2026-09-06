// Phase 3a: state.resources (scattered FoodPile[]) is gone, replaced by a
// single ColonyState.foodStore: {amount, capacity}. Rather than one shrinking
// square somewhere on the open grid, the store now lives inside the
// FOOD_STORAGE chamber, so it's rendered as a gauge across that chamber's own
// tiles: fullness * tiles.length of them light up fully, one tile transitions
// partially, the rest sit at the chamber's base color (drawn by render/grid.ts
// underneath, untouched here). tilesOf's return order is whatever
// tilesInRect produced (row-major within the rect), which is fixed and
// deterministic — that's what keeps this a stable "gauge" instead of picking
// a different-looking subset of tiles every frame.
import type { ColonyState } from "../../sim/state";
import { tilesOf } from "../../sim/world/nest";
import { CELL_SIZE } from "../config";

const FOOD_COLOR = "#5c8a3a";
const PADDING = CELL_SIZE * 0.1;

export function renderResources(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    const tiles = tilesOf(state.nest, "FOOD_STORAGE");
    if (tiles.length === 0) {
        return;
    }

    const fullness = state.foodStore.capacity > 0
        ? state.foodStore.amount / state.foodStore.capacity
        : 0;
    const litUnits = fullness * tiles.length;

    tiles.forEach((tile, i) => {
        const tileFill = Math.max(0, Math.min(1, litUnits - i));
        if (tileFill <= 0) {
            return;
        }

        ctx.globalAlpha = 0.35 + 0.65 * tileFill;
        ctx.fillStyle = FOOD_COLOR;
        ctx.fillRect(
            tile.x * CELL_SIZE + PADDING,
            tile.y * CELL_SIZE + PADDING,
            CELL_SIZE - PADDING * 2,
            CELL_SIZE - PADDING * 2,
        );
        ctx.globalAlpha = 1;
    });
}