// Food — outdoor piles and indoor FOOD_STORAGE stashes — as real 3D decals
// on the cube — see decal-pool.ts's header for why (crispness, and no more
// bleeding into a neighboring tile's texture). Both use the same leaf-pile
// art (a cluster of individual green leaf shapes over a shaded base, not
// the earlier gold-seed mound) since they're the same stuff — foraged
// greenery — just outdoors on the ground vs. stashed against the nest
// wall, and sharing one texture keeps "this is food" reading consistently
// wherever it shows up.
//
// Outdoor piles lie flat on the ground (rotated so the texture faces
// +Y — "up" — like a decal on the floor, not standing up the way live ants
// do). Indoor storage decals lie flat against the nest's vertical
// cross-section face, same as nest ants/brood/corpses.
import * as THREE from "three";
import type { ColonyState } from "../../sim/state";
import type { Grid } from "../../sim/world/grid";
import { allTilesOf } from "../../sim/world/nest";
import { surfaceTileToLocal, nestTileToLocal, surfaceWorldPerTile, nestWorldPerTile, type CubeDims } from "./cube-layout";
import { buildDecalPool, type DecalPlacement } from "./decal-pool";

const NEST_FACE_OFFSET = 0.02; // same convention as the other nest-wall decals
const SURFACE_GROUND_OFFSET = 0.002; // same convention as corpse-props.ts

const PILE_SPRITE_SIZE = 48;

function buildLeafPileSprite(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = PILE_SPRITE_SIZE;
    canvas.height = PILE_SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for leaf pile sprite");
    }
    const cx = PILE_SPRITE_SIZE / 2;
    const cy = PILE_SPRITE_SIZE / 2;

    // Shaded base mound, under the individual leaves.
    ctx.fillStyle = "#2f5c22";
    ctx.strokeStyle = "#1c3714";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 19, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const leaves: { dx: number; dy: number; rot: number; len: number; color: string }[] = [
        { dx: -11, dy: -3, rot: -0.5, len: 15, color: "#4a8a34" },
        { dx: 2, dy: -7, rot: 0.25, len: 16, color: "#5c9c3f" },
        { dx: 12, dy: -2, rot: 0.65, len: 14, color: "#3f7a2b" },
        { dx: -3, dy: 2, rot: -0.15, len: 15, color: "#4a8a34" },
        { dx: -14, dy: 5, rot: -0.7, len: 12, color: "#5c9c3f" },
        { dx: 9, dy: 5, rot: 0.4, len: 13, color: "#3f7a2b" },
    ];

    for (const leaf of leaves) {
        ctx.save();
        ctx.translate(cx + leaf.dx, cy + leaf.dy);
        ctx.rotate(leaf.rot);

        ctx.fillStyle = leaf.color;
        ctx.strokeStyle = "#1c3714";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.ellipse(0, 0, leaf.len / 2, leaf.len * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "rgba(28, 55, 20, 0.55)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-leaf.len / 2, 0);
        ctx.lineTo(leaf.len / 2, 0);
        ctx.stroke();

        ctx.restore();
    }

    return canvas;
}

const LEAF_PILE_SPRITE = buildLeafPileSprite();

function buildMaterial(): THREE.MeshLambertMaterial {
    const texture = new THREE.CanvasTexture(LEAF_PILE_SPRITE);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });
}

export type FoodPileProps = {
    group: THREE.Group;
    update: (state: ColonyState) => void;
};

const PILE_BASE_SIZE_RATIO = 0.8; // decal width, in tiles, at full capacity
const PILE_MIN_SCALE = 0.25;

export function buildFoodPileProps(surfaceGrid: Grid, dims: CubeDims): FoodPileProps {
    const pool = buildDecalPool(buildMaterial(), new THREE.PlaneGeometry(1, 1));
    const worldPerTile = surfaceWorldPerTile(dims, surfaceGrid);

    function update(state: ColonyState): void {
        const entries = new Map<string, DecalPlacement>();

        for (const pile of state.surface.foodPiles) {
            const fullness = pile.capacity > 0 ? Math.min(1, pile.amount / pile.capacity) : 0;
            if (fullness <= 0) {
                continue;
            }

            const scale = PILE_MIN_SCALE + (1 - PILE_MIN_SCALE) * fullness;
            const local = surfaceTileToLocal(pile.pos.x, pile.pos.y, surfaceGrid, dims);
            entries.set(pile.id, {
                x: local.x,
                y: local.y + SURFACE_GROUND_OFFSET,
                z: local.z,
                rotation: { x: -Math.PI / 2, y: 0, z: 0 },
                size: worldPerTile * PILE_BASE_SIZE_RATIO * scale,
                opacity: 0.35 + 0.65 * fullness,
            });
        }

        pool.sync(entries);
    }

    return { group: pool.group, update };
}

export type FoodStorageProps = {
    group: THREE.Group;
    update: (state: ColonyState) => void;
};

export function buildFoodStorageProps(nestGrid: Grid, dims: CubeDims): FoodStorageProps {
    const pool = buildDecalPool(buildMaterial(), new THREE.PlaneGeometry(1, 1));
    const size = nestWorldPerTile(dims, nestGrid) * 0.8;

    function update(state: ColonyState): void {
        const tiles = allTilesOf(state.nest, "FOOD_STORAGE");
        const entries = new Map<string, DecalPlacement>();

        if (tiles.length > 0) {
            const fullness = state.foodStore.capacity > 0 ? state.foodStore.amount / state.foodStore.capacity : 0;
            const litUnits = fullness * tiles.length;

            tiles.forEach((tile, i) => {
                const tileFill = Math.max(0, Math.min(1, litUnits - i));
                if (tileFill <= 0) {
                    return;
                }

                const local = nestTileToLocal(tile.x + 0.5, tile.y + 0.5, nestGrid, dims);
                entries.set(`${tile.x},${tile.y}`, {
                    x: local.x,
                    y: local.y,
                    z: local.z + NEST_FACE_OFFSET,
                    rotation: { x: 0, y: 0, z: 0 },
                    size,
                    opacity: 0.35 + 0.65 * tileFill,
                });
            });
        }

        pool.sync(entries);
    }

    return { group: pool.group, update };
}
