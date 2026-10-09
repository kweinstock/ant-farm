// Top-down foraging ground — reads state.surface (world/surface.ts). Every
// ground tile is uniform GROUND (createSurface fills the whole grid with
// it, and nothing on the surface digs), so unlike nest-view.ts there's no
// per-tile type/role lookup — one flat fill instead of a per-cell loop for
// the ground itself, then (PHASE 4) the trail layer, the graveyard, and
// the predator.
import { inGraveyard } from "../../sim/world/surface";
import type { ColonyState } from "../../sim/state";
import type { Season } from "../../sim/environment/season";
import type { RenderOptions } from "../ui/control-panel";
import { SURFACE_CELL_SIZE } from "../config";
import { renderTrail, renderAlarm } from "./pheromone-layer";
import { buildGrassOverlayTile } from "./textures";
import { SEASON_PALETTE } from "./season-palette";

const GRAVEYARD_OUTLINE_COLOR = "rgba(0, 0, 0, 0.25)";
const GRAVEYARD_FILL_RGB = "0, 0, 0";
const PREDATOR_COLOR = "#5c1a1a";
const PREDATOR_OUTLINE_COLOR = "#1a0808";
const PREDATOR_RADIUS_RATIO = 0.55;

// Untuned, same spirit as this file's other params — how many corpses in
// the graveyard rect counts as "full" shading. CORPSE_DECAY_TICKS
// (corpses.ts, 600 ticks) is generous enough that a busy colony's
// graveyard could plausibly grow well past this before decay ever thins
// it out, so this is a visual cap on the shading, not a claim about the
// rect's real capacity.
const GRAVEYARD_SHADE_FULL_COUNT = 15;
const GRAVEYARD_MAX_FILL_ALPHA = 0.5;

function inAnyPatch(x: number, y: number, patches: { x0: number; y0: number; x1: number; y1: number }[]): boolean {
    for (const patch of patches) {
        if (x >= patch.x0 && x <= patch.x1 && y >= patch.y0  && y <= patch.y1) {
            return true;
        }
    }

    return false;
}

// PHASE 12 (terrain texture pass, take 2): a blur+speckle-noise pass here
// read as muddy rather than the flat, clean "paper" look Phase 12's art
// direction actually wants — reverted to a flat fill (no blur, no scratch
// canvas needed). The ground gets an actual grass-tuft overlay
// (textures.ts) instead of generic noise — the one terrain surface Phase 12
// asked for real added texture on — tiled at a fixed pixel size via
// ctx.createPattern so tuft density stays constant regardless of grid size.
//
// PHASE 12e: one tile per season instead of one fixed green — all four
// built once up front (cheap: a handful of curved strokes each) and picked
// by state.env.season every frame, same "precompute the variants, pick one"
// shape as props.ts's tree materials.
const GRASS_TILE_BY_SEASON: Record<Season, HTMLCanvasElement> = Object.fromEntries(
    (Object.keys(SEASON_PALETTE) as Season[]).map((season) => [
        season,
        buildGrassOverlayTile({ size: 28, tuftCount: 5, bladeColor: SEASON_PALETTE[season].grassBladeColor }),
    ]),
) as Record<Season, HTMLCanvasElement>;

export function renderSurfaceView(ctx: CanvasRenderingContext2D, state: ColonyState, options: RenderOptions): void {
    const { surface } = state;
    const cellSize = SURFACE_CELL_SIZE;
    const width = surface.grid.width * cellSize;
    const height = surface.grid.height * cellSize;
    const palette = SEASON_PALETTE[state.env.season];

    // Rocks and trees are deliberately not drawn here — render/props.ts
    // stands a real 3D placeholder prop on top of the cube's surface face
    // for both instead of painting a flat circle into this texture (see
    // that file's header for why), so this loop only needs patch vs. plain
    // ground, not a per-tile type lookup.
    for (let y = 0; y < surface.grid.height; y++) {
        for (let x = 0; x < surface.grid.width; x++) {
            const px = x * cellSize;
            const py = y * cellSize;

            const inPatch = options.showPatches && inAnyPatch(x, y, surface.patches);
            ctx.fillStyle = inPatch ? palette.patchColor : palette.groundColor;
            ctx.fillRect(px, py, cellSize, cellSize);
        }
    }

    const grassPattern = ctx.createPattern(GRASS_TILE_BY_SEASON[state.env.season], "repeat");
    if (grassPattern) {
        ctx.fillStyle = grassPattern;
        ctx.fillRect(0, 0, width, height);
    }

    // PHASE 4: trail layer, right after the ground and before anything
    // else drawn on top — it needs to read as staining on the ground
    // itself, not a layer floating above piles/corpses/ants. Gated on the
    // visitor's toggle (ui/view-switch.ts); off by default.
    if (options.showTrails) {
        renderTrail(ctx, surface.trail, cellSize);
        renderAlarm(ctx, surface.alarm, cellSize);
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

    // The hole itself is render/props.ts's entrance mound now — a real 3D
    // prop instead of a flat dark circle painted into this texture.

    if (state.env.predator) {
        const px = state.env.predator.pos.x * cellSize + cellSize / 2;
        const py = state.env.predator.pos.y * cellSize + cellSize / 2;
        ctx.fillStyle = PREDATOR_COLOR;
        ctx.strokeStyle = PREDATOR_OUTLINE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, cellSize * PREDATOR_RADIUS_RATIO, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Ants, food piles, and corpses are all drawn as real 3D decals
    // standing/lying on the cube now, not painted into this texture — see
    // render/ant-props.ts, render/food-props.ts, render/corpse-props.ts.
}
