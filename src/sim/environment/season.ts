// Maps day-of-year -> Season. Season scales natural resource abundance on the
// surface, the queen's laying rate, brood development speed, and baseline
// temperature. Winter is a survival test (stores must last). Server-only.

import { dayOfYear } from "./clock";
import { DAYS_PER_SEASON, SEASON_FORAGE_ABUNDANCE, SEASON_LAY_FACTOR, SEASON_BROOD_SPEED } from "../params";


export type Season = "SPRING" | "SUMMER" | "AUTTMN" | "WINTER";

const SEASON_ORDER: Season[] = ["SPRING", "SUMMER", "AUTTMN", "WINTER"];

export function seasonOf(simTime: number): Season {
    const day = dayOfYear(simTime);
    const index = Math.floor(day / DAYS_PER_SEASON) % SEASON_ORDER.length;
    return SEASON_ORDER[index];
}

export function forageAbundance(season: Season): number {
    return SEASON_FORAGE_ABUNDANCE[season];
}

export function layFactor(season: Season): number {
    return SEASON_LAY_FACTOR[season];
}

export function broodSpeed(season: Season): number {
    return SEASON_BROOD_SPEED[season];
}