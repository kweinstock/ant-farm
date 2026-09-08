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
//
// PHASE 5: after renderSurfaceView, chain seasonFx -> weatherFx -> dayNight
// on the surface canvas, in that order — season wash sits on the ground
// itself, weather sits above the ground+piles+ants, day/night grades the
// whole scene on top of everything. Nest gets an optional faint day/night
// pass only (NEST_DAYNIGHT_INTENSITY); no season/weather effects
// underground — those are surface-only phenomena. frameTime comes straight
// from requestAnimationFrame's own timestamp param, so no extra
// Date.now()/performance.now() call is needed; it's render-only and never
// touches sim state (see weather-fx.ts's header).
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE, SURFACE_CELL_SIZE } from "../config";
import { renderNestView } from "./nest-view";
import { renderSurfaceView } from "./surface-view";
import { renderSeasonFx } from "./season-fx";
import { renderWeather } from "./weather-fx";
import { applyDayNight } from "./daynight";
import type { RenderOptions } from "../ui/view-switch";

const NEST_DAYNIGHT_INTENSITY = 0.35;

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

    function render(frameTime: number): void {
        const state = getState();

        const nestWidth = state.grid.width * CELL_SIZE;
        const nestHeight = state.grid.height * CELL_SIZE;
        const surfaceWidth = state.surface.grid.width * SURFACE_CELL_SIZE;
        const surfaceHeight = state.surface.grid.height * SURFACE_CELL_SIZE;

        nestCanvas.width = nestWidth;
        nestCanvas.height = nestHeight;
        surfaceCanvas.width = surfaceWidth;
        surfaceCanvas.height = surfaceHeight;

        nestCtx.clearRect(0, 0, nestWidth, nestHeight);
        surfaceCtx.clearRect(0, 0, surfaceWidth, surfaceHeight);

        renderNestView(nestCtx, state);
        applyDayNight(nestCtx, state.env, nestWidth, nestHeight, NEST_DAYNIGHT_INTENSITY);

        renderSurfaceView(surfaceCtx, state, renderOptions);
        renderSeasonFx(surfaceCtx, state.env, surfaceWidth, surfaceHeight);
        renderWeather(surfaceCtx, state.env, surfaceWidth, surfaceHeight, frameTime);
        applyDayNight(surfaceCtx, state.env, surfaceWidth, surfaceHeight);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}