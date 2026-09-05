// Phase 2: draws exactly one ant, because ColonyState.ant is still a single
// field (Ant | null), not a collection — matches state.ts, not the eventual
// multi-ant design in the original stub comment this file replaced. When
// Phase 3 makes state hold many ants, this becomes a loop over them instead
// of one null check.
import type { ColonyState } from "../../sim/state";
import type { Ant } from "../../sim/ants/ant";
import { CELL_SIZE } from "../config";

const WORKER_RADIUS = CELL_SIZE * 0.3;
const QUEEN_RADIUS = CELL_SIZE * 0.45;
const WORKER_COLOR = "#2b2118";
const QUEEN_COLOR = "#8a1c3b";

export function renderAnts(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    // Draw order here is whatever Map iteration happens to give — unlike
    // index.ts's per-ant sim loop, nothing about rendering is part of the
    // determinism contract, so there's no need to sort by id. Worst case
    // with overlapping ants, which one paints on top is cosmetic, not a
    // simulation outcome.
    for (const ant of state.ants.values()) {
        drawAnt(ctx, ant);
    }
}

export function drawAnt(ctx: CanvasRenderingContext2D, ant: Ant): void {
    const isQueen = ant.caste === "QUEEN";

    const centerX = ant.position.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = ant.position.y * CELL_SIZE + CELL_SIZE / 2;
    const radius = isQueen ? QUEEN_RADIUS : WORKER_RADIUS;

    ctx.fillStyle = isQueen ? QUEEN_COLOR : WORKER_COLOR;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
}