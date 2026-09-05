// Draws the brood pile. Phase 3: every egg/larva/pupa sits on the queen's
// single tile (colony/brood.ts's layEgg uses queen.position, and the queen
// never moves), so this renders them as a tight cluster of little dots on
// that one cell — which is also the visual answer to "why is tending so
// unreliable": one nurse randomly wandering a 10x10 grid is rarely on the
// exact tile the whole nursery is stacked on.
//
// Dots are colored by stage and placed on a deterministic spiral so the pile
// looks stable frame-to-frame rather than shimmering.
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE } from "../config";

const STAGE_COLOR: Record<string, string> = {
    EGG: "#fbf1d0",
    LARVA: "#f2d98c",
    PUPA: "#c99a52",
};

const DOT_RADIUS = CELL_SIZE * 0.07;

export function renderBrood(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    ctx.strokeStyle = "#8a6f3a";
    ctx.lineWidth = 1;

    state.brood.forEach((entry, i) => {
        // Golden-angle spiral out from the tile centre, spread wide enough
        // that the pile rings AROUND the queen (who permanently sits on this
        // same tile) instead of hiding entirely under her.
        const angle = i * 2.399963;
        const spread = DOT_RADIUS + Math.sqrt(i) * DOT_RADIUS * 1.6;
        const cx = entry.position.x * CELL_SIZE + CELL_SIZE / 2 + Math.cos(angle) * spread;
        const cy = entry.position.y * CELL_SIZE + CELL_SIZE / 2 + Math.sin(angle) * spread;

        ctx.fillStyle = STAGE_COLOR[entry.stage] ?? "#fbf1d0";
        ctx.beginPath();
        ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
}
