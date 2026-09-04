// Phase 2: draws exactly one ant, because ColonyState.ant is still a single
// field (Ant | null), not a collection — matches state.ts, not the eventual
// multi-ant design in the original stub comment this file replaced. When
// Phase 3 makes state hold many ants, this becomes a loop over them instead
// of one null check.
import type { Ant } from "../../sim/state";
import { CELL_SIZE } from "../config";

export function renderAnt(ctx: CanvasRenderingContext2D, ant: Ant | null): void {
    if (ant === null) {
        return;
    }

    const centerX = ant.position.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = ant.position.y * CELL_SIZE + CELL_SIZE / 2;
    const radius = CELL_SIZE * 0.3;

    ctx.fillStyle = "#2b2118";

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
}