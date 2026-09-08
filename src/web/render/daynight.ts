// Full-screen color grade keyed to env.timeOfDay, with smooth transitions
// through dawn and dusk via env.phase (clock.ts's phaseOfDay — the [0,1)
// fraction through the current day; see state.ts/index.ts for where it's
// stored on EnvState). The four named tints below are targets for the
// DAWN_START/DAY_START/DUSK_START/NIGHT_START boundaries from params.ts;
// env.phase drives a linear blend between whichever two boundaries it
// currently sits between, so the grade never visibly snaps the instant
// timeOfDay() flips buckets.
import type { EnvState } from "../../sim/state";
import { DAWN_START, DAY_START, DUSK_START, NIGHT_START } from "../../sim/params";

type Tint = { r: number; g: number; b: number; alpha: number };

const NIGHT_TINT: Tint = { r: 10, g: 15, b: 40, alpha: 0.55 };
const DAWN_TINT: Tint = { r: 255, g: 170, b: 120, alpha: 0.25 };
const DAY_TINT: Tint = { r: 255, g: 255, b: 255, alpha: 0 };
const DUSK_TINT: Tint = { r: 255, g: 100, b: 60, alpha: 0.3 };

function lerpTint(a: Tint, b: Tint, t: number): Tint {
    return {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        alpha: a.alpha + (b.alpha - a.alpha) * t,
    };
}

// Walks the four boundaries in phase order and blends between whichever two
// tints env.phase currently sits between. NIGHT holds steady from
// NIGHT_START through the 1.0/0.0 wrap up to DAWN_START, where the blend
// into DAWN begins — this is the one span that "wraps."
function tintForPhase(phase: number): Tint {
    if (phase < DAWN_START) {
        const t = phase / DAWN_START;
        return lerpTint(NIGHT_TINT, DAWN_TINT, t);
    }
    if (phase < DAY_START) {
        const t = (phase - DAWN_START) / (DAY_START - DAWN_START);
        return lerpTint(DAWN_TINT, DAY_TINT, t);
    }
    if (phase < DUSK_START) {
        return DAY_TINT;
    }
    if (phase < NIGHT_START) {
        const t = (phase - DUSK_START) / (NIGHT_START - DUSK_START);
        return lerpTint(DUSK_TINT, NIGHT_TINT, t);
    }
    return NIGHT_TINT;
}

// `intensity` scales the whole effect (surface gets full strength; nest gets
// an optional faint pass — see engine.ts) without needing a second tint
// table just for "dimmer."
export function applyDayNight(
    ctx: CanvasRenderingContext2D,
    env: EnvState,
    w: number,
    h: number,
    intensity: number = 1,
): void {
    const tint = tintForPhase(env.phase);
    const alpha = tint.alpha * intensity;
    if (alpha <= 0) return;

    ctx.save();
    ctx.fillStyle = `rgba(${Math.round(tint.r)}, ${Math.round(tint.g)}, ${Math.round(tint.b)}, ${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}