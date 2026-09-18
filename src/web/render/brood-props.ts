// Brood (eggs/larvae/pupae) as real 3D decals on the cube — see
// decal-pool.ts's header for why (crispness, and no more bleeding into a
// neighboring tile's texture; brood always lives in the nest, so this is
// the module that was actually producing the "eggs leak into the dirt
// tile" symptom). Always flat against the nest's vertical cross-section
// face, like nest ants — brood never stands up the way a live ant does.
//
// Each stage gets its own tiny sprite (built once, here) instead of the
// old flat STAGE_COLOR dot: an egg reads as a glossy oval, a larva as a
// curled pale grub, a pupa as a wrapped cocoon capsule.
//
// Multiple brood entries can share one tile (a nurse can drop several eggs
// in the same nursery cell), so this groups by tile and spreads them in
// the same small spiral render/nest-view.ts's old renderBrood used, keyed
// by brood.id for decal-pool's add/remove lifecycle.
import * as THREE from "three";
import type { ColonyState } from "../../sim/state";
import type { Brood } from "../../sim/colony/brood";
import type { Grid } from "../../sim/world/grid";
import { nestTileToLocal, nestWorldPerTile, type CubeDims } from "./cube-layout";
import { buildDecalPool, type DecalPlacement } from "./decal-pool";

const NEST_FACE_OFFSET = 0.02; // same convention as ant-props.ts/corpse-props.ts
const BROOD_SPRITE_SIZE = 40;
const BROOD_OUTLINE = "#6b5228";

function buildEggSprite(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = BROOD_SPRITE_SIZE;
    canvas.height = BROOD_SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for egg sprite");
    }
    const cx = BROOD_SPRITE_SIZE / 2;
    const cy = BROOD_SPRITE_SIZE / 2;

    ctx.fillStyle = "#fbf1d0";
    ctx.strokeStyle = BROOD_OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 11, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 6, 3.5, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    return canvas;
}

function buildLarvaSprite(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = BROOD_SPRITE_SIZE;
    canvas.height = BROOD_SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for larva sprite");
    }
    const cx = BROOD_SPRITE_SIZE / 2;
    const cy = BROOD_SPRITE_SIZE / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.35);

    ctx.fillStyle = "#f2d98c";
    ctx.strokeStyle = BROOD_OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Segment lines across the curled body — the one cue that reads as
    // "larva" rather than just a smaller egg.
    ctx.strokeStyle = "rgba(107, 82, 40, 0.6)";
    ctx.lineWidth = 1.2;
    for (const dx of [-8, -1, 6]) {
        ctx.beginPath();
        ctx.moveTo(dx, -6);
        ctx.lineTo(dx, 6);
        ctx.stroke();
    }

    ctx.restore();
    return canvas;
}

function buildPupaSprite(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = BROOD_SPRITE_SIZE;
    canvas.height = BROOD_SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for pupa sprite");
    }
    const cx = BROOD_SPRITE_SIZE / 2;
    const cy = BROOD_SPRITE_SIZE / 2;

    ctx.fillStyle = "#c99a52";
    ctx.strokeStyle = BROOD_OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 9, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cocoon wrap lines.
    ctx.strokeStyle = "rgba(107, 82, 40, 0.5)";
    ctx.lineWidth = 1.2;
    for (const dy of [-7, -1, 5]) {
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy + dy);
        ctx.lineTo(cx + 8, cy + dy + 2);
        ctx.stroke();
    }

    return canvas;
}

const STAGE_SPRITE: Record<string, HTMLCanvasElement> = {
    EGG: buildEggSprite(),
    LARVA: buildLarvaSprite(),
    PUPA: buildPupaSprite(),
};

const BROOD_SIZE_RATIO = 0.32; // decal width relative to a nest grid tile

export type BroodProps = {
    group: THREE.Group;
    update: (state: ColonyState) => void;
};

export function buildBroodProps(nestGrid: Grid, dims: CubeDims): BroodProps {
    const group = new THREE.Group();
    const pools: Record<string, ReturnType<typeof buildDecalPool>> = {};

    for (const [stage, sprite] of Object.entries(STAGE_SPRITE)) {
        const texture = new THREE.CanvasTexture(sprite);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshLambertMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.3,
            side: THREE.DoubleSide,
        });
        const pool = buildDecalPool(material, new THREE.PlaneGeometry(1, 1));
        pools[stage] = pool;
        group.add(pool.group);
    }

    const size = nestWorldPerTile(dims, nestGrid) * BROOD_SIZE_RATIO;
    const spreadUnit = size * 0.55;

    function update(state: ColonyState): void {
        const groups = new Map<string, Brood[]>();
        for (const entry of state.brood) {
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

        const entriesByStage: Record<string, Map<string, DecalPlacement>> = {
            EGG: new Map(),
            LARVA: new Map(),
            PUPA: new Map(),
        };

        for (const group of groups.values()) {
            const local = nestTileToLocal(group[0].position.x, group[0].position.y, nestGrid, dims);

            group.forEach((entry, i) => {
                const angle = i * 2.399963;
                const spread = i === 0 ? 0 : spreadUnit + Math.sqrt(i) * spreadUnit * 1.4;
                const offsetX = Math.cos(angle) * spread;
                const offsetY = Math.sin(angle) * spread;

                const byStage = entriesByStage[entry.stage] ?? entriesByStage.EGG;
                byStage.set(entry.id, {
                    x: local.x + offsetX,
                    y: local.y + offsetY,
                    z: local.z + NEST_FACE_OFFSET,
                    rotation: { x: 0, y: 0, z: 0 },
                    size,
                });
            });
        }

        for (const stage of Object.keys(pools)) {
            pools[stage].sync(entriesByStage[stage] ?? new Map());
        }
    }

    return { group, update };
}
