// Ants and the queen as real 3D objects on the cube — the same
// "canvas-drawn art on a PlaneGeometry, anchored in cube-local space"
// technique render/props.ts uses for trees and rocks, instead of the old
// flat paint-into-the-texture approach (see ants.ts's header). Unlike
// trees/rocks (static, placed once), ants move every tick, so this module
// keeps a live Map<AntId, entry> and repositions + re-rotates each one
// every frame from the current interpolated render position
// (state/interpolate.ts), adding a mesh the first frame an ant appears and
// removing it the frame it's no longer present (death).
//
// Surface ants stand upright, same as trees — a flat cutout card rotated
// around the cube's vertical (local Y) axis to face its heading. Nest ants
// lie flat against the nest's cross-section face instead (it's already a
// top-down diagram, not a 3D space to stand up in) and rotate in-plane
// around the face's own normal (local Z). Both use rotation angle
// -headingRad: derived from cube-layout.ts's tile->local mapping (nest
// tile-row increases downward, which maps to *decreasing* local y), not
// just picked by feel — double-check visually if either grid's local-axis
// convention ever changes.
//
// A surface ant is grounded by its sprite's measured content bottom
// (sprite-metrics.ts), not the plane geometry's own bottom edge — the ant
// texture (ants.ts's buildAntSprite) is drawn roughly vertically centered
// with transparent margin above and below, not with its legs flush against
// the canvas edge, so positioning by the plane's geometric bottom left it
// floating about a fifth of its own height above the ground.
//
// Deliberately NOT a billboard.ts cross like the tree/rock props. Trees are
// roughly radially symmetric, so two crossed copies still read as one
// canopy; the ant sprite is a directional silhouette (head one end, gaster
// the other), and two crossed copies of it just look like a broken
// double-exposure, not a fuller ant. A single plane per ant is the right
// call here, at least until real volumetric/sprite-sheet art exists.
//
// The carry-state dot (egg/food/corpse — same meaning as the old 2D
// version) is a small always-camera-facing THREE.Sprite — a UI-ish
// indicator, not scenery, so billboarding it is the right call even though
// the ant body itself deliberately isn't camera-facing (see props.ts's
// header on that choice). It's a SIBLING of the ant mesh (both direct
// children of `group`), not a child of it, and update() sets its position
// directly every frame instead of letting it inherit the mesh's transform.
// A child position offset only stays "above" the ant if the mesh's own
// rotation axis leaves that offset invariant — true for surface ants
// (rotation around Y, an offset along Y is unaffected) but not nest ants
// (rotation around Z, where a Y offset gets swept sideways as heading
// changes). Tracking its own world position sidesteps that entirely rather
// than only fixing it for one of the two faces.
import * as THREE from "three";
import type { ColonyState } from "../../sim/state";
import type { AntId, Ant } from "../../sim/ants/ant";
import type { Grid } from "../../sim/world/grid";
import type { RenderAnt } from "../state/interpolate";
import { surfaceTileToLocal, nestTileToLocal, surfaceWorldPerTile, nestWorldPerTile, type CubeDims } from "./cube-layout";
import { WORKER_SPRITE, QUEEN_SPRITE, SPRITE_ASPECT, WORKER_WIDTH_RATIO, QUEEN_WIDTH_RATIO } from "./ants";
import { measureContentBottomFraction } from "./sprite-metrics";

const EGG_CARRY_DOT_COLOR = 0xfbf1d0;
const FOOD_CARRY_DOT_COLOR = 0x5c8a3a;
const CORPSE_CARRY_DOT_COLOR = 0x8a8478;
// In the same unit space as the ant's own PlaneGeometry (width 1) — the
// ant mesh's own scale carries this to the right on-screen size, so this
// stays a fixed ratio regardless of caste.
const CARRY_DOT_UNIT_RADIUS = 0.12;

// Nudges nest ants slightly off the nest's cross-section face so they
// don't z-fight the nest CanvasTexture plane they're standing in front of.
const NEST_FACE_OFFSET = 0.02;

function buildCarryDotTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for carry-dot texture");
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

type AntEntry = {
    mesh: THREE.Mesh;
    carryDot: THREE.Sprite;
    isQueen: boolean;
};

export type AntProps = {
    group: THREE.Group;
    update: (state: ColonyState, renderAnts: ReadonlyMap<AntId, RenderAnt>) => void;
};

export function buildAntProps(surfaceGrid: Grid, nestGrid: Grid, dims: CubeDims): AntProps {
    const group = new THREE.Group();

    const workerTexture = new THREE.CanvasTexture(WORKER_SPRITE);
    workerTexture.colorSpace = THREE.SRGBColorSpace;
    const queenTexture = new THREE.CanvasTexture(QUEEN_SPRITE);
    queenTexture.colorSpace = THREE.SRGBColorSpace;

    const workerGroundFraction = measureContentBottomFraction(WORKER_SPRITE);
    const queenGroundFraction = measureContentBottomFraction(QUEEN_SPRITE);

    const workerMaterial = new THREE.MeshLambertMaterial({
        map: workerTexture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });
    const queenMaterial = new THREE.MeshLambertMaterial({
        map: queenTexture,
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
    });

    // Unit geometry (width 1, height SPRITE_ASPECT) — each entry's own
    // mesh.scale carries it to the right world size per caste/face, rather
    // than building a separate geometry per size.
    const unitGeometry = new THREE.PlaneGeometry(1, SPRITE_ASPECT);
    const carryDotTexture = buildCarryDotTexture();

    const surfaceWorldPerTileX = surfaceWorldPerTile(dims, surfaceGrid);
    const nestWorldPerTileX = nestWorldPerTile(dims, nestGrid);

    const entries = new Map<AntId, AntEntry>();

    function createEntry(isQueen: boolean): AntEntry {
        const mesh = new THREE.Mesh(unitGeometry, isQueen ? queenMaterial : workerMaterial);

        const carryDot = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: carryDotTexture, transparent: true, depthTest: false })
        );
        carryDot.visible = false;

        group.add(mesh, carryDot);
        return { mesh, carryDot, isQueen };
    }

    function setCarryState(entry: AntEntry, ant: Ant, carryingCorpse: boolean): void {
        // Independent checks, not if/else — a forager never carries eggs and
        // a nurse never carries food (ant.ts's carrying/carryingFood
        // comment), and an undertaker never carries either
        // (corpses.ts's assignUndertakers candidate filter excludes anyone
        // already carrying), so in practice at most one of these three ever
        // fires — but nothing here assumes that; last one wins, same as the
        // old 2D version drawing them in this same order.
        let color: number | undefined;
        if (ant.carrying.length > 0) {
            color = EGG_CARRY_DOT_COLOR;
        }
        if (ant.carryingFood > 0) {
            color = FOOD_CARRY_DOT_COLOR;
        }
        if (carryingCorpse) {
            color = CORPSE_CARRY_DOT_COLOR;
        }

        if (color === undefined) {
            entry.carryDot.visible = false;
            return;
        }
        entry.carryDot.visible = true;
        (entry.carryDot.material as THREE.SpriteMaterial).color.setHex(color);
    }

    function update(state: ColonyState, renderAnts: ReadonlyMap<AntId, RenderAnt>): void {
        const seen = new Set<AntId>();
        const corpseCarriers = new Set<AntId>(
            state.corpses.filter((c) => c.carriedBy !== undefined).map((c) => c.carriedBy as AntId)
        );

        for (const [id, renderAnt] of renderAnts) {
            const ant = state.ants.get(id);
            if (!ant) {
                continue;
            }
            seen.add(id);

            let entry = entries.get(id);
            if (!entry) {
                entry = createEntry(ant.caste === "QUEEN");
                entries.set(id, entry);
            }

            const widthRatio = entry.isQueen ? QUEEN_WIDTH_RATIO : WORKER_WIDTH_RATIO;
            const groundFraction = entry.isQueen ? queenGroundFraction : workerGroundFraction;
            let topY: number;
            let dotX: number;
            let dotZ: number;
            let widthWorld: number;

            if (renderAnt.where === "surface") {
                const local = surfaceTileToLocal(renderAnt.x, renderAnt.y, surfaceGrid, dims);
                widthWorld = surfaceWorldPerTileX * widthRatio;
                const heightWorld = widthWorld * SPRITE_ASPECT;
                const centerY = local.y + heightWorld * (groundFraction - 0.5);
                entry.mesh.scale.set(widthWorld, widthWorld, 1);
                entry.mesh.position.set(local.x, centerY, local.z);
                entry.mesh.rotation.set(0, -renderAnt.headingRad, 0);
                topY = centerY + heightWorld / 2;
                dotX = local.x;
                dotZ = local.z;
            } else {
                const local = nestTileToLocal(renderAnt.x, renderAnt.y, nestGrid, dims);
                widthWorld = nestWorldPerTileX * widthRatio;
                const heightWorld = widthWorld * SPRITE_ASPECT;
                // Nest ants are centered on their tile (no groundFraction
                // adjustment — see this file's header on why that doesn't
                // apply here), which is fine everywhere except row 0: a
                // sprite taller than one tile, centered exactly on the
                // seam, pokes its top half up past dims.height/2 and out
                // of the nest face entirely — most visible right at the
                // end of the EXIT shaft, where an ant sits centered on the
                // very top row just before it crosses to the surface.
                // Clamping keeps its top edge at or below the seam.
                const centerY = Math.min(local.y, dims.height / 2 - heightWorld / 2);
                entry.mesh.scale.set(widthWorld, widthWorld, 1);
                entry.mesh.position.set(local.x, centerY, local.z + NEST_FACE_OFFSET);
                entry.mesh.rotation.set(0, 0, -renderAnt.headingRad);
                topY = centerY + heightWorld / 2;
                dotX = local.x;
                dotZ = local.z + NEST_FACE_OFFSET;
            }

            // Set directly in world/cube-local space, not inherited from
            // the mesh's own transform — see this file's header on why.
            const dotGap = widthWorld * CARRY_DOT_UNIT_RADIUS;
            const dotSize = widthWorld * CARRY_DOT_UNIT_RADIUS * 2;
            entry.carryDot.scale.set(dotSize, dotSize, 1);
            entry.carryDot.position.set(dotX, topY + dotGap, dotZ);

            setCarryState(entry, ant, corpseCarriers.has(id));
        }

        for (const [id, entry] of entries) {
            if (!seen.has(id)) {
                group.remove(entry.mesh, entry.carryDot);
                entries.delete(id);
            }
        }
    }

    return { group, update };
}
