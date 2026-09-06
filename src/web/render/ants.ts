// Phase 3a: one dot per ant, sized/colored by caste as before. New this
// phase — a nurse currently carrying eggs (ant.carrying.length > 0) gets a
// small light dot drawn just above it, standing in for the egg(s) in transit
// (see render/brood.ts, which deliberately skips rendering carried entries
// at their own position to avoid assuming Brood.position tracks the ant
// mid-carry).
import type { ColonyState } from "../../sim/state";
import type { Ant } from "../../sim/ants/ant";
import { CELL_SIZE } from "../config";

const WORKER_RADIUS = CELL_SIZE * 0.3;
const QUEEN_RADIUS = CELL_SIZE * 0.45;
const WORKER_COLOR = "#2b2118";
const QUEEN_COLOR = "#8a1c3b";
const CARRY_DOT_RADIUS = CELL_SIZE * 0.09;
const CARRY_DOT_COLOR = "#fbf1d0";

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

    if (ant.carrying.length > 0) {
        ctx.fillStyle = CARRY_DOT_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, centerY - radius - CARRY_DOT_RADIUS, CARRY_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }
}