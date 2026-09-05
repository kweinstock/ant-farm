// Draws the food piles. Phase 3: piles are fixed points on the open grid
// (state.resources, placed in state.ts's FOOD_PILE_OFFSETS) that any ant on
// the tile can eat from directly — no exit gate or granary yet (Phase 4).
//
// Each pile is a square whose size + opacity scale with amount/capacity, so a
// depleted pile visibly shrinks and a regrown one fills back in.
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE } from "../config";

const FOOD_COLOR = "#5c8a3a";
const MIN_SCALE = 0.25;

export function renderResources(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    for (const pile of state.resources) {
        const fullness = pile.capacity > 0 ? pile.amount / pile.capacity : 0;
        if (fullness <= 0) {
            continue;
        }

        // scale never goes fully to 0 so a nearly-empty pile is still a
        // visible speck rather than vanishing entirely.
        const scale = MIN_SCALE + (1 - MIN_SCALE) * fullness;
        const size = CELL_SIZE * 0.8 * scale;

        const centerX = pile.position.x * CELL_SIZE + CELL_SIZE / 2;
        const centerY = pile.position.y * CELL_SIZE + CELL_SIZE / 2;

        ctx.globalAlpha = 0.35 + 0.65 * fullness;
        ctx.fillStyle = FOOD_COLOR;
        ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
        ctx.globalAlpha = 1;
    }
}
