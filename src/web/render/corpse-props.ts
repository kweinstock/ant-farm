// Corpses as real 3D decals on the cube — see decal-pool.ts's header for
// why (crispness, and no more bleeding into a neighboring tile's texture).
// A corpse can be on either face over its lifetime (an ant can die on the
// surface or in the nest, and an undertaker can drag a body from one to the
// other... actually no — corpses.ts never moves a corpse between nest and
// surface, only within a face — but the code here still branches on
// location.where per corpse rather than assuming one face, matching what
// the old renderCorpses in each view file did).
//
// Surface corpses lie flat on the ground (rotated so the texture faces
// +Y — "up" — like a decal on the floor, not standing up the way live ants
// do; a dead ant doesn't have a live one's vertical presence). Nest
// corpses lie flat against the nest's vertical cross-section face, same as
// nest ants.
//
// Multiple corpses can land on one tile (corpses.ts's header — no
// occupancy mechanic), so this groups by tile and spreads them in the same
// small spiral the old 2D renderCorpses used, keyed by corpse.id for
// decal-pool's add/remove lifecycle.
import * as THREE from "three";
import type { ColonyState } from "../../sim/state";
import type { Corpse } from "../../sim/corpses";
import type { Grid } from "../../sim/world/grid";
import { surfaceTileToLocal, nestTileToLocal, surfaceWorldPerTile, nestWorldPerTile, type CubeDims } from "./cube-layout";
import { CORPSE_SPRITE, CORPSE_WIDTH_RATIO } from "./ants";
import { buildDecalPool, type DecalPlacement } from "./decal-pool";

const NEST_FACE_OFFSET = 0.02; // same convention as ant-props.ts
const SURFACE_GROUND_OFFSET = 0.002;

export type CorpseProps = {
    group: THREE.Group;
    update: (state: ColonyState) => void;
};

export function buildCorpseProps(surfaceGrid: Grid, nestGrid: Grid, dims: CubeDims): CorpseProps {
    const texture = new THREE.CanvasTexture(CORPSE_SPRITE);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const pool = buildDecalPool(material, geometry);

    const surfaceWorldPerTileX = surfaceWorldPerTile(dims, surfaceGrid);
    const nestWorldPerTileX = nestWorldPerTile(dims, nestGrid);

    function update(state: ColonyState): void {
        const groups = new Map<string, Corpse[]>();
        for (const corpse of state.corpses) {
            if (corpse.carriedBy !== undefined) {
                continue; // carried corpses ride the undertaker — ant-props.ts's carry-dot covers that
            }
            const key = `${corpse.location.where},${corpse.location.pos.x},${corpse.location.pos.y}`;
            const group = groups.get(key);
            if (group) {
                group.push(corpse);
            } else {
                groups.set(key, [corpse]);
            }
        }

        const entries = new Map<string, DecalPlacement>();

        for (const group of groups.values()) {
            const { where, pos } = group[0].location;
            const size = (where === "surface" ? surfaceWorldPerTileX : nestWorldPerTileX) * CORPSE_WIDTH_RATIO;
            const spreadUnit = size * 0.4;

            group.forEach((corpse, i) => {
                const angle = i * 2.399963;
                const spread = i === 0 ? 0 : spreadUnit + Math.sqrt(i) * spreadUnit * 0.8;
                const offsetX = Math.cos(angle) * spread;
                const offsetY = Math.sin(angle) * spread;

                if (where === "surface") {
                    const local = surfaceTileToLocal(pos.x, pos.y, surfaceGrid, dims);
                    entries.set(corpse.id, {
                        x: local.x + offsetX,
                        y: local.y + SURFACE_GROUND_OFFSET,
                        z: local.z + offsetY,
                        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
                        size,
                    });
                } else {
                    const local = nestTileToLocal(pos.x, pos.y, nestGrid, dims);
                    entries.set(corpse.id, {
                        x: local.x + offsetX,
                        y: local.y + offsetY,
                        z: local.z + NEST_FACE_OFFSET,
                        rotation: { x: 0, y: 0, z: 0 },
                        size,
                    });
                }
            });
        }

        pool.sync(entries);
    }

    return { group: pool.group, update };
}
