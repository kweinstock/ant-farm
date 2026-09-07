// Side cross-section of the underground: tiles by type/chamber-role tint
// (folded in from the deleted render/grid.ts), the FOOD_STORAGE gauge
// (folded in from the deleted render/resources.ts), brood, corpses, and
// ants filtered to where === "nest". PHASE 3b: the two-view split means
// every render module needs to own a specific state slice — "the whole
// nest" was already the natural unit for tiles+food+brood+nest-side ants to
// share, so this absorbs what used to be three separate files instead of
// importing them piecemeal. PHASE 3c folds corpses into that same unit.
import { tileAt, TILE, type Grid } from "../../sim/world/grid";
import { chamberAt, tilesOf, type ChamberRole, type Nest } from "../../sim/world/nest";
import type { ColonyState } from "../../sim/state";
import type { Brood } from "../../sim/colony/brood";
import type { Corpse } from "../../sim/corpses";
import type { AntId } from "../../sim/ants/ant";
import { CELL_SIZE } from "../config";
import { drawAnt, drawCorpse } from "./ants";

const TILE_COLOR: Record<number, string> = {
    [TILE.SOIL]: "#3b2a1a",
    [TILE.TUNNEL]: "#c9b896",
    [TILE.CHAMBER]: "#e8d8b8",
    [TILE.WALL]: "#1a1208",
    [TILE.EXIT]: "#7fb3d5",
};

const ROLE_TINT: Partial<Record<ChamberRole, string>> = {
    QUEEN: "#c98a9e",
    NURSERY: "#f2d98c",
    FOOD_STORAGE: "#8bb36a",
};

const FOOD_COLOR = "#5c8a3a";
const FOOD_GAUGE_PADDING = CELL_SIZE * 0.1;

const STAGE_COLOR: Record<string, string> = {
    EGG: "#fbf1d0",
    LARVA: "#f2d98c",
    PUPA: "#c99a52",
};

const BROOD_DOT_RADIUS = CELL_SIZE * 0.07;

// Marks the seam where this pane visually connects to render/surface-view.ts
// — the two views are one continuous space split across two canvases, not
// unrelated boards. Drawn at the top edge (y=0) rather than computed from
// exitMouth, since the seam is "the top of the nest" conceptually, not tied
// to the shaft's exact width.
const SURFACE_LINE_COLOR = "#7fb3d5";

function renderTiles(ctx: CanvasRenderingContext2D, grid: Grid, nest: Nest): void {
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const tile = tileAt(grid, x, y);
            let color = TILE_COLOR[tile] ?? TILE_COLOR[TILE.SOIL];

            if (tile === TILE.CHAMBER) {
                const role = chamberAt(nest, { x, y });
                if (role !== undefined && ROLE_TINT[role] !== undefined) {
                    color = ROLE_TINT[role] as string;
                }
            }

            ctx.fillStyle = color;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= grid.width; x++) {
        const pixelX = x * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(pixelX, 0);
        ctx.lineTo(pixelX, grid.height * CELL_SIZE);
        ctx.stroke();
    }

    for (let y = 0; y <= grid.height; y++) {
        const pixelY = y * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(0, pixelY);
        ctx.lineTo(grid.width * CELL_SIZE, pixelY);
        ctx.stroke();
    }
}

function renderFoodGauge(ctx: CanvasRenderingContext2D, state: ColonyState): void {
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
            tile.x * CELL_SIZE + FOOD_GAUGE_PADDING,
            tile.y * CELL_SIZE + FOOD_GAUGE_PADDING,
            CELL_SIZE - FOOD_GAUGE_PADDING * 2,
            CELL_SIZE - FOOD_GAUGE_PADDING * 2,
        );
        ctx.globalAlpha = 1;
    });
}

function renderBrood(ctx: CanvasRenderingContext2D, brood: Brood[]): void {
    ctx.strokeStyle = "#8a6f3a";
    ctx.lineWidth = 1;

    const groups = new Map<string, Brood[]>();
    for (const entry of brood) {
        if (entry.carriedBy !== undefined) {
            continue;
        }
        const key = `${entry.position.x},${entry.position.y}`;
        const group = groups.get(key);
        if (group) {
            group.push(entry);
        } else {
            groups.set(key, [entry]);
        }
    }

    for (const group of groups.values()) {
        const centerX = group[0].position.x * CELL_SIZE + CELL_SIZE / 2;
        const centerY = group[0].position.y * CELL_SIZE + CELL_SIZE / 2;

        group.forEach((entry, i) => {
            const angle = i * 2.399963;
            const spread = i === 0 ? 0 : BROOD_DOT_RADIUS + Math.sqrt(i) * BROOD_DOT_RADIUS * 1.4;
            const cx = centerX + Math.cos(angle) * spread;
            const cy = centerY + Math.sin(angle) * spread;

            ctx.fillStyle = STAGE_COLOR[entry.stage] ?? "#fbf1d0";
            ctx.beginPath();
            ctx.arc(cx, cy, BROOD_DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    }
}

// Groups corpses by tile and spreads any that share one in a small spiral —
// the same technique renderBrood uses above, for the same reason: with no
// occupancy mechanic (corpses.ts's header comment), nothing stops two dead
// ants landing on one tile, and without this they'd render as one
// indistinguishable blob. Excludes carried corpses (they ride the
// undertaker — drawAnt's carry-dot covers that) and surface-side ones (not
// this view's concern).
function renderCorpses(ctx: CanvasRenderingContext2D, corpses: Corpse[]): void {
    const groups = new Map<string, Corpse[]>();
    for (const corpse of corpses) {
        if (corpse.carriedBy !== undefined || corpse.location.where !== "nest") {
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
            const spread = i === 0 ? 0 : CELL_SIZE * 0.12 + Math.sqrt(i) * CELL_SIZE * 0.1;
            const dx = Math.cos(angle) * spread;
            const dy = Math.sin(angle) * spread;
            drawCorpse(ctx, corpse, CELL_SIZE, { dx, dy });
        });
    }
}

export function renderNestView(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    renderTiles(ctx, state.grid, state.nest);
    renderFoodGauge(ctx, state);
    renderBrood(ctx, state.brood);
    renderCorpses(ctx, state.corpses);

    // Corpse-carriers, built once per frame rather than checking
    // ant.undertaking on drawAnt's behalf — see ants.ts's comment on why
    // the carry-dot tracks carriedBy, not the assignment.
    const corpseCarriers = new Set<AntId>(
        state.corpses.filter((corpse) => corpse.carriedBy !== undefined).map((corpse) => corpse.carriedBy as AntId)
    );

    for (const ant of state.ants.values()) {
        if (ant.location.where === "nest") {
            drawAnt(ctx, ant, CELL_SIZE, corpseCarriers.has(ant.id));
        }
    }

    ctx.strokeStyle = SURFACE_LINE_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 1.5);
    ctx.lineTo(state.grid.width * CELL_SIZE, 1.5);
    ctx.stroke();
}