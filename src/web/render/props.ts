// Surface props — trees, rocks, and the entrance mound — rendered as real
// 3D placeholder objects standing up off the cube's top face, instead of
// the flat filled circles surface-view.ts used to paint into the surface
// texture (removed there in the same change that added this file). This is
// the roadmap's "the trees need to come up" ask: literal upright cards,
// not a dot on the ground texture.
//
// world/surface.ts's carveForest always places a tree as a 2x2 block of
// TILE.TREE tiles (one canopy, four tiles) — see its header comment. Placing
// one prop per TREE tile would draw four separate trees for one canopy, so
// findTileClusters below flood-fills same-type tiles into connected
// clusters first, and one prop is placed per cluster, sized to that
// cluster's footprint (a plain 2x2 canopy and an odd 1-3 tile doorway-repair
// remnant, both handled the same way, just come out different sizes).
//
// Anchored to the cube mesh (added as its children, in cube-local space via
// cube-layout.ts) rather than drawn as camera-facing billboards, so they
// visibly turn with the cube as the visitor orbits it — a flat paper cutout
// standing in the world, not a sprite that always faces the camera. That's
// deliberate: it's the same "surface-anchored, not camera-facing" call the
// Phase 12 art-direction discussion settled on for Paper-Mario-style scenery.
//
// Each prop is a billboard.ts "cross" (two copies of the same card crossed
// at 90°) rather than a single flat plane — a lone plane goes edge-on-
// invisible from one specific orbit angle, which read as "just a flat
// image" from one side. The cross keeps at least one of the two cards
// close to face-on no matter where the visitor orbits to, without needing
// real volumetric geometry.
//
// Each card is grounded by its measured content bottom (sprite-metrics.ts),
// not the plane geometry's own bottom edge — the canvas has transparent
// margin below the trunk/rock art (needed for alphaTest to cut it into a
// cutout at all), and positioning by the geometric edge left that margin's
// worth of empty space between the art and the ground, reading as "the
// whole prop is hovering."
//
// The art itself (canvas-drawn trunk+foliage / rock blobs) is a placeholder —
// Phase 12c's real sprite sheet replaces the texture builders below without
// touching clustering, placement, or visibility.
import * as THREE from "three";
import { tileAt, TILE, type Grid, type Position, type TileType } from "../../sim/world/grid";
import type { Season } from "../../sim/environment/season";
import { surfaceTileToLocal, type CubeDims } from "./cube-layout";
import { buildCrossBillboard } from "./billboard";
import { measureContentBottomFraction } from "./sprite-metrics";
import { SEASON_PALETTE, type FoliagePair } from "./season-palette";

type TileCluster = {
    tiles: Position[];
    centroidX: number;
    centroidY: number;
    spanTiles: number; // max(width, height) of the cluster's bounding box, in tiles
};

function findTileClusters(grid: Grid, tileType: TileType): TileCluster[] {
    const visited = new Uint8Array(grid.width * grid.height);
    const clusters: TileCluster[] = [];

    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const startIndex = y * grid.width + x;
            if (visited[startIndex] || tileAt(grid, x, y) !== tileType) {
                continue;
            }

            const tiles: Position[] = [];
            const queue: Position[] = [{ x, y }];
            visited[startIndex] = 1;

            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;

            while (queue.length > 0) {
                const tile = queue.pop() as Position;
                tiles.push(tile);
                minX = Math.min(minX, tile.x);
                maxX = Math.max(maxX, tile.x);
                minY = Math.min(minY, tile.y);
                maxY = Math.max(maxY, tile.y);

                const neighbors = [
                    { x: tile.x + 1, y: tile.y },
                    { x: tile.x - 1, y: tile.y },
                    { x: tile.x, y: tile.y + 1 },
                    { x: tile.x, y: tile.y - 1 },
                ];
                for (const n of neighbors) {
                    if (n.x < 0 || n.x >= grid.width || n.y < 0 || n.y >= grid.height) {
                        continue;
                    }
                    const nIndex = n.y * grid.width + n.x;
                    if (visited[nIndex] || tileAt(grid, n.x, n.y) !== tileType) {
                        continue;
                    }
                    visited[nIndex] = 1;
                    queue.push(n);
                }
            }

            const centroidX = tiles.reduce((sum, t) => sum + t.x, 0) / tiles.length + 0.5;
            const centroidY = tiles.reduce((sum, t) => sum + t.y, 0) / tiles.length + 0.5;
            const spanTiles = Math.max(maxX - minX + 1, maxY - minY + 1);

            clusters.push({ tiles, centroidX, centroidY, spanTiles });
        }
    }

    return clusters;
}

const TREE_ASPECT = 2.3; // height / width of the placeholder tree card
const TREE_WIDTH_PER_SPAN_TILE = 1.7; // world tiles of canopy width per tile of cluster footprint
const TRUNK_COLOR = "#4a3320";
// How many tree material variants exist, cycled by cluster index — most
// seasons' palette only defines one foliage pair (see season-palette.ts),
// in which case all TREE_VARIANT_COUNT canvases just end up drawn with the
// same color; autumn is the one that actually uses more than one.
const TREE_VARIANT_COUNT = 3;

function foliageForVariant(palette: FoliagePair[], index: number): FoliagePair {
    return palette[index % palette.length];
}

// ctx is redrawn in place (not recreated) so props.ts can recolor an
// existing tree texture in response to a season change without touching
// the meshes/materials/textures already built from it.
function drawTreeCanvas(ctx: CanvasRenderingContext2D, foliage: FoliagePair): void {
    ctx.clearRect(0, 0, 128, 200);

    ctx.fillStyle = TRUNK_COLOR;
    ctx.fillRect(56, 120, 16, 70);

    ctx.fillStyle = foliage.main;
    ctx.beginPath();
    ctx.arc(64, 90, 58, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = foliage.highlight;
    ctx.beginPath();
    ctx.arc(44, 66, 24, 0, Math.PI * 2);
    ctx.fill();
}

function buildTreeCanvas(foliage: FoliagePair): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for tree prop texture");
    }
    drawTreeCanvas(ctx, foliage);
    return canvas;
}

const ROCK_ASPECT = 0.75;
const ROCK_WIDTH_PER_SPAN_TILE = 1.4;
const ROCK_COLOR = "#7a7a72";
const ROCK_SHADE_COLOR = "#5e5e58";
const ROCK_HIGHLIGHT_COLOR = "#96968c";

function buildRockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for rock prop texture");
    }

    ctx.fillStyle = ROCK_COLOR;
    ctx.beginPath();
    ctx.moveTo(20, 100);
    ctx.lineTo(10, 60);
    ctx.lineTo(40, 20);
    ctx.lineTo(90, 12);
    ctx.lineTo(140, 35);
    ctx.lineTo(150, 80);
    ctx.lineTo(120, 108);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = ROCK_SHADE_COLOR;
    ctx.beginPath();
    ctx.moveTo(90, 12);
    ctx.lineTo(140, 35);
    ctx.lineTo(150, 80);
    ctx.lineTo(120, 108);
    ctx.lineTo(95, 70);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = ROCK_HIGHLIGHT_COLOR;
    ctx.beginPath();
    ctx.moveTo(40, 20);
    ctx.lineTo(90, 12);
    ctx.lineTo(70, 45);
    ctx.lineTo(35, 45);
    ctx.closePath();
    ctx.fill();

    return canvas;
}

// The entrance mound — a small excavated-dirt pile with the actual opening
// as a dark hole near its peak, same "canvas-drawn cutout, grounded by
// measured content bottom" treatment as trees/rocks above. Replaces the
// flat dark circle surface-view.ts used to paint straight onto the ground
// texture for state.surface.holePos — a real ant hill reads as a mound the
// colony piled up around its entrance, not a hole painted on flat ground.
const MOUND_ASPECT = 0.72;
const MOUND_WIDTH_TILES = 2.4; // world tiles wide — holePos is a single point, not a tile cluster, so this is fixed rather than derived from a cluster span
const MOUND_COLOR = "#4a3320";
const MOUND_SHADE_COLOR = "#2e2013";
const MOUND_HIGHLIGHT_COLOR = "#6b4f34";
const MOUND_HOLE_COLOR = "#140d06";

function buildMoundCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 115;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for mound prop texture");
    }

    ctx.fillStyle = MOUND_COLOR;
    ctx.beginPath();
    ctx.moveTo(10, 108);
    ctx.lineTo(6, 70);
    ctx.lineTo(35, 30);
    ctx.lineTo(80, 8);
    ctx.lineTo(130, 25);
    ctx.lineTo(154, 65);
    ctx.lineTo(150, 105);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = MOUND_SHADE_COLOR;
    ctx.beginPath();
    ctx.moveTo(80, 8);
    ctx.lineTo(130, 25);
    ctx.lineTo(154, 65);
    ctx.lineTo(150, 105);
    ctx.lineTo(100, 60);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = MOUND_HIGHLIGHT_COLOR;
    ctx.beginPath();
    ctx.moveTo(35, 30);
    ctx.lineTo(80, 8);
    ctx.lineTo(60, 45);
    ctx.lineTo(28, 48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = MOUND_HOLE_COLOR;
    ctx.beginPath();
    ctx.ellipse(82, 48, 26, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

export type SurfaceProps = {
    group: THREE.Group;
    setVisible: (visible: boolean) => void;
    updateSeason: (season: Season) => void;
};

export function buildSurfaceProps(
    surfaceGrid: Grid,
    dims: CubeDims,
    holePos: Position,
    initialSeason: Season,
): SurfaceProps {
    const group = new THREE.Group();
    const worldPerTile = dims.width / surfaceGrid.width;

    // TREE_VARIANT_COUNT canvases/textures/materials, one per cycled tint
    // (see foliageForVariant) — recolored in place by updateSeason rather
    // than rebuilt, so a season change doesn't need to touch any tree's
    // mesh/geometry/material reference, just what its shared material's
    // texture currently looks like.
    const treeCanvases: HTMLCanvasElement[] = [];
    const treeContexts: CanvasRenderingContext2D[] = [];
    const treeMaterials: THREE.MeshLambertMaterial[] = [];
    for (let i = 0; i < TREE_VARIANT_COUNT; i++) {
        const foliage = foliageForVariant(SEASON_PALETTE[initialSeason].treeFoliage, i);
        const canvas = buildTreeCanvas(foliage);
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Could not get 2D canvas context for tree prop texture");
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        treeCanvases.push(canvas);
        treeContexts.push(ctx);
        treeMaterials.push(
            new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.3,
                side: THREE.DoubleSide,
            }),
        );
    }
    const treeGroundFraction = measureContentBottomFraction(treeCanvases[0]);
    findTileClusters(surfaceGrid, TILE.TREE).forEach((cluster, i) => {
        const planeWidth = worldPerTile * TREE_WIDTH_PER_SPAN_TILE * cluster.spanTiles;
        const planeHeight = planeWidth * TREE_ASPECT;
        const base = surfaceTileToLocal(cluster.centroidX, cluster.centroidY, surfaceGrid, dims);
        const material = treeMaterials[i % TREE_VARIANT_COUNT];
        const cross = buildCrossBillboard(new THREE.PlaneGeometry(planeWidth, planeHeight), material);
        cross.position.set(base.x, base.y + planeHeight * (treeGroundFraction - 0.5), base.z);
        group.add(cross);
    });

    const rockCanvas = buildRockCanvas();
    const rockGroundFraction = measureContentBottomFraction(rockCanvas);
    const rockTexture = new THREE.CanvasTexture(rockCanvas);
    rockTexture.colorSpace = THREE.SRGBColorSpace;
    const rockMaterial = new THREE.MeshLambertMaterial({
        map: rockTexture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });
    for (const cluster of findTileClusters(surfaceGrid, TILE.ROCK)) {
        const planeWidth = worldPerTile * ROCK_WIDTH_PER_SPAN_TILE * cluster.spanTiles;
        const planeHeight = planeWidth * ROCK_ASPECT;
        const base = surfaceTileToLocal(cluster.centroidX, cluster.centroidY, surfaceGrid, dims);
        const cross = buildCrossBillboard(new THREE.PlaneGeometry(planeWidth, planeHeight), rockMaterial);
        cross.position.set(base.x, base.y + planeHeight * (rockGroundFraction - 0.5), base.z);
        group.add(cross);
    }

    const moundCanvas = buildMoundCanvas();
    const moundGroundFraction = measureContentBottomFraction(moundCanvas);
    const moundTexture = new THREE.CanvasTexture(moundCanvas);
    moundTexture.colorSpace = THREE.SRGBColorSpace;
    const moundMaterial = new THREE.MeshLambertMaterial({
        map: moundTexture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });
    const moundWidth = worldPerTile * MOUND_WIDTH_TILES;
    const moundHeight = moundWidth * MOUND_ASPECT;
    const moundBase = surfaceTileToLocal(holePos.x + 0.5, holePos.y + 0.5, surfaceGrid, dims);
    const moundCross = buildCrossBillboard(new THREE.PlaneGeometry(moundWidth, moundHeight), moundMaterial);
    moundCross.position.set(moundBase.x, moundBase.y + moundHeight * (moundGroundFraction - 0.5), moundBase.z);
    group.add(moundCross);

    let lastSeason = initialSeason;

    return {
        group,
        setVisible: (visible: boolean) => {
            group.visible = visible;
        },
        updateSeason: (season: Season) => {
            if (season === lastSeason) {
                return;
            }
            lastSeason = season;
            const palette = SEASON_PALETTE[season].treeFoliage;
            for (let i = 0; i < TREE_VARIANT_COUNT; i++) {
                drawTreeCanvas(treeContexts[i], foliageForVariant(palette, i));
                (treeMaterials[i].map as THREE.CanvasTexture).needsUpdate = true;
            }
        },
    };
}
