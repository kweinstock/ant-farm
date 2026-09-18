// The scene backdrop behind the cube — used to be a flat dark brown
// (matching the dirt it was staring into), then a static light-blue
// gradient with clouds. Neither responded to state.env, so day/night and
// season only ever visibly changed the cube itself (once ambient-light.ts
// existed) while the sky stayed frozen — "it should happen as a full
// screen overlay, not just the box." This redraws the same gradient+clouds
// every frame from state.env instead of building it once: darker/bluer at
// night, warm at dawn/dusk, and tinted by season (same SEASON_PALETTE
// props.ts/surface-view.ts use for trees/ground), same "one palette, three
// places" reasoning as season-palette.ts's header.
//
// Still just a flat CanvasTexture on THREE.Scene.background, not a real
// skybox/equirect map or sky dome mesh — a backdrop quad behind everything
// else, redrawn instead of relit (scene.background ignores scene lights
// entirely, so this can't just reuse ambient-light.ts's THREE.AmbientLight
// the way every mesh material now does).
import type { EnvState } from "../../sim/state";
import type { WeatherKind } from "../../sim/environment/weather";
import { DAWN_START, DAY_START, DUSK_START, NIGHT_START } from "../../sim/params";
import { SEASON_PALETTE } from "./season-palette";

const SKY_WIDTH = 1024;
const SKY_HEIGHT = 512;

type RGB = { r: number; g: number; b: number };
type SkyPhase = { top: RGB; horizon: RGB; cloudAlpha: number };

function parseHex(hex: string): RGB {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function cssRGB({ r, g, b }: RGB): string {
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const NIGHT_SKY: SkyPhase = { top: parseHex("#0b1030"), horizon: parseHex("#1c2550"), cloudAlpha: 0.35 };
const DAWN_SKY: SkyPhase = { top: parseHex("#5a6f9e"), horizon: parseHex("#ffb37a"), cloudAlpha: 0.7 };
const DAY_SKY: SkyPhase = { top: parseHex("#7fb8e8"), horizon: parseHex("#d8ecf7"), cloudAlpha: 0.9 };
const DUSK_SKY: SkyPhase = { top: parseHex("#3a4a7a"), horizon: parseHex("#ff7a4a"), cloudAlpha: 0.6 };

function lerpSky(a: SkyPhase, b: SkyPhase, t: number): SkyPhase {
    return {
        top: lerpRGB(a.top, b.top, t),
        horizon: lerpRGB(a.horizon, b.horizon, t),
        cloudAlpha: a.cloudAlpha + (b.cloudAlpha - a.cloudAlpha) * t,
    };
}

// Same four-boundary walk as ambient-light.ts's lightForPhase (which is
// itself a copy of the old daynight.ts's tintForPhase) — a third copy
// because this one blends sky color pairs + cloud alpha, a different shape
// than either of those two again.
function skyForPhase(phase: number): SkyPhase {
    if (phase < DAWN_START) {
        return lerpSky(NIGHT_SKY, DAWN_SKY, phase / DAWN_START);
    }
    if (phase < DAY_START) {
        return lerpSky(DAWN_SKY, DAY_SKY, (phase - DAWN_START) / (DAY_START - DAWN_START));
    }
    if (phase < DUSK_START) {
        return DAY_SKY;
    }
    if (phase < NIGHT_START) {
        return lerpSky(DUSK_SKY, NIGHT_SKY, (phase - DUSK_START) / (NIGHT_START - DUSK_START));
    }
    return NIGHT_SKY;
}

// Nudges the day/night sky toward the season's own sky colors — day/night
// stays the dominant read (a winter noon is still bright), same
// SEASON_BLEND weighting ambient-light.ts uses for the same reason.
const SEASON_BLEND = 0.25;

// Unlike season, RAIN deliberately overrides the day/night read rather than
// just nudging it — "should go darker when raining, [it was] hard to see"
// — a storm should look like a storm even at noon, not a slightly-grayer
// version of a clear day. The other weathers stay subtle nudges.
const WEATHER_SKY_TINT: Partial<Record<WeatherKind, RGB>> = {
    RAIN: parseHex("#3a4048"),
    SNOW: parseHex("#c8d2da"),
    HEAT: parseHex("#e8c090"),
};
const WEATHER_SKY_BLEND: Partial<Record<WeatherKind, number>> = {
    RAIN: 0.65,
    SNOW: 0.35,
    HEAT: 0.2,
};
// Storm clouds: denser (higher alpha) and gray instead of white.
const WEATHER_CLOUD_COLOR: Partial<Record<WeatherKind, string>> = {
    RAIN: "#5a6068",
};
const WEATHER_CLOUD_ALPHA_MULT: Partial<Record<WeatherKind, number>> = {
    RAIN: 1.5,
    SNOW: 1.15,
};

type CloudSpec = { x: number; y: number; scale: number; puffs: number };

// Fixed, not randomized — a static cloud layout should look the same every
// reload rather than reshuffling every time the page loads.
const CLOUDS: CloudSpec[] = [
    { x: 120, y: 90, scale: 1.1, puffs: 5 },
    { x: 430, y: 60, scale: 0.8, puffs: 4 },
    { x: 760, y: 110, scale: 1.3, puffs: 6 },
    { x: 930, y: 200, scale: 0.7, puffs: 4 },
    { x: 260, y: 220, scale: 0.6, puffs: 4 },
    { x: 610, y: 240, scale: 0.9, puffs: 5 },
];

function drawCloud(ctx: CanvasRenderingContext2D, cloud: CloudSpec, alpha: number, color: string): void {
    const { x, y, scale, puffs } = cloud;
    const baseRadius = 26 * scale;

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < puffs; i++) {
        // Puffs spread along a shallow arc, alternating above/below the
        // baseline and shrinking toward the ends — the classic "row of
        // overlapping circles" paper-cutout cloud silhouette.
        const t = i / (puffs - 1) - 0.5;
        const puffX = x + t * baseRadius * 2.6;
        const puffY = y - Math.cos(t * Math.PI) * baseRadius * 0.4;
        const puffRadius = baseRadius * (1 - Math.abs(t) * 0.5);
        ctx.beginPath();
        ctx.arc(puffX, puffY, puffRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// An empty canvas at the right size — engine.ts owns it (and the
// CanvasTexture built from it) for the scene's lifetime, calling renderSky
// into it every frame the same way it owns nestCanvas/surfaceCanvas.
export function buildSkyCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = SKY_WIDTH;
    canvas.height = SKY_HEIGHT;
    return canvas;
}

export function renderSky(ctx: CanvasRenderingContext2D, env: EnvState): void {
    const base = skyForPhase(env.phase);
    const palette = SEASON_PALETTE[env.season];
    let top = lerpRGB(base.top, parseHex(palette.skyTop), SEASON_BLEND);
    let horizon = lerpRGB(base.horizon, parseHex(palette.skyHorizon), SEASON_BLEND);

    const weather = env.weather.kind;
    const stormTint = WEATHER_SKY_TINT[weather];
    if (stormTint) {
        const t = WEATHER_SKY_BLEND[weather] ?? 0;
        top = lerpRGB(top, stormTint, t);
        horizon = lerpRGB(horizon, stormTint, t);
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, SKY_HEIGHT);
    gradient.addColorStop(0, cssRGB(top));
    gradient.addColorStop(1, cssRGB(horizon));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);

    const cloudAlpha = Math.min(1, base.cloudAlpha * (WEATHER_CLOUD_ALPHA_MULT[weather] ?? 1));
    const cloudColor = WEATHER_CLOUD_COLOR[weather] ?? "#ffffff";
    for (const cloud of CLOUDS) {
        drawCloud(ctx, cloud, cloudAlpha, cloudColor);
    }
}
