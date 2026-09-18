// Side cross-section of the underground: tiles by type/chamber-role tint
// (folded in from the deleted render/grid.ts) and the dig frontier
// highlight. PHASE 3b: the two-view split means every render module needs
// to own a specific state slice — "the whole nest" was the natural unit
// when this also drew the FOOD_STORAGE gauge, brood, and corpses, but
// those are all real 3D decals now (render/food-props.ts,
// render/brood-props.ts, render/corpse-props.ts — see decal-pool.ts's
// header for why) instead of being painted into this texture, so this file
// is down to just the terrain itself.
import { tileAt, isInBounds, TILE, type Grid } from "../../sim/world/grid";
import { chamberAt, frontierTiles, bootstrapFrontierTile, type ChamberRole, type Nest } from "../../sim/world/nest";
import type { ColonyState } from "../../sim/state";
import type { RenderOptions } from "../ui/control-panel";
import { CELL_SIZE } from "../config";

// Exported — render/engine.ts uses the same brown for the cube's four
// unpainted side/bottom/back faces, so undug SOIL and "the rest of the dirt
// block" read as the same material rather than two different shades of
// brown.
export const SOIL_COLOR = "#3b2a1a";

const TUNNEL_COLOR = "#c9b896";

// EXIT used to be a distinct pale blue — the same color as SURFACE_LINE_COLOR
// below — which read as an odd blue strip sitting inside the dirt rather
// than "the tunnel that happens to reach the surface." It's just a tunnel
// visually now; the thin SURFACE_LINE_COLOR stroke at the very top edge is
// still there to mark the seam.
const TILE_COLOR: Record<number, string> = {
    [TILE.SOIL]: SOIL_COLOR,
    [TILE.TUNNEL]: TUNNEL_COLOR,
    [TILE.CHAMBER]: "#e8d8b8",
    [TILE.WALL]: "#1a1208",
    [TILE.EXIT]: TUNNEL_COLOR,
};

const ROLE_TINT: Partial<Record<ChamberRole, string>> = {
    QUEEN: "#c98a9e",
    NURSERY: "#f2d98c",
    FOOD_STORAGE: "#8bb36a",
};

const FRONTIER_COLOR = "#8a5a2a";
const FRONTIER_CLAIMED_COLOR = "#e0902f";
const FRONTIER_PADDING = CELL_SIZE * 0.15;

// Marks the seam where this pane visually connects to render/surface-view.ts
// — the two views are one continuous space split across two canvases, not
// unrelated boards. Drawn at the top edge (y=0) rather than computed from
// exitMouth, since the seam is "the top of the nest" conceptually, not tied
// to the shaft's exact width. Used to be a pale blue (same as the old EXIT
// tile color) which read as a literal blue strip laid across the top of the
// dirt — a dark soil tone instead, so it reads as a seam line, not a
// separate colored band.
const SURFACE_LINE_COLOR = "#241708";

// PHASE 12 (terrain texture pass, take 2): a blur+speckle-noise pass here
// read as muddy rather than the flat, clean "paper" look Phase 12's art
// direction actually wants — reverted to flat per-cell fills, no stroked
// grid line at every boundary (that line was the literal "visible lattice"
// the roadmap's "hide the grid" ask calls out).
//
// PHASE 12 (take 3): flat color alone still read as bare, so each tile type
// gets its own light, crisp overlay pattern instead — small hard-edged
// flecks, not the earlier blur+noise. SOIL gets scattered dark pebble
// flecks (undug earth), TUNNEL gets a few faint pale streaks (worn-smooth
// walls, deliberately sparser than the others — the roadmap's "tunnels as
// smooth channels" — so it reads calmer than the dug spaces around it),
// CHAMBER gets soil-toned flecks at low alpha so it layers over any
// ROLE_TINT color without fighting it. Each is confined to its own tile
// type via a clip path built from that tile's own cells, so tunnels never
// pick up soil's texture or vice versa.
const SOIL_FLECK_TILE = buildFleckOverlayTile({ size: 24, count: 10, colors: ["#241708", "#4a3524"], radius: 1.6 });
const CHAMBER_FLECK_TILE = buildFleckOverlayTile({ size: 26, count: 7, colors: ["#8a6f52"], radius: 1.4, alpha: 0.18 });
const TUNNEL_STREAK_TILE = buildStreakOverlayTile({ size: 30, count: 3, color: "#a08a63" });

function buildFleckOverlayTile(options: {
    size: number;
    count: number;
    colors: string[];
    radius: number;
    alpha?: number;
}): HTMLCanvasElement {
    const { size, count, colors, radius, alpha } = options;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for fleck overlay tile");
    }

    for (let i = 0; i < count; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = radius * (0.7 + Math.random() * 0.6);
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.globalAlpha = alpha ?? 0.3 + Math.random() * 0.25;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    return canvas;
}

function buildStreakOverlayTile(options: { size: number; count: number; color: string }): HTMLCanvasElement {
    const { size, count, color } = options;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for streak overlay tile");
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.35;

    for (let i = 0; i < count; i++) {
        const y = Math.random() * size;
        const startX = Math.random() * size * 0.4;
        const length = size * (0.3 + Math.random() * 0.3);
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + length, y);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    return canvas;
}

// Reused by render/engine.ts for the cube's four unpainted faces (the ones
// with no grid to paint tiles onto) — so "undug soil" and "the rest of the
// dirt block" share the literal same fleck texture at the same density, not
// just the same flat color. Baked at native SOIL_FLECK_TILE resolution (no
// scaling here); engine.ts is the one that decides how many times to repeat
// it across a much bigger face, which is what keeps the flecks the same
// physical size there as they are here instead of being stretched huge.
export function buildSoilFaceTexture(size = 64): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for soil face texture");
    }

    ctx.fillStyle = SOIL_COLOR;
    ctx.fillRect(0, 0, size, size);
    const pattern = ctx.createPattern(SOIL_FLECK_TILE, "repeat");
    if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, size, size);
    }

    return canvas;
}

function isSolid(grid: Grid, x: number, y: number): boolean {
    if (!isInBounds(grid, x, y)) {
        return true;
    }
    const tile = tileAt(grid, x, y);
    return tile === TILE.SOIL || tile === TILE.WALL;
}

// How rounded a dug tile's corners get — only the corners that are true
// "outer" corners of the dug space (both edge-neighbors at that corner are
// solid earth) round off; a corner where the tile keeps going into another
// dug tile stays square, so adjoining tiles still read as one continuous
// room/tunnel instead of a chain of separately-rounded blobs. This is the
// "round off everything" ask — a cheap per-tile stand-in for real organic
// dug-space outlines (marching-squares-style contour smoothing), not that
// itself.
const TILE_CORNER_RADIUS = CELL_SIZE * 0.42;

function roundedTilePath(grid: Grid, x: number, y: number): Path2D {
    const px = x * CELL_SIZE;
    const py = y * CELL_SIZE;
    const r = TILE_CORNER_RADIUS;
    const topLeft = isSolid(grid, x, y - 1) && isSolid(grid, x - 1, y) ? r : 0;
    const topRight = isSolid(grid, x, y - 1) && isSolid(grid, x + 1, y) ? r : 0;
    const bottomRight = isSolid(grid, x, y + 1) && isSolid(grid, x + 1, y) ? r : 0;
    const bottomLeft = isSolid(grid, x, y + 1) && isSolid(grid, x - 1, y) ? r : 0;

    const path = new Path2D();
    path.roundRect(px, py, CELL_SIZE, CELL_SIZE, [topLeft, topRight, bottomRight, bottomLeft]);
    return path;
}

// Fills a Path2D (built from one or more tiles' rounded-corner shapes) with
// `overlayTile`'s repeating pattern, clipped to that path — a plain
// ctx.createPattern + fillRect over the whole canvas would bleed the
// pattern into every other tile type (and past the rounded corners) too.
function fillPathWithPattern(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    overlayTile: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
): void {
    const pattern = ctx.createPattern(overlayTile, "repeat");
    if (!pattern) {
        return;
    }

    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
}

// Shared by renderTiles' own base fill and renderNestView's wider margin
// fill (the padding described in engine.ts's nestCanvas comment) — both are
// "flood this rect with soil + its fleck pattern," just over different
// rects, so the pattern-fill boilerplate only lives once.
function fillSoilBase(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = SOIL_COLOR;
    ctx.fillRect(0, 0, width, height);
    const soilPattern = ctx.createPattern(SOIL_FLECK_TILE, "repeat");
    if (soilPattern) {
        ctx.fillStyle = soilPattern;
        ctx.fillRect(0, 0, width, height);
    }
}

function renderTiles(ctx: CanvasRenderingContext2D, grid: Grid, nest: Nest, showChamberColors: boolean): void {
    const width = grid.width * CELL_SIZE;
    const height = grid.height * CELL_SIZE;

    // Wherever a dug tile's corner rounds away, this base fill shows
    // through underneath instead of leaving a gap, so "carved into solid
    // dirt" holds even at the rounded corners without tracking soil tiles
    // separately.
    fillSoilBase(ctx, width, height);

    const tunnelPath = new Path2D();
    const chamberPath = new Path2D();
    const exitPath = new Path2D();

    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const tile = tileAt(grid, x, y);
            if (tile === TILE.SOIL) {
                continue; // already covered by the base fill above
            }

            if (tile === TILE.WALL) {
                // Rare/unused (see grid.ts's header) — plain square is fine.
                ctx.fillStyle = TILE_COLOR[TILE.WALL];
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                continue;
            }

            const path = roundedTilePath(grid, x, y);
            let color = TILE_COLOR[tile] ?? TUNNEL_COLOR;

            if (tile === TILE.CHAMBER) {
                if (showChamberColors) {
                    const role = chamberAt(nest, { x, y });
                    if (role !== undefined && ROLE_TINT[role] !== undefined) {
                        color = ROLE_TINT[role] as string;
                    }
                }
                chamberPath.addPath(path);
            } else {
                // TUNNEL and EXIT share the same look — see TILE_COLOR's
                // comment on why EXIT isn't a distinct color anymore.
                tunnelPath.addPath(path);
                if (tile === TILE.EXIT) {
                    exitPath.addPath(path);
                }
            }

            ctx.fillStyle = color;
            ctx.fill(path);
        }
    }

    fillPathWithPattern(ctx, tunnelPath, TUNNEL_STREAK_TILE, width, height);
    fillPathWithPattern(ctx, chamberPath, CHAMBER_FLECK_TILE, width, height);

    renderIndentShading(ctx, grid);
    renderExitGlow(ctx, exitPath, width);
}

// The EXIT shaft is a tunnel like any other by tile color, but it's the one
// tunnel that actually leads somewhere a visitor can see — up to
// render/props.ts's entrance mound on the surface face. A warm glow that
// brightens toward the seam (y=0) reads as daylight falling down the shaft
// from the opening above, which is the cheapest 2D way to imply "this one
// goes up and out" without literally connecting geometry across two
// perpendicular cube faces.
const EXIT_GLOW_COLOR = "255, 244, 214";
const EXIT_GLOW_MAX_ALPHA = 0.55;
const EXIT_GLOW_DEPTH_TILES = 3.5;

function renderExitGlow(ctx: CanvasRenderingContext2D, exitPath: Path2D, canvasWidth: number): void {
    const depth = CELL_SIZE * EXIT_GLOW_DEPTH_TILES;
    const gradient = ctx.createLinearGradient(0, 0, 0, depth);
    gradient.addColorStop(0, `rgba(${EXIT_GLOW_COLOR}, ${EXIT_GLOW_MAX_ALPHA})`);
    gradient.addColorStop(1, `rgba(${EXIT_GLOW_COLOR}, 0)`);

    ctx.save();
    ctx.clip(exitPath);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, depth);
    ctx.restore();
}

// The dirt margin between the seam and the EXIT shaft's mouth (see
// engine.ts's NEST_TOP_MARGIN_TILES) is otherwise just more plain soil —
// this paints a funnel shape into it, over the soil, from the shaft's own
// width narrowing at the bottom out to a wider mouth at the seam, so it
// reads as dirt worn away by ants climbing up to the hole rather than an
// arbitrary gap. Purely decorative on top of the existing soil tiles —
// doesn't touch which cells are dug (that's the "without changing the
// actual tiles" part; TILE.EXIT's own footprint is untouched).
const EXIT_CONE_SPREAD = CELL_SIZE * 2.2; // how much wider the mouth is than the shaft at its narrow end
const EXIT_CONE_NARROW_COLOR = TUNNEL_COLOR;
const EXIT_CONE_WIDE_COLOR = "#f4e9d3";

function findExitOpeningColumns(grid: Grid): { minX: number; maxX: number } | undefined {
    let minX: number | undefined;
    let maxX: number | undefined;
    for (let x = 0; x < grid.width; x++) {
        if (tileAt(grid, x, 0) === TILE.EXIT) {
            minX = minX === undefined ? x : Math.min(minX, x);
            maxX = maxX === undefined ? x : Math.max(maxX, x);
        }
    }
    return minX !== undefined && maxX !== undefined ? { minX, maxX } : undefined;
}

function renderExitCone(ctx: CanvasRenderingContext2D, grid: Grid, marginPx: number, topMarginPx: number): void {
    const opening = findExitOpeningColumns(grid);
    if (!opening) {
        return;
    }

    const left = marginPx + opening.minX * CELL_SIZE;
    const right = marginPx + (opening.maxX + 1) * CELL_SIZE;
    const bottom = topMarginPx; // the shaft's own top edge, where the cone narrows down to the tunnel's width
    const wideLeft = left - EXIT_CONE_SPREAD;
    const wideRight = right + EXIT_CONE_SPREAD;

    const path = new Path2D();
    path.moveTo(left, bottom);
    path.quadraticCurveTo(left, bottom * 0.4, wideLeft, 0);
    path.lineTo(wideRight, 0);
    path.quadraticCurveTo(right, bottom * 0.4, right, bottom);
    path.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, bottom);
    gradient.addColorStop(0, EXIT_CONE_WIDE_COLOR);
    gradient.addColorStop(1, EXIT_CONE_NARROW_COLOR);
    ctx.fillStyle = gradient;
    ctx.fill(path);
}

// Fakes "carved into solid dirt" with 2D shading instead of real recessed
// geometry (two earlier attempts at actual depth here — a whole-plane inset
// behind a dirt frame, then a per-tile soil mask with a separately-recessed
// plane — didn't read right; see cube-layout.ts's nestTileToLocal comment).
// A prior version of this also painted a soft highlight rim into the
// neighboring soil, but blending two gradients per edge read as a muddy
// glow rather than a clean carved lip — simplified to just one thing: a
// single, fairly hard-edged dark band just inside any dug tile's edge that
// borders solid earth, clipped to that tile's own rounded shape so it
// respects the same corners as the fill. Narrower than the old shadow
// width too — the old width was wide enough that a single-tile-wide
// tunnel had its two opposing edge-shadows overlap across the whole tile,
// which read as a uniformly dark tile rather than a carved passage.
const SHADOW_WIDTH = CELL_SIZE * 0.28;
const SHADOW_COLOR = "0, 0, 0";
const SHADOW_MAX_ALPHA = 0.55;

function renderIndentShading(ctx: CanvasRenderingContext2D, grid: Grid): void {
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const tile = tileAt(grid, x, y);
            if (tile === TILE.SOIL || tile === TILE.WALL) {
                continue;
            }

            const px = x * CELL_SIZE;
            const py = y * CELL_SIZE;
            const solidN = isSolid(grid, x, y - 1);
            const solidS = isSolid(grid, x, y + 1);
            const solidW = isSolid(grid, x - 1, y);
            const solidE = isSolid(grid, x + 1, y);

            ctx.save();
            ctx.clip(roundedTilePath(grid, x, y));

            if (solidN) {
                const gradient = ctx.createLinearGradient(0, py, 0, py + SHADOW_WIDTH);
                gradient.addColorStop(0, `rgba(${SHADOW_COLOR}, ${SHADOW_MAX_ALPHA})`);
                gradient.addColorStop(1, `rgba(${SHADOW_COLOR}, 0)`);
                ctx.fillStyle = gradient;
                ctx.fillRect(px, py, CELL_SIZE, SHADOW_WIDTH);
            }
            if (solidS) {
                const gradient = ctx.createLinearGradient(0, py + CELL_SIZE, 0, py + CELL_SIZE - SHADOW_WIDTH);
                gradient.addColorStop(0, `rgba(${SHADOW_COLOR}, ${SHADOW_MAX_ALPHA})`);
                gradient.addColorStop(1, `rgba(${SHADOW_COLOR}, 0)`);
                ctx.fillStyle = gradient;
                ctx.fillRect(px, py + CELL_SIZE - SHADOW_WIDTH, CELL_SIZE, SHADOW_WIDTH);
            }
            if (solidW) {
                const gradient = ctx.createLinearGradient(px, 0, px + SHADOW_WIDTH, 0);
                gradient.addColorStop(0, `rgba(${SHADOW_COLOR}, ${SHADOW_MAX_ALPHA})`);
                gradient.addColorStop(1, `rgba(${SHADOW_COLOR}, 0)`);
                ctx.fillStyle = gradient;
                ctx.fillRect(px, py, SHADOW_WIDTH, CELL_SIZE);
            }
            if (solidE) {
                const gradient = ctx.createLinearGradient(px + CELL_SIZE, 0, px + CELL_SIZE - SHADOW_WIDTH, 0);
                gradient.addColorStop(0, `rgba(${SHADOW_COLOR}, ${SHADOW_MAX_ALPHA})`);
                gradient.addColorStop(1, `rgba(${SHADOW_COLOR}, 0)`);
                ctx.fillStyle = gradient;
                ctx.fillRect(px + CELL_SIZE - SHADOW_WIDTH, py, SHADOW_WIDTH, CELL_SIZE);
            }

            ctx.restore();
        }
    }
}

function renderDigFrontier(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    const plan = state.pendingDigPlan;
    if (!plan) {
        return;
    }

    const frontier =
        plan.chamberId !== undefined
            ? frontierTiles(state.grid, state.nest, plan.chamberId)
            : (() => {
                  const tile = bootstrapFrontierTile(state.grid, state.nest, plan.near);
                  return tile ? [tile] : [];
              })();

    const claimed = new Set(Object.values(plan.claims).map((t) => `${t.x},${t.y}`));

    for (const tile of frontier) {
        const key = `${tile.x},${tile.y}`;
        ctx.fillStyle = claimed.has(key) ? FRONTIER_CLAIMED_COLOR : FRONTIER_COLOR;
        ctx.fillRect(
            tile.x * CELL_SIZE + FRONTIER_PADDING,
            tile.y * CELL_SIZE + FRONTIER_PADDING,
            CELL_SIZE - FRONTIER_PADDING * 2,
            CELL_SIZE - FRONTIER_PADDING * 2,
        );
    }
}

// canvasWidth/marginPx: see render/engine.ts's nestCanvas comment — the
// canvas is padded wider than the nest grid itself so a nest tile ends up
// the same on-screen size as a surface tile once both faces are stretched
// to their own full width. This fills that padding with the same soil
// texture as the cube's unpainted faces, then draws the grid centered in
// the middle of it, offset by marginPx.
// topMarginPx: same idea vertically — a strip of solid dirt above row 0 so
// the EXIT shaft opens into dirt instead of butting straight against the
// seam stroke below.
export function renderNestView(
    ctx: CanvasRenderingContext2D,
    state: ColonyState,
    canvasWidth: number,
    marginPx: number,
    topMarginPx: number,
    options: RenderOptions,
): void {
    fillSoilBase(ctx, canvasWidth, state.grid.height * CELL_SIZE + topMarginPx);

    ctx.save();
    ctx.translate(marginPx, topMarginPx);
    renderTiles(ctx, state.grid, state.nest, options.showChamberColors);
    renderDigFrontier(ctx, state);
    ctx.restore();

    renderExitCone(ctx, state.grid, marginPx, topMarginPx);

    // Ants, brood, corpses, and the FOOD_STORAGE gauge are all drawn as
    // real 3D decals standing/lying on the cube now, not painted into this
    // texture — see render/ant-props.ts, render/brood-props.ts,
    // render/corpse-props.ts, render/food-props.ts.

    ctx.strokeStyle = SURFACE_LINE_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 1.5);
    ctx.lineTo(canvasWidth, 1.5);
    ctx.stroke();
}
