// Server-only threats. Visitors CANNOT trigger, place, or remove any of these:
//   predator      appears near the EXIT for a while; PredatorStrike on foragers
//   flooding      heavy RAIN can inundate shallow tunnels; ants must haul brood up
//   cold snap     sudden temperature drop; cold-death risk
//   disease       contagion spreading ant-to-ant; undertakers + midden hygiene slow it
// Frequency/severity scale with season + weather. This module is the main
// "set changes visitors have no effect on" from the brief.
//
// Phase 5 scope: predator + cold-death only. Flooding and disease are
// deferred to a later phase.

import { rng } from "../rng";
import type { Position } from "../world/grid";
import type { Season } from "./season";
import type { WeatherKind } from "./weather";
import { PREDATOR_APPEAR_CHANCE, PREDATOR_SEASON_MULT, PREDATOR_WEATHER_MULT, PREDATOR_MIN_DURATION, PREDATOR_MAX_DURATION, PREDATOR_STRIKE_RADIUS, PREDATOR_STRIKE_CHANCE, COLD_DEATH_TEMP, COLD_DEATH_CHANCE_AT_ZERO } from "../params";

export type Predator = { pos: Position; ticksRemaining: number };

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function advancePredator(predator: Predator | undefined, env: { season: Season; weatherKind: WeatherKind; holePos: Position; surfaceWidth: number }, seed: number): { predator: Predator | undefined; seed: number; appeared: boolean; left: boolean } {
    const roll = rng(seed);

    if (predator === undefined) {
        const chance =
            PREDATOR_APPEAR_CHANCE * PREDATOR_SEASON_MULT[env.season] * PREDATOR_WEATHER_MULT[env.weatherKind];
        if (roll.value < chance) {
            const durRoll = rng(roll.seed);
            const duration =
                PREDATOR_MIN_DURATION + Math.floor(durRoll.value * (PREDATOR_MAX_DURATION - PREDATOR_MIN_DURATION));
            return {
                predator: { pos: { ...env.holePos }, ticksRemaining: duration },
                seed: durRoll.seed,
                appeared: true,
                left: false,
            };
        }
        return { predator: undefined, seed: roll.seed, appeared: false, left: false };
    }

    // Drift one tile along the surface, staying in bounds — the predator
    // prowls the ground near the hole, it doesn't walk off the map.
    let pos = predator.pos;
    if (roll.value < 0.34) pos = { ...pos, x: clamp(pos.x + 1, 0, env.surfaceWidth - 1) };
    else if (roll.value < 0.67) pos = { ...pos, x: clamp(pos.x - 1, 0, env.surfaceWidth - 1) };

    const ticksRemaining = predator.ticksRemaining - 1;
    if (ticksRemaining <= 0) {
        return { predator: undefined, seed: roll.seed, appeared: false, left: true };
    }
    return { predator: { pos, ticksRemaining }, seed: roll.seed, appeared: false, left: false };
}

export function predatorStrikeChance(predator: Predator | undefined, antPos: Position): number {
    if (predator === undefined) return 0;
    const dist = Math.abs(predator.pos.x - antPos.x) + Math.abs(predator.pos.y - antPos.y);
    if (dist > PREDATOR_STRIKE_RADIUS) return 0;
    return PREDATOR_STRIKE_CHANCE;
}

export function coldDeathChance(tempAtTile: number): number {
    if (tempAtTile > COLD_DEATH_TEMP) return 0;
    return (COLD_DEATH_TEMP - tempAtTile) * COLD_DEATH_CHANCE_AT_ZERO;
}