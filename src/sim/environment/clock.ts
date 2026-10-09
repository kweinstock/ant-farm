// Pure clock math over simTime — no RNG, no state read besides the tick
// counter itself. phaseOfDay feeds the renderer's smooth day/night grade;
// timeOfDay buckets it for game-logic branches (temperature, predator mult).

import { DAY_LENGTH_TICKS, DAWN_START, DAY_START, DUSK_START, NIGHT_START, DAYS_PER_YEAR } from "../params";

export type TimeOfDay = "DAWN" | "DAY" | "DUSK" | "NIGHT";

export function phaseOfDay(simTime: number): number {
    return (simTime % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS;
}

export function timeOfDay(simTime: number): TimeOfDay {
    const frac = phaseOfDay(simTime);
    if (frac >= NIGHT_START || frac < DAWN_START) return "NIGHT";
    if (frac < DAY_START) return "DAWN";
    if (frac < DUSK_START) return "DAY";
    return "DUSK";
}

export function dayOfYear(simTime: number): number {
    const totalDays = Math.floor(simTime / DAY_LENGTH_TICKS);
    return totalDays % DAYS_PER_YEAR;
}