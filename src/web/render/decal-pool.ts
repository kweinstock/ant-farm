// A pool of flat decal meshes — corpses, brood, food piles, food-storage
// mounds — the same "canvas-drawn texture on a PlaneGeometry, positioned in
// cube-local space" technique render/props.ts and render/ant-props.ts use,
// but for things that lie flat against whichever face they're on (the
// ground or the nest wall) instead of standing upright. A corpse or a pile
// of food doesn't have the vertical presence a tree or a walking ant does,
// so it reads better as a decal than a standing card — and, just as
// important, a decal painted as a real textured mesh on the GPU stays crisp
// at any zoom, unlike the flat-canvas-paint approach these used before
// (render/nest-view.ts's old renderBrood/renderFoodGauge/renderCorpses,
// render/surface-view.ts's old food-pile loop), where a tiny icon sharing
// one low-resolution CanvasTexture with the whole terrain would blur and
// visibly bleed into a neighboring tile's color once the visitor zoomed in.
//
// Callers key entries by a stable id (corpse.id, brood.id, a synthesized
// "tile x,y" key for storage-gauge slots) — sync() adds a mesh the first
// frame an id appears and removes it the frame the id is gone, same
// add/remove lifecycle render/ant-props.ts uses for live ants.
import * as THREE from "three";

export type DecalPlacement = {
    x: number;
    y: number;
    z: number;
    rotation: { x: number; y: number; z: number };
    size: number; // world-space width; the mesh is scaled uniformly (x = y)
    opacity?: number; // defaults to 1
};

export type DecalPool = {
    group: THREE.Group;
    sync: (entries: ReadonlyMap<string, DecalPlacement>) => void;
};

// `baseMaterial` is cloned per mesh (not shared) so each decal can carry its
// own opacity — sharing one material instance would mean every decal in the
// pool fades together, since they'd all be reading/writing the same
// material.opacity.
export function buildDecalPool(baseMaterial: THREE.MeshLambertMaterial, geometry: THREE.PlaneGeometry): DecalPool {
    const group = new THREE.Group();
    const meshes = new Map<string, THREE.Mesh>();

    function sync(entries: ReadonlyMap<string, DecalPlacement>): void {
        for (const [id, placement] of entries) {
            let mesh = meshes.get(id);
            if (!mesh) {
                mesh = new THREE.Mesh(geometry, baseMaterial.clone());
                meshes.set(id, mesh);
                group.add(mesh);
            }

            mesh.position.set(placement.x, placement.y, placement.z);
            mesh.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z);
            mesh.scale.set(placement.size, placement.size, 1);
            (mesh.material as THREE.MeshLambertMaterial).opacity = placement.opacity ?? 1;
        }

        for (const [id, mesh] of meshes) {
            if (!entries.has(id)) {
                group.remove(mesh);
                meshes.delete(id);
            }
        }
    }

    return { group, sync };
}
