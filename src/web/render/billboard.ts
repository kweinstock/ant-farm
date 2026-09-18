// A "cross billboard": two copies of the same flat cutout, one rotated 90°
// around a vertical axis relative to the other, sharing one geometry and
// material. The classic trick (used all over stylized 3D games for
// trees/grass) for giving a single flat card some apparent volume as the
// visitor orbits around it — a lone plane goes edge-on-invisible from one
// specific angle, but with two crossed planes there's always at least one
// of them facing you close to head-on, no matter where the camera sits
// horizontally around it.
//
// Only meaningful for things standing upright on the cube's horizontal
// surface face (trees, rocks, surface ants — see render/props.ts and
// render/ant-props.ts) — rotating around the vertical axis is what lets the
// visitor "walk around" an object. It's not used for nest ants: those lie
// flat against the nest's own vertical cross-section face, where the
// visitor is meant to view that whole face near-straight-on (like a
// diagram), not orbit around any single sprite on it independently.
import * as THREE from "three";

export function buildCrossBillboard(geometry: THREE.PlaneGeometry, material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const front = new THREE.Mesh(geometry, material);
    const side = new THREE.Mesh(geometry, material);
    side.rotation.y = Math.PI / 2;
    group.add(front, side);
    return group;
}
