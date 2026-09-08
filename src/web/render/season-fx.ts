// Seasonal palette wash (spring growth, summer haze, autumn litter, winter
// frost) keyed to env.season. Sits UNDER weather and day/night in the render
// chain (engine.ts: seasonFx -> weatherFx -> dayNight) — it's a tint on the
// ground itself, not an atmospheric layer on top of weather or light.
import type { EnvState } from "../../sim/state";

type Tint = { r: number; g: number; b: number; alpha: number };

const SPRING_TINT: Tint = { r: 140, g: 220, b: 140, alpha: 0.12 };
const SUMMER_TINT: Tint = { r: 230, g: 210, b: 140, alpha: 0.08 };
const AUTUMN_TINT: Tint = { r: 200, g: 120, b: 40, alpha: 0.15 };
const WINTER_TINT: Tint = { r: 220, g: 230, b: 255, alpha: 0.25 };

// Pure lookup — no canvas needed — so other modules (a future HUD swatch,
// say) can read the current season's color without a context in hand.
//
// NOTE: the "AUTTMN" case matches the current (misspelled) Season literal
// type in environment/season.ts / params.ts. If/when that gets renamed to
// "AUTUMN" (flagged separately, Part D), this case label renames with it —
// nothing else here changes.
export function seasonTint(season: EnvState["season"]): Tint {
    switch (season) {
        case "SPRING":
            return SPRING_TINT;
        case "SUMMER":
            return SUMMER_TINT;
        case "AUTTMN":
            return AUTUMN_TINT;
        case "WINTER":
            return WINTER_TINT;
    }
}

export function renderSeasonFx(ctx: CanvasRenderingContext2D, env: EnvState, w: number, h: number): void {
    const tint = seasonTint(env.season);
    if (tint.alpha <= 0) return;

    ctx.save();
    ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${tint.alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}