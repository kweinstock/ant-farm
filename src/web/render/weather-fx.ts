// Rain streaks, snow, heat shimmer, wind. Driven purely by env.weather in the
// snapshot — presentation only, never touches sim state. frameTime is
// render-side wall-clock (the rAF timestamp engine.ts already gets for free)
// used ONLY to animate particle phase.
//
// Particle positions come from a cheap deterministic hash of (index, salt),
// not the sim's seeded rng() — this is intentionally NOT part of the
// determinism contract (nothing here ever feeds back into ColonyState), it
// just needs to look stable frame-to-frame rather than jitter randomly.
import type { EnvState } from "../../sim/state";

// Beefed up across the board (more/bigger/more opaque particles) — the
// original counts/alphas were tuned back when this painted onto the
// surface-only cube face (weather-overlay.ts), where anything short of
// fully covering it read as "some specks on one tile." At full-viewport
// scale, that same density reads as "barely there."
const RAIN_STREAK_COUNT = 160;
const RAIN_LENGTH = 22;
const RAIN_SPEED = 1.5;

const SNOW_FLAKE_COUNT = 120;
const SNOW_FALL_SPEED = 0.08;
const SNOW_DRIFT_SPEED = 0.0015;

const WIND_STREAK_COUNT = 45;
const WIND_SPEED = 1.0;

const HEAT_BAND_COUNT = 7;

function hash(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

function renderRain(ctx: CanvasRenderingContext2D, w: number, h: number, frameTime: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(190, 210, 235, 0.75)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < RAIN_STREAK_COUNT; i++) {
        const x = hash(i, 1) * w;
        const fallOffset = (frameTime * RAIN_SPEED + hash(i, 2) * h * 4) % (h + RAIN_LENGTH);
        const y = fallOffset - RAIN_LENGTH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + RAIN_LENGTH);
        ctx.stroke();
    }
    ctx.restore();
}

function renderSnow(ctx: CanvasRenderingContext2D, w: number, h: number, frameTime: number): void {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    for (let i = 0; i < SNOW_FLAKE_COUNT; i++) {
        const baseX = hash(i, 3) * w;
        const drift = Math.sin(frameTime * SNOW_DRIFT_SPEED + i) * 10;
        const x = (baseX + drift + w) % w;
        const y = (frameTime * SNOW_FALL_SPEED + hash(i, 4) * h * 4) % h;
        const radius = 1.5 + hash(i, 5) * 2.2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function renderWind(ctx: CanvasRenderingContext2D, w: number, h: number, frameTime: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < WIND_STREAK_COUNT; i++) {
        const y = hash(i, 6) * h;
        const length = 30 + hash(i, 7) * 50;
        const x = ((frameTime * WIND_SPEED + hash(i, 8) * w * 3) % (w + length)) - length;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y);
        ctx.stroke();
    }
    ctx.restore();
}

// Canvas 2D has no cheap refraction, so this fakes shimmer with a few slow,
// wavy, near-transparent horizontal bands rather than distorting the pixels
// underneath.
function renderHeatShimmer(ctx: CanvasRenderingContext2D, w: number, h: number, frameTime: number): void {
    ctx.save();
    const bandHeight = h / HEAT_BAND_COUNT;
    for (let i = 0; i < HEAT_BAND_COUNT; i++) {
        const bandY = bandHeight * i;
        const wobble = Math.sin(frameTime * 0.002 + i) * 4;
        const alpha = Math.max(0, 0.08 + 0.05 * Math.sin(frameTime * 0.003 + i * 1.7));
        ctx.fillStyle = `rgba(255, 190, 110, ${alpha})`;
        ctx.fillRect(0, bandY + wobble, w, bandHeight);
    }
    ctx.restore();
}

export function renderWeather(
    ctx: CanvasRenderingContext2D,
    env: EnvState,
    w: number,
    h: number,
    frameTime: number,
): void {
    switch (env.weather.kind) {
        case "RAIN":
            renderRain(ctx, w, h, frameTime);
            return;
        case "SNOW":
            renderSnow(ctx, w, h, frameTime);
            return;
        case "WIND":
            renderWind(ctx, w, h, frameTime);
            return;
        case "HEAT":
            renderHeatShimmer(ctx, w, h, frameTime);
            return;
        case "CLEAR":
            return;
    }
}