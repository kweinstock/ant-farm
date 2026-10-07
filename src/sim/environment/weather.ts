// Markov-style weather: current WeatherKind, remaining duration, and a short
// forecast (shown in the HUD). Transition probabilities depend on season
// (SNOW only when cold, HEAT mostly SUMMER). Weather is visualized client-side
// (weather-fx.ts) and mechanically affects pheromone evaporation, movement,
// forage risk, and flooding. Server-only — no visitor input path exists.

import { rng } from "../rng";
import type { Season } from "./season";
import { WEATHER_MATRIX, WEATHER_MIN_DURATION, WEATHER_MAX_DURATION, FORECAST_LENGTH } from "../params";


export type WeatherKind = "CLEAR" | "RAIN" | "SNOW" | "HEAT" | "WIND";

const KIND_ORDER: WeatherKind[] = ["CLEAR", "RAIN", "SNOW", "HEAT", "WIND"];

export type WeatherState = {
    kind: WeatherKind;
    ticksRemaining: number;
    forecast: WeatherKind[];
};

function pickKind(row: Record<WeatherKind, number>, roll: number): WeatherKind {
    let acc = 0;
    for (const kind of KIND_ORDER) {
        acc += row[kind];
        if (roll < acc) return kind;
    }
    return KIND_ORDER[KIND_ORDER.length - 1];
}

function argmaxKind(row: Record<WeatherKind, number>): WeatherKind {
    let best = KIND_ORDER[0];
    let bestP = -Infinity;
    for (const kind of KIND_ORDER) {
        if (row[kind] > bestP) {
            bestP = row[kind];
            best = kind;
        }
    }
    return best;
}

// What the weather could turn into when the current spell ends, with the real
// odds (the same row advanceWeather rolls against), most likely first. Display
// only: the sim never calls this, so it can't affect determinism. This is what
// the dashboard shows instead of `forecast`, which is just the single most
// likely kind repeated (CLEAR -> CLEAR -> CLEAR almost always) and doesn't
// predict the actual outcome, since that's a random roll.
export function weatherOutlook(season: Season, kind: WeatherKind): { kind: WeatherKind; probability: number }[] {
    const row = WEATHER_MATRIX[season][kind];
    const total = KIND_ORDER.reduce((sum, k) => sum + row[k], 0);
    if (total <= 0) return [];
    return KIND_ORDER
        .filter((k) => row[k] > 0)
        .map((k) => ({ kind: k, probability: row[k] / total }))
        .sort((a, b) => b.probability - a.probability);
}

function buildForecast(season: Season, fromKind: WeatherKind): WeatherKind[] {
    const forecast: WeatherKind[] = [];
    let kind = fromKind;
    for (let i = 0; i < FORECAST_LENGTH; i++) {
        kind = argmaxKind(WEATHER_MATRIX[season][kind]);
        forecast.push(kind)
    }
    return forecast;
}

export function initialWeather(seed: number): {weather: WeatherState; seed: number} {
    const durRoll = rng(seed);
    const duration = WEATHER_MIN_DURATION.CLEAR + Math.floor(durRoll.value * (WEATHER_MAX_DURATION.CLEAR - WEATHER_MIN_DURATION.CLEAR));
    return {
        weather: {kind: "CLEAR", ticksRemaining: duration, forecast: []},
        seed: durRoll.seed
    }
}

export function advanceWeather(weather: WeatherState, season: Season, seed: number): { weather: WeatherState; seed: number; changed: boolean } {
    const roll = rng(seed);

    if (weather.ticksRemaining > 1) {
        return {
            weather: { ...weather, ticksRemaining: weather.ticksRemaining - 1 },
            seed: roll.seed,
            changed: false,
        };
    }

    const row = WEATHER_MATRIX[season][weather.kind];
    const nextKind = pickKind(row, roll.value);

    const durRoll = rng(roll.seed);
    const duration =
        WEATHER_MIN_DURATION[nextKind] +
        Math.floor(durRoll.value * (WEATHER_MAX_DURATION[nextKind] - WEATHER_MIN_DURATION[nextKind]));

    return {
        weather: { kind: nextKind, ticksRemaining: duration, forecast: buildForecast(season, nextKind) },
        seed: durRoll.seed,
        changed: true,
    };
}