// PHASE 12e (follow-up): weather-fx.ts's rain/snow/wind/heat-shimmer used to
// paint into the surface canvas texture — visible only on the cube's top
// face, and foreshortened/rotated with it as the visitor orbits, which read
// as "weather happening to one face of a box" rather than "weather in the
// sky above the whole scene." This mounts a second 2D canvas directly over
// the WebGL renderer's own canvas (screen space, not cube-local), so the
// same renderWeather() draws rain/snow/etc. across the whole view
// regardless of camera angle or zoom.
import { renderWeather } from "./weather-fx";
import type { EnvState } from "../../sim/state";

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-weather-overlay {
            position: absolute;
            inset: 0;
            z-index: 1000;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

export type WeatherOverlay = {
    resize: (width: number, height: number) => void;
    update: (env: EnvState, frameTime: number) => void;
};

// `container` is the same element render/engine.ts appends its WebGL
// canvas to (`position: relative`, set by ui/view-switch.ts) — this canvas
// sits absolutely inset over it, sized in lockstep by whoever calls
// resize() (engine.ts's own resize(), alongside renderer.setSize()).
export function mountWeatherOverlay(container: HTMLElement): WeatherOverlay {
    injectStyles();

    const canvas = document.createElement("canvas");
    canvas.className = "ant-farm-weather-overlay";
    container.appendChild(canvas);

    const ctxOrNull = canvas.getContext("2d");
    if (ctxOrNull === null) {
        throw new Error("Could not get 2D canvas context for the weather overlay");
    }
    const ctx: CanvasRenderingContext2D = ctxOrNull;

    return {
        resize: (width: number, height: number) => {
            canvas.width = width;
            canvas.height = height;
        },
        update: (env: EnvState, frameTime: number) => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            renderWeather(ctx, env, canvas.width, canvas.height, frameTime);
        },
    };
}
