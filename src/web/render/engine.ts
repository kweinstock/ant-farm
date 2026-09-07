// This file only draws — it never calls step() or otherwise changes state.
// PHASE 3b: two canvases, one rAF loop drives both. nest-view.ts and
// surface-view.ts are independent draws against independent coordinate
// spaces (state.grid/state.nest vs state.surface) at independent cell sizes
// (config.ts's CELL_SIZE vs SURFACE_CELL_SIZE) — there's no shared
// coordinate math between them, they just share one animation-frame cadence.
//
// PHASE 4: also threads renderOptions (ui/view-switch.ts) through to
// renderSurfaceView every frame, not just once at loop start — the visitor
// can flip the Trails toggle at any time, and renderOptions.showTrails is a
// live getter (view-switch.ts's own comment) specifically so this loop
// picks up that change on its very next frame rather than needing a restart.
// Nest-side gets nothing here: the trail layer is surface-only this phase
// (decision 1), so renderNestView's signature is untouched.
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE, SURFACE_CELL_SIZE } from "../config";
import { renderNestView } from "./nest-view";
import { renderSurfaceView } from "./surface-view";
import type { RenderOptions } from "../ui/view-switch";

export function startRenderLoop(
    nestCanvas: HTMLCanvasElement,
    surfaceCanvas: HTMLCanvasElement,
    getState: () => ColonyState,
    renderOptions: RenderOptions,
): void {
    const nestContext = nestCanvas.getContext("2d");
    const surfaceContext = surfaceCanvas.getContext("2d");

    if (nestContext === null || surfaceContext === null) {
        throw new Error("Could not get 2D canvas context for one or both ant-farm views");
    }

    const nestCtx: CanvasRenderingContext2D = nestContext;
    const surfaceCtx: CanvasRenderingContext2D = surfaceContext;

    function render(): void {
        const state = getState();

        nestCanvas.width = state.grid.width * CELL_SIZE;
        nestCanvas.height = state.grid.height * CELL_SIZE;
        surfaceCanvas.width = state.surface.grid.width * SURFACE_CELL_SIZE;
        surfaceCanvas.height = state.surface.grid.height * SURFACE_CELL_SIZE;

        nestCtx.clearRect(0, 0, nestCanvas.width, nestCanvas.height);
        surfaceCtx.clearRect(0, 0, surfaceCanvas.width, surfaceCanvas.height);

        renderNestView(nestCtx, state);
        renderSurfaceView(surfaceCtx, state, renderOptions);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}