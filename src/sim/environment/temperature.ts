// temperature = base(season, timeOfDay) + weatherModifier + depthGradient.
// Underground is buffered; deep chambers barely move. Drives brood timers,
// cold-death checks, water evaporation, and ant activity level.

import type { Season } from "./season";
import type { WeatherKind } from "./weather";
import type { TimeOfDay } from "./clock";
import { BASE_TEMP, NIGHT_TEMP_DROP, DUSK_TEMP_DROP, WEATHER_TEMP_MOD, DEPTH_GRADIENT_PER_ROW, UNDERGROUND_STABLE_TEMP } from "../params";

export function ambientTemp(season: Season, time: TimeOfDay, weather: WeatherKind): number {
    let temp = BASE_TEMP[season];
    if (time === "NIGHT") temp -= NIGHT_TEMP_DROP;
    else if (time === "DUSK") temp -= DUSK_TEMP_DROP;
    temp += WEATHER_TEMP_MOD[weather];
    return temp;
}

export function tempAtDepth(ambient: number, row: number): number {
    const pull = Math.min(1, DEPTH_GRADIENT_PER_ROW * row);
    return ambient + (UNDERGROUND_STABLE_TEMP - ambient) * pull;
}