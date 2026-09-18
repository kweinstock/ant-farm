// This file only draws — it never calls step() or otherwise changes state.
//
// PHASE 12a: nest+surface are no longer two flat <canvas> elements side by
// side — they're two faces of a single 3D cube (three.js + OrbitControls)
// the visitor can orbit. Bare terrain (tile colors, the dig frontier, the
// graveyard/hole/predator — nest-view.ts/surface-view.ts) is still drawn
// onto a 2D canvas exactly as Phase 3b-5 built it; the only difference is
// that canvas is now a source texture for one cube face (a CanvasTexture,
// re-uploaded every frame) instead of the thing the browser shows directly.
// That's deliberately the cheapest bridge from the old flat renderer to a
// real 3D scene for terrain — Phase 12c's real terrain art replaces these
// plain tile-color textures without touching any of this file's
// cube/camera plumbing.
//
// PHASE 12e: day/night and season used to be 2D washes painted onto these
// same two canvases (daynight.ts/season-fx.ts, both now deleted) — which
// only ever tinted the terrain texture, doing nothing for every ant, tree,
// corpse, or food pile drawn as a real 3D object instead. Both moved to
// ambient-light.ts, a single THREE.AmbientLight whose color/intensity are
// computed from state.env every frame below, so the whole scene responds
// instead of just the two textures. Weather's rain/snow/wind/heat-shimmer
// particles moved off these canvases too, onto their own full-viewport
// overlay (weather-overlay.ts) rather than one cube face. ui/control-panel.ts
// mirrors the same env data as a small always-visible readout, so a visitor
// isn't left inferring "why does the cube look dim" from lighting alone —
// that panel is mounted/updated by main.ts, not this file (see below).
//
// Everything that used to be painted as a small icon into that same
// texture — ants, corpses, brood, food piles, the FOOD_STORAGE gauge — is a
// real 3D decal now instead (ant-props.ts, corpse-props.ts, brood-props.ts,
// food-props.ts), each its own textured mesh rather than a few pixels
// shared with the terrain canvas. That switch is what fixed those icons
// blurring and visibly bleeding into a neighboring tile's color once the
// visitor zoomed in on the shared low-resolution canvas — see
// decal-pool.ts's header.
//
// PHASE 12b: also threads render-time ant interpolation through —
// state/interpolate.ts computes each ant's eased position + facing every
// rAF frame (not every sim tick) from the state before the latest tick,
// the state after it, and how far into the wall-clock gap until the next
// tick we are (FrameSource below). lastHeadings is render-only scratch
// (never part of ColonyState, never replayed) carrying each ant's most
// recent facing across frames so an idle ant doesn't snap back to a
// default heading between moves. antProps.update() (ant-props.ts) consumes
// this same per-frame interpolated map to place the real ant meshes.
//
// PHASE 12d (partial): click-to-focus on an ant. A click raycasts against
// the cube only (not its tree/rock children — see the props import below),
// maps the hit point back to a tile via cube-layout.ts, and picks the
// nearest interpolated ant on whichever face was hit. Picking one tweens
// the camera in close and hides render/props.ts's surface props — "a way to
// make them invisible as you zoom into ants." "Reset view" (and clicking
// the cube again with no ant nearby) tweens back out and brings them back.
// Camera framing here doesn't continue tracking the ant after the tween
// settles — a fixed close-up, not a live follow-cam; that's a reasonable
// next refinement, not required for this pass.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ColonyState } from "../../sim/state";
import type { AntId } from "../../sim/ants/ant";
import { CELL_SIZE, SURFACE_CELL_SIZE, TICK_INTERVALS_MS } from "../config";
import { renderNestView } from "./nest-view";
import { renderSurfaceView } from "./surface-view";
import { mountWeatherOverlay } from "./weather-overlay";
import { computeAmbientLight } from "./ambient-light";
import { interpolateAnts, type RenderAnt } from "../state/interpolate";
import type { RenderOptions } from "../ui/control-panel";
import { buildSurfaceProps } from "./props";
import { buildAntProps } from "./ant-props";
import { buildCorpseProps } from "./corpse-props";
import { buildBroodProps } from "./brood-props";
import { buildFoodPileProps, buildFoodStorageProps } from "./food-props";
import { buildSoilFaceTexture } from "./nest-view";
import { buildSkyCanvas, renderSky } from "./sky";
import { surfaceTileToLocal, nestTileToLocal, localToSurfaceTile, localToNestTile, type CubeDims } from "./cube-layout";

// World-units-per-tile for sizing the cube geometry — arbitrary, just small
// enough that a ~100x72 surface grid produces a scene-sized box rather than
// a room-sized one.
const WORLD_SCALE = 0.12;

// How many tiles of solid dirt sit above nest row 0 (the EXIT shaft's
// mouth) before the seam — otherwise the shaft opened flush against the
// surface, reading as the tunnel touching open air instead of a hole dug
// down from it. 1.5 tiles happens to be a whole number of CELL_SIZE px
// (21px), which keeps nestCanvas's height an integer.
const NEST_TOP_MARGIN_TILES = 1.5;

// How close (in tile units) a click has to land to an ant to pick it,
// rather than being treated as a click on empty ground.
const PICK_RADIUS_TILES = 3.5;
// A pointerdown->pointerup pair further apart than this (css px) is an
// orbit drag, not a click — OrbitControls' own drag handling already
// consumed it, this just stops it from also triggering a pick.
const CLICK_DRAG_THRESHOLD_PX = 4;
const FOCUS_TWEEN_MS = 550;
const FOCUS_DISTANCE = 1.6;

export type FrameSource = {
    getPrev: () => ColonyState | undefined;
    getCurr: () => ColonyState;
    // performance.now() timestamp at which getCurr()'s tick became current —
    // the render loop measures elapsed wall time from this to know how far
    // into the gap until the next tick "now" is.
    getTickStartTime: () => number;
};

export type SceneHandle = {
    resetCamera: () => void;
};

type FocusTween = {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
};

export function startRenderLoop(
    container: HTMLElement,
    frame: FrameSource,
    renderOptions: RenderOptions,
): SceneHandle {
    const scene = new THREE.Scene();
    // Redrawn every frame from state.env (see sky.ts's header) — an empty
    // canvas here, painted for the first time once `initial` exists below.
    const skyCanvas = buildSkyCanvas();
    const skyCtxOrNull = skyCanvas.getContext("2d");
    if (skyCtxOrNull === null) {
        throw new Error("Could not get 2D canvas context for the sky");
    }
    const skyCtx: CanvasRenderingContext2D = skyCtxOrNull;
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTexture;

    // The one light in the scene — see ambient-light.ts's header for why
    // ambient-only (no directional/shadow light) is enough here, and why
    // every material in render/ is MeshLambertMaterial now instead of
    // MeshBasicMaterial (which ignores lights entirely). Color/intensity
    // get driven by state.env every frame, below.
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const initialCameraPos = new THREE.Vector3(9, 7, 11);
    camera.position.copy(initialCameraPos);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    container.appendChild(renderer.domElement);
    const weatherOverlay = mountWeatherOverlay(container);

    const initial = frame.getCurr();
    const nestGrid = initial.grid;
    const surfaceGrid = initial.surface.grid;
    renderSky(skyCtx, initial.env);
    skyTexture.needsUpdate = true;

    const dims: CubeDims = {
        width: surfaceGrid.width * WORLD_SCALE,
        depth: surfaceGrid.height * WORLD_SCALE,
        height: (nestGrid.height + NEST_TOP_MARGIN_TILES) * WORLD_SCALE,
        tileWorldSize: WORLD_SCALE,
        nestTopMarginTiles: NEST_TOP_MARGIN_TILES,
    };

    const initialTarget = new THREE.Vector3(0, -dims.height / 2, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1;
    controls.maxDistance = 40;
    controls.update();

    // Offscreen 2D canvases — never inserted into the DOM, just painted with
    // the same draw calls the old flat canvases used and read back as a
    // CanvasTexture every frame.
    //
    // nestCanvas is padded out to surfaceGrid.width * CELL_SIZE (not just
    // nestGrid.width * CELL_SIZE) so that, once stretched across the whole
    // front face the same way surfaceCanvas is stretched across the top
    // face, one nest-grid tile ends up the same on-screen size as one
    // surface-grid tile — see cube-layout.ts's nestTileToLocal comment.
    // nestMarginPx is the soil-textured gutter on each side of the actual
    // nest drawing that padding creates; nest-view.ts fills it with the
    // same soil texture as the cube's unpainted faces and offsets the grid
    // drawing into the middle of it.
    const nestMarginPx = ((surfaceGrid.width - nestGrid.width) * CELL_SIZE) / 2;
    // Same idea vertically — a strip of solid dirt above row 0 for the EXIT
    // shaft to open into, instead of butting straight up against the seam.
    // See NEST_TOP_MARGIN_TILES and cube-layout.ts's nestTopMarginTiles.
    const nestTopMarginPx = NEST_TOP_MARGIN_TILES * CELL_SIZE;
    const nestCanvas = document.createElement("canvas");
    nestCanvas.width = surfaceGrid.width * CELL_SIZE;
    nestCanvas.height = nestGrid.height * CELL_SIZE + nestTopMarginPx;
    const nestCtxOrNull = nestCanvas.getContext("2d");

    const surfaceCanvas = document.createElement("canvas");
    surfaceCanvas.width = surfaceGrid.width * SURFACE_CELL_SIZE;
    surfaceCanvas.height = surfaceGrid.height * SURFACE_CELL_SIZE;
    const surfaceCtxOrNull = surfaceCanvas.getContext("2d");

    if (nestCtxOrNull === null || surfaceCtxOrNull === null) {
        throw new Error("Could not get 2D canvas context for one or both ant-farm views");
    }

    // Re-bound to non-null-typed consts — TS's control-flow narrowing above
    // doesn't survive into render(), which is declared (and only called)
    // after this point but captures these by closure.
    const nestCtx: CanvasRenderingContext2D = nestCtxOrNull;
    const surfaceCtx: CanvasRenderingContext2D = surfaceCtxOrNull;

    const nestTexture = new THREE.CanvasTexture(nestCanvas);
    const surfaceTexture = new THREE.CanvasTexture(surfaceCanvas);
    nestTexture.colorSpace = THREE.SRGBColorSpace;
    surfaceTexture.colorSpace = THREE.SRGBColorSpace;

    // The four unpainted faces (no grid of their own to paint tiles onto)
    // share nest-view.ts's own soil fleck texture — same source canvas as
    // undug SOIL tiles — instead of a flat color, so they read as "more of
    // the same dirt block" rather than a different material. Each face
    // gets its own cloned texture with its own repeat count rather than
    // one shared material: the three unpainted face-pairs are different
    // world sizes (side, bottom, back), and repeating the same small tile
    // more times across a bigger face (rather than stretching one copy of
    // it to fill that face) is what keeps the flecks the same physical
    // size everywhere instead of blowing up huge on the bigger faces.
    const soilFaceCanvas = buildSoilFaceTexture();
    const soilFaceTexture = new THREE.CanvasTexture(soilFaceCanvas);
    soilFaceTexture.colorSpace = THREE.SRGBColorSpace;
    soilFaceTexture.wrapS = THREE.RepeatWrapping;
    soilFaceTexture.wrapT = THREE.RepeatWrapping;
    // How many world units one soilFaceCanvas tile covers, derived the same
    // way the nest canvas's own px-to-world mapping is (CELL_SIZE px per
    // tile, WORLD_SCALE world units per tile) — keeps this face's fleck
    // density identical to the nest cross-section's, not just similar.
    const soilFaceWorldSize = soilFaceCanvas.width * (WORLD_SCALE / CELL_SIZE);

    function buildSoilMaterial(faceWorldWidth: number, faceWorldHeight: number): THREE.MeshLambertMaterial {
        const map = soilFaceTexture.clone();
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(faceWorldWidth / soilFaceWorldSize, faceWorldHeight / soilFaceWorldSize);
        return new THREE.MeshLambertMaterial({ map });
    }

    const sideMaterial = buildSoilMaterial(dims.depth, dims.height); // +x, -x
    const bottomMaterial = buildSoilMaterial(dims.width, dims.depth); // -y
    const backMaterial = buildSoilMaterial(dims.width, dims.height); // -z
    const surfaceMaterial = new THREE.MeshLambertMaterial({ map: surfaceTexture });
    const nestMaterial = new THREE.MeshLambertMaterial({ map: nestTexture });

    // BoxGeometry's default face-group order is [+x, -x, +y, -y, +z, -z]
    // (material indices 0-5). Top face (+y, index 2) = surface (top-down,
    // "surface on top"); front face (+z, index 4) = nest cross-section,
    // sharing its top edge with the surface face's front edge — the same
    // seam nest-view.ts's SURFACE_LINE_COLOR marks in the old flat
    // renderer. Flush on the cube's own front face, not a separately
    // recessed plane — see cube-layout.ts's nestTileToLocal comment for
    // why (two earlier attempts at real recessed depth here didn't read
    // right; nest-view.ts's renderIndentShading fakes the carved-in look
    // with 2D shading instead).
    const materials = [
        sideMaterial,
        sideMaterial,
        surfaceMaterial,
        bottomMaterial,
        nestMaterial,
        backMaterial,
    ];

    const geometry = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
    const cube = new THREE.Mesh(geometry, materials);
    cube.position.y = -dims.height / 2; // top face sits at y=0, nest hangs below it
    scene.add(cube);

    const surfaceProps = buildSurfaceProps(surfaceGrid, dims, initial.surface.holePos, initial.env.season);
    cube.add(surfaceProps.group);

    const antProps = buildAntProps(surfaceGrid, nestGrid, dims);
    cube.add(antProps.group);

    const corpseProps = buildCorpseProps(surfaceGrid, nestGrid, dims);
    cube.add(corpseProps.group);

    const broodProps = buildBroodProps(nestGrid, dims);
    cube.add(broodProps.group);

    const foodPileProps = buildFoodPileProps(surfaceGrid, dims);
    cube.add(foodPileProps.group);

    const foodStorageProps = buildFoodStorageProps(nestGrid, dims);
    cube.add(foodStorageProps.group);

    function resize(): void {
        // `container` (.ant-farm-scene) fills the viewport now — see
        // ui/view-switch.ts and index.html — so its own box is the whole
        // budget, no more window.innerHeight math to leave room for a
        // controls row below it.
        const rect = container.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        weatherOverlay.resize(w, h);
    }

    resize();
    window.addEventListener("resize", resize);

    const lastHeadings = new Map<AntId, number>();
    let latestRenderAnts: ReadonlyMap<AntId, RenderAnt> = new Map();

    let focused = false;
    let focusTween: FocusTween | undefined;

    function startTween(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
        focusTween = {
            fromPos: camera.position.clone(),
            toPos: toPos.clone(),
            fromTarget: controls.target.clone(),
            toTarget: toTarget.clone(),
            start: performance.now(),
            duration: FOCUS_TWEEN_MS,
        };
    }

    function enterFocus(antId: AntId, face: "surface" | "nest"): void {
        const renderAnt = latestRenderAnts.get(antId);
        if (!renderAnt) {
            return;
        }

        const local =
            face === "surface"
                ? surfaceTileToLocal(renderAnt.x, renderAnt.y, surfaceGrid, dims)
                : nestTileToLocal(renderAnt.x, renderAnt.y, nestGrid, dims);
        const targetWorld = cube.localToWorld(new THREE.Vector3(local.x, local.y, local.z));

        // Surface ants stand upright — a shallow elevation here keeps the
        // view close to the ant's own eye level, so the standing card
        // actually reads, instead of looking almost straight down at it
        // and foreshortening it into a sliver.
        const viewDir =
            face === "surface"
                ? new THREE.Vector3(0.6, 0.35, 0.6).normalize()
                : new THREE.Vector3(0.3, 0.2, 1).normalize();
        const posWorld = targetWorld.clone().addScaledVector(viewDir, FOCUS_DISTANCE);

        startTween(posWorld, targetWorld);
        focused = true;
        surfaceProps.setVisible(false);
    }

    function exitFocus(): void {
        if (!focused) {
            return;
        }
        focused = false;
        startTween(initialCameraPos, initialTarget);
        surfaceProps.setVisible(true);
    }

    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    let pointerDownAt: { x: number; y: number } | undefined;

    function pick(clientX: number, clientY: number): void {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObject(cube, false);
        if (hits.length === 0) {
            return;
        }

        const hit = hits[0];
        const localPoint = cube.worldToLocal(hit.point.clone());

        let face: "surface" | "nest" | undefined;
        let tile: { x: number; y: number } | undefined;

        if (hit.face?.materialIndex === 2) {
            face = "surface";
            tile = localToSurfaceTile(localPoint, surfaceGrid, dims);
        } else if (hit.face?.materialIndex === 4) {
            face = "nest";
            tile = localToNestTile(localPoint, nestGrid, dims);
        }

        if (face === undefined || tile === undefined) {
            exitFocus();
            return;
        }

        let nearestId: AntId | undefined;
        let nearestDist = PICK_RADIUS_TILES;
        for (const [id, renderAnt] of latestRenderAnts) {
            if (renderAnt.where !== face) {
                continue;
            }
            const dist = Math.hypot(renderAnt.x - tile.x, renderAnt.y - tile.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestId = id;
            }
        }

        if (nearestId === undefined) {
            exitFocus();
            return;
        }

        enterFocus(nearestId, face);
    }

    renderer.domElement.addEventListener("pointerdown", (event) => {
        pointerDownAt = { x: event.clientX, y: event.clientY };
    });
    renderer.domElement.addEventListener("pointerup", (event) => {
        if (!pointerDownAt) {
            return;
        }
        const dx = event.clientX - pointerDownAt.x;
        const dy = event.clientY - pointerDownAt.y;
        pointerDownAt = undefined;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
            return; // an orbit drag, not a click
        }
        pick(event.clientX, event.clientY);
    });

    function render(frameTime: number): void {
        const prev = frame.getPrev();
        const curr = frame.getCurr();
        const t = (performance.now() - frame.getTickStartTime()) / TICK_INTERVALS_MS;
        const renderAnts = interpolateAnts(prev, curr, t, lastHeadings);
        for (const [id, renderAnt] of renderAnts) {
            lastHeadings.set(id, renderAnt.headingRad);
        }
        latestRenderAnts = renderAnts;
        antProps.update(curr, renderAnts);
        corpseProps.update(curr);
        broodProps.update(curr);
        foodPileProps.update(curr);
        foodStorageProps.update(curr);

        nestCtx.clearRect(0, 0, nestCanvas.width, nestCanvas.height);
        surfaceCtx.clearRect(0, 0, surfaceCanvas.width, surfaceCanvas.height);

        renderNestView(nestCtx, curr, nestCanvas.width, nestMarginPx, nestTopMarginPx, renderOptions);
        renderSurfaceView(surfaceCtx, curr, renderOptions);
        // Day/night used to be an overlay painted here too, but that only
        // ever affected these two textures — see ambient-light.ts's header
        // for why that moved to a real light (and sky.ts's for the sky).
        // Season now lives inside renderSurfaceView's own ground/grass fill
        // (season-palette.ts) rather than a separate pass on top of it.
        // Weather's rain/snow/wind/heat-shimmer moved off this texture too
        // — see weather-overlay.ts's header — so it reads as weather in the
        // whole view instead of something painted onto one cube face.

        nestTexture.needsUpdate = true;
        surfaceTexture.needsUpdate = true;

        renderSky(skyCtx, curr.env);
        skyTexture.needsUpdate = true;
        weatherOverlay.update(curr.env, frameTime);

        const light = computeAmbientLight(curr.env);
        ambientLight.color.setRGB(light.color.r / 255, light.color.g / 255, light.color.b / 255);
        ambientLight.intensity = light.intensity;
        surfaceProps.updateSeason(curr.env.season);

        if (focusTween) {
            const elapsed = performance.now() - focusTween.start;
            const alpha = Math.min(1, elapsed / focusTween.duration);
            const eased = alpha * (2 - alpha); // ease-out
            camera.position.lerpVectors(focusTween.fromPos, focusTween.toPos, eased);
            controls.target.lerpVectors(focusTween.fromTarget, focusTween.toTarget, eased);
            if (alpha >= 1) {
                focusTween = undefined;
            }
        }

        controls.update();
        renderer.render(scene, camera);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);

    return {
        resetCamera: () => {
            focusTween = undefined;
            focused = false;
            surfaceProps.setVisible(true);
            camera.position.copy(initialCameraPos);
            controls.target.copy(initialTarget);
            controls.update();
        },
    };
}
