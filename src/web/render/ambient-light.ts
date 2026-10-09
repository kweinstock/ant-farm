// PHASE 12e: day/night/season/weather used to only exist as 2D overlay
// tints painted onto the offscreen nest/surface canvases (daynight.ts,
// season-fx.ts) — invisible on anything drawn as a real 3D object instead
// (ants, trees, corpses, food piles, the cube's own soil faces), which is
// everything now (see decal-pool.ts/props.ts/ant-props.ts's headers). This
// computes one ambient light color + intensity from the same state.env each
// of those overlays read, so the whole scene — not just the two painted
// textures — visibly responds to time of day, season, and weather.
// engine.ts applies it to a single THREE.AmbientLight; that's also why
// every mesh material in render/ switched from MeshBasicMaterial (always
// unlit, ignores scene lights entirely) to MeshLambertMaterial.
//
// Deliberately still just one ambient term, no directional/shadow-casting
// light — this scene has no normal-dependent shading anywhere (flat cutout
// cards and flush cube faces), so a directional light would only add cost,
// not visible detail. Framework-agnostic (no `THREE` import) so it stays
// trivially unit-testable and mirrors daynight.ts/season-fx.ts's own
// "pure calculation, caller applies it" split.
import type { EnvState } from "../../sim/state";
import type { Season } from "../../sim/environment/season";
import type { WeatherKind } from "../../sim/environment/weather";
import { DAWN_START, DAY_START, DUSK_START, NIGHT_START } from "../../sim/params";

export type LightColor = { r: number; g: number; b: number };

type PhaseLight = { color: LightColor; intensity: number };

// Intensity values well above 1 look odd for a real-world light, but there's
// only ever this one flat ambient term lighting the whole scene (no
// directional/fill light on top of it — see this file's header), and
// MeshLambertMaterial reads noticeably dimmer than the MeshBasicMaterial
// (always full-bright, ignored lights entirely) every mesh used before —
// these are picked to visually land back around "full daylight" at DAY,
// not calibrated against any physical unit.
const NIGHT_LIGHT: PhaseLight = { color: { r: 70, g: 90, b: 150 }, intensity: 0.5 };
const DAWN_LIGHT: PhaseLight = { color: { r: 255, g: 175, b: 120 }, intensity: 1.7 };
const DAY_LIGHT: PhaseLight = { color: { r: 255, g: 255, b: 255 }, intensity: 2.4 };
const DUSK_LIGHT: PhaseLight = { color: { r: 255, g: 110, b: 70 }, intensity: 1.5 };

function lerpLight(a: PhaseLight, b: PhaseLight, t: number): PhaseLight {
    return {
        color: {
            r: a.color.r + (b.color.r - a.color.r) * t,
            g: a.color.g + (b.color.g - a.color.g) * t,
            b: a.color.b + (b.color.b - a.color.b) * t,
        },
        intensity: a.intensity + (b.intensity - a.intensity) * t,
    };
}

// Same four-boundary walk as daynight.ts's tintForPhase — kept as its own
// copy rather than shared, since that one blends toward an *overlay alpha*
// (0 = invisible) and this one blends toward a *light intensity* (0 = pitch
// black), different enough semantics that a shared helper would need to
// take the "meaning" of the fourth channel as a parameter anyway.
function lightForPhase(phase: number): PhaseLight {
    if (phase < DAWN_START) {
        return lerpLight(NIGHT_LIGHT, DAWN_LIGHT, phase / DAWN_START);
    }
    if (phase < DAY_START) {
        return lerpLight(DAWN_LIGHT, DAY_LIGHT, (phase - DAWN_START) / (DAY_START - DAWN_START));
    }
    if (phase < DUSK_START) {
        return DAY_LIGHT;
    }
    if (phase < NIGHT_START) {
        return lerpLight(DUSK_LIGHT, NIGHT_LIGHT, (phase - DUSK_START) / (NIGHT_START - DUSK_START));
    }
    return NIGHT_LIGHT;
}

function blend(a: LightColor, b: LightColor, t: number): LightColor {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// Subtle nudges only — day/night stays the dominant read, season and
// weather just color it rather than overriding it (a snowstorm at noon is
// still noon-bright, just cooler and a little dimmer).
const SEASON_BLEND = 0.18;
const SEASON_TINT: Record<Season, LightColor> = {
    SPRING: { r: 210, g: 255, b: 210 },
    SUMMER: { r: 255, g: 245, b: 200 },
    AUTTMN: { r: 255, g: 195, b: 140 },
    WINTER: { r: 210, g: 225, b: 255 },
};
const SEASON_INTENSITY_DELTA: Record<Season, number> = {
    SPRING: 0,
    SUMMER: 0.05,
    AUTTMN: -0.03,
    WINTER: -0.1,
};

const WEATHER_BLEND = 0.3;
const WEATHER_TINT: Partial<Record<WeatherKind, LightColor>> = {
    RAIN: { r: 120, g: 130, b: 145 },
    SNOW: { r: 220, g: 228, b: 240 },
    HEAT: { r: 255, g: 220, b: 170 },
};
// RAIN drops hard, well past the other weathers — an overcast rainstorm
// should read as noticeably darker/grayer, not just a faint dimming easy
// to miss next to a clear day.
const WEATHER_INTENSITY_MULT: Record<WeatherKind, number> = {
    CLEAR: 1,
    RAIN: 0.4,
    SNOW: 0.8,
    HEAT: 1.05,
    WIND: 0.95,
};

const MIN_INTENSITY = 0.3;
const MAX_INTENSITY = 3;

export function computeAmbientLight(env: EnvState): { color: LightColor; intensity: number } {
    const base = lightForPhase(env.phase);

    let color = blend(base.color, SEASON_TINT[env.season], SEASON_BLEND);
    let intensity = base.intensity + SEASON_INTENSITY_DELTA[env.season];

    const weatherTint = WEATHER_TINT[env.weather.kind];
    if (weatherTint) {
        color = blend(color, weatherTint, WEATHER_BLEND);
    }
    intensity *= WEATHER_INTENSITY_MULT[env.weather.kind];

    intensity = Math.max(MIN_INTENSITY, Math.min(MAX_INTENSITY, intensity));

    return { color, intensity };
}
