// Top-down foraging ground — reads state.surface (world/surface.ts) plus
// state.corpses for anything that landed out here. Every ground tile is
// uniform GROUND (createSurface fills the whole grid with it, and nothing
// on the surface digs), so unlike nest-view.ts there's no per-tile
// type/role lookup — one flat fill instead of a per-cell loop for the
// ground itself, then the graveyard, food piles, corpses, the hole, and
// ants filtered to where === "surface".
import { PILE_START_AMOUNT, inGraveyard } from "../../sim/world/surface";
import type { ColonyState } from "../../sim/state";
import type { Corpse } from "../../sim/corpses";
import type { AntId } from "../../sim/ants/ant";
import { SURFACE_CELL_SIZE } from "../config";
import { drawAnt, drawCorpse } from "./ants";

const GROUND_COLOR = "#c9b896";
const HOLE_COLOR = "#1a1208";
const HOLE_RADIUS_RATIO = 0.4;
const GRAVEYARD_OUTLINE_COLOR = "rgba(0, 0, 0, 0.25)";
const GRAVEYARD_FILL_RGB = "0, 0, 0";
const PILE_COLOR = "#5c8a3a";
const PILE_BASE_RADIUS_RATIO = 0.4;
const PILE_MIN_SCALE = 0.25;

// Untuned, same spirit as this file's pile params — how many corpses in the
// graveyard rect counts as "full" shading. CORPSE_DECAY_TICKS (corpses.ts,
// 600 ticks) is generous enough that a busy colony's graveyard could
// plausibly grow well past this before decay ever thins it out, so this is
// a visual cap on the shading, not a claim about the rect's real capacity.
const GRAVEYARD_SHADE_FULL_COUNT = 15;
const GRAVEYARD_MAX_FILL_ALPHA = 0.5;

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

    // Graveyard: filled proportionally to how many uncarried corpses
    // currently sit in it (the "growing pile"), outline drawn on top so it
    // stays crisp regardless of fill intensity.
    const gy = surface.graveyard;
    const graveyardOccupancy = state.corpses.filter(
        (corpse) =>
            corpse.carriedBy === undefined &&
            corpse.location.where === "surface" &&
            inGraveyard(surface, corpse.location.pos)
    ).length;
    const graveyardFill = Math.min(1, graveyardOccupancy / GRAVEYARD_SHADE_FULL_COUNT);

    const gyX = gy.x0 * cellSize;
    const gyY = gy.y0 * cellSize;
    const gyWidth = (gy.x1 - gy.x0 + 1) * cellSize;
    const gyHeight = (gy.y1 - gy.y0 + 1) * cellSize;

    if (graveyardFill > 0) {
        ctx.fillStyle = `rgba(${GRAVEYARD_FILL_RGB}, ${GRAVEYARD_MAX_FILL_ALPHA * graveyardFill})`;
        ctx.fillRect(gyX, gyY, gyWidth, gyHeight);
    }

    ctx.strokeStyle = GRAVEYARD_OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(gyX, gyY, gyWidth, gyHeight);

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

    // Corpses: same stacked-tile spiral as nest-view.ts's renderCorpses.
    // Bodies spread across the graveyard's tiles now (world/surface.ts's
    // graveyardSlot, ~CORPSE_PER_GRAVE_TILE each), but a busy colony still
    // overfills them past that, so the per-tile spiral keeps a deep pile
    // legible instead of one opaque blob.
    renderCorpses(ctx, state.corpses, cellSize);

    // The hole — the one tile a forager actually crosses through.
    const holeX = surface.holePos.x * cellSize + cellSize / 2;
    const holeY = surface.holePos.y * cellSize + cellSize / 2;
    ctx.fillStyle = HOLE_COLOR;
    ctx.beginPath();
    ctx.arc(holeX, holeY, cellSize * HOLE_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fill();

    // Corpse-carriers, built once per frame — see ants.ts's comment on why
    // the carry-dot tracks carriedBy, not ant.undertaking.
    const corpseCarriers = new Set<AntId>(
        state.corpses.filter((corpse) => corpse.carriedBy !== undefined).map((corpse) => corpse.carriedBy as AntId)
    );

    for (const ant of state.ants.values()) {
        if (ant.location.where === "surface") {
            drawAnt(ctx, ant, cellSize, corpseCarriers.has(ant.id));
        }
    }
}

function renderCorpses(ctx: CanvasRenderingContext2D, corpses: Corpse[], cellSize: number): void {
    const groups = new Map<string, Corpse[]>();
    for (const corpse of corpses) {
        if (corpse.carriedBy !== undefined || corpse.location.where !== "surface") {
            continue;
        }
        const key = `${corpse.location.pos.x},${corpse.location.pos.y}`;
        const group = groups.get(key);
        if (group) {
            group.push(corpse);
        } else {
            groups.set(key, [corpse]);
        }
    }

    for (const group of groups.values()) {
        group.forEach((corpse, i) => {
            const angle = i * 2.399963;
            const spread = i === 0 ? 0 : cellSize * 0.12 + Math.sqrt(i) * cellSize * 0.1;
            const dx = Math.cos(angle) * spread;
            const dy = Math.sin(angle) * spread;
            drawCorpse(ctx, corpse, cellSize, { dx, dy });
        });
    }
}