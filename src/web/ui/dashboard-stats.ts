// Pure "state + stats -> readout text" builder — no DOM, no mounting, no
// toggle/localStorage chrome. Split out of the old weather-hud.ts (now
// ui/control-panel.ts, which owns the dock this renders into) so the actual
// data-crunching stays testable/reusable independent of where it's drawn.
//
// Reads `state` directly for instantaneous values; reads the client-side
// TuningStats accumulator (main.ts) for cumulative/windowed values step()
// itself doesn't retain. RNG-free, pure reads — never calls step() or
// mutates ColonyState.
import type { ColonyState } from "../../sim/state";
import type { TuningStats } from "../main";
import { allTilesOf, chamberAt } from "../../sim/world/nest";
import { corpseNeedsUndertaker } from "../../sim/corpses";
import {
    HUNGER_THRESHOLD,
    MAX_ENERGY,
    NURSERY_TILE_CAPACITY,
    MIN_TRAIL,
    COLD_DEATH_TEMP,
} from "../../sim/params";

const POP_WINDOW_SHORT = 500;
const POP_WINDOW_LONG = 2000;
const FOOD_WINDOW = 2000;
const DEATH_RATE_WINDOW = 1000;

function trendArrow(delta: number): string {
    if (delta > 0.5) return "↑"; // up
    if (delta < -0.5) return "↓"; // down
    return "→"; // flat
}

function popDeltaOverWindow(history: TuningStats["populationHistory"], tick: number, windowTicks: number): number {
    const target = tick - windowTicks;
    for (const sample of history) {
        if (sample.tick >= target) {
            const current = history[history.length - 1]?.population ?? 0;
            return current - sample.population;
        }
    }
    return 0;
}

function foodDeltaOverWindow(history: TuningStats["foodHistory"], tick: number, windowTicks: number): number {
    const target = tick - windowTicks;
    for (const sample of history) {
        if (sample.tick >= target) {
            const current = history[history.length - 1]?.amount ?? 0;
            return current - sample.amount;
        }
    }
    return 0;
}

function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
}

function avg(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export type StatsSection = {
    title: string;
    lines: string[];
};

// ui/control-panel.ts renders each section as its own styled header + line
// block — a plain array of {title, lines} instead of one pre-formatted
// string (the old ASCII "----" underline approach) so the panel can style
// section headers distinctly rather than everything being one flat <pre>.
export function buildStatsSections(state: ColonyState, stats: TuningStats): StatsSection[] {
    const tick = state.simTime;

    // ---- Population ----
    let queenPresent = false;
    let queenAge = 0;
    let queenLifespan = 0;
    let workers = 0;
    let nurses = 0;
    let foragers = 0;
    let undertaking = 0;
    let idle = 0;
    let inNest = 0;
    let onSurface = 0;
    let foragersOut = 0;

    for (const ant of state.ants.values()) {
        if (ant.caste === "QUEEN") {
            queenPresent = true;
            queenAge = ant.ageTicks;
            queenLifespan = ant.lifespanTicks;
            continue;
        }

        workers += 1;
        if (ant.job === "NURSE") nurses += 1;
        else if (ant.job === "FORAGER") foragers += 1;
        if (ant.undertaking !== undefined) undertaking += 1;

        if (ant.location.where === "nest") {
            inNest += 1;
            // Approximation: a NURSE, uncarrying, not undertaking, standing
            // in COMMONS — behavior.ts's "nothing to fetch, mill" branch.
            if (
                ant.job === "NURSE" &&
                ant.undertaking === undefined &&
                ant.carrying.length === 0 &&
                chamberAt(state.nest, ant.location.pos) === "COMMONS"
            ) {
                idle += 1;
            }
        } else {
            onSurface += 1;
            if (ant.job === "FORAGER") foragersOut += 1;
        }
    }

    let eggs = 0;
    let larvae = 0;
    let pupae = 0;
    let placedInNursery = 0;
    let waitingInQueenChamber = 0;
    for (const entry of state.brood) {
        if (entry.stage === "EGG") eggs += 1;
        else if (entry.stage === "LARVA") larvae += 1;
        else pupae += 1;

        if (entry.carriedBy === undefined) {
            const chamber = chamberAt(state.nest, entry.position);
            if (chamber === "NURSERY") placedInNursery += 1;
            else if (chamber === "QUEEN") waitingInQueenChamber += 1;
        }
    }

    const popDeltaShort = popDeltaOverWindow(stats.populationHistory, tick, POP_WINDOW_SHORT);
    const popDeltaLong = popDeltaOverWindow(stats.populationHistory, tick, POP_WINDOW_LONG);

    const populationSection: StatsSection = {
        title: "Population",
        lines: [
            `total: ${state.ants.size}   queen: ${queenPresent ? "Y" : "N"}${queenPresent ? ` (${queenAge}/${queenLifespan})` : ""}`,
            `caste: workers ${workers}  queen ${queenPresent ? 1 : 0}`,
            `job:   nurses ${nurses}  foragers ${foragers}  undertaking ${undertaking}  idle~${idle}`,
            `where: nest ${inNest}  surface ${onSurface}  (foragers out: ${foragersOut})`,
            `brood: eggs ${eggs}  larvae ${larvae}  pupae ${pupae}   placed ${placedInNursery} / waiting ${waitingInQueenChamber}`,
            `trend: 500t ${trendArrow(popDeltaShort)}${popDeltaShort >= 0 ? "+" : ""}${popDeltaShort}   2000t ${trendArrow(popDeltaLong)}${popDeltaLong >= 0 ? "+" : ""}${popDeltaLong}`,
        ],
    };

    // ---- Deaths ----
    const deathRateWindow = Math.min(tick, DEATH_RATE_WINDOW) || 1;
    const deathRate = (stats.deathTicks.length / deathRateWindow) * 1000;

    const deathsSection: StatsSection = {
        title: "Deaths",
        lines: [
            `total: ${stats.deathsTotal}   rate/1000t (last ${DEATH_RATE_WINDOW}t): ${deathRate.toFixed(2)}`,
            `  oldAge ${stats.deathsByCause.oldAge}  starvation ${stats.deathsByCause.starvation}  predator ${stats.deathsByCause.predator}  cold ${stats.deathsByCause.cold}  exposure ${stats.deathsByCause.exposure}`,
            `  nest ${stats.deathsByLocation.nest}  surface ${stats.deathsByLocation.surface}`,
            `births: ${stats.birthsTotal}   net: ${stats.birthsTotal - stats.deathsTotal >= 0 ? "+" : ""}${stats.birthsTotal - stats.deathsTotal}`,
        ],
    };

    // ---- Food economy ----
    const fill = state.foodStore.capacity > 0 ? state.foodStore.amount / state.foodStore.capacity : 0;
    const foodDelta = foodDeltaOverWindow(stats.foodHistory, tick, FOOD_WINDOW);
    const surfaceFoodTotal = state.surface.foodPiles.reduce((sum, pile) => sum + pile.amount, 0);
    const perTrip = stats.forageDepartsTotal > 0 ? stats.foodDeliveredTotal / stats.forageDepartsTotal : undefined;
    const avgTripLength = avg(stats.recentTripLengths);
    let hungryCount = 0;
    for (const ant of state.ants.values()) {
        if (ant.energy / MAX_ENERGY < HUNGER_THRESHOLD) hungryCount += 1;
    }

    const foodSection: StatsSection = {
        title: "Food economy",
        lines: [
            `store: ${Math.round(state.foodStore.amount)} / ${state.foodStore.capacity} (${pct(fill)})   trend 2000t: ${trendArrow(foodDelta)}${foodDelta >= 0 ? "+" : ""}${Math.round(foodDelta)}`,
            `surface: ${state.surface.foodPiles.length} piles, ${Math.round(surfaceFoodTotal)} food`,
            `trips: ${stats.forageDepartsTotal}   delivered: ${Math.round(stats.foodDeliveredTotal)}   per-trip: ${perTrip !== undefined ? perTrip.toFixed(1) : "n/a"}`,
            `avg trip length (rough, ${stats.recentTripLengths.length} samples): ${avgTripLength !== undefined ? avgTripLength.toFixed(0) + "t" : "n/a"}`,
            `hungry now (<${HUNGER_THRESHOLD} energy ratio): ${hungryCount}`,
        ],
    };

    // ---- Environment ----
    const env = state.env;
    const coldActive = env.ambientTemp < COLD_DEATH_TEMP;
    const forecastStrip = env.weather.forecast.join(" → ") || "n/a";

    const envSection: StatsSection = {
        title: "Environment",
        lines: [
            `tick: ${tick}   season: ${env.season}   day-of-year: ${env.dayOfYear}   time: ${env.timeOfDay}`,
            `weather: ${env.weather.kind} (${env.weather.ticksRemaining}t left)   forecast: ${forecastStrip}`,
            `temp: ${env.ambientTemp.toFixed(1)}°${coldActive ? "  [COLD-DEATH ACTIVE]" : ""}`,
            `predator: ${env.predator ? `Y at (${env.predator.pos.x},${env.predator.pos.y})${env.predator.huntingAntId ? " [hunting]" : ""}` : "N"}   strikes total: ${stats.predatorStrikesTotal}`,
        ],
    };

    // ---- Colony structure ----
    const nurseryCapacity = allTilesOf(state.nest, "NURSERY").length * NURSERY_TILE_CAPACITY;
    const nurseryUtil = nurseryCapacity > 0 ? placedInNursery / nurseryCapacity : 0;

    let pendingCorpses = 0;
    for (const corpse of state.corpses) {
        if (corpseNeedsUndertaker(state.surface, corpse)) pendingCorpses += 1;
    }

    let trailCellsAboveFloor = 0;
    let trailMass = 0;
    for (const value of state.surface.trail.cells) {
        trailMass += value;
        if (value >= MIN_TRAIL) trailCellsAboveFloor += 1;
    }

    const structureSection: StatsSection = {
        title: "Colony structure",
        lines: [
            `nursery: ${placedInNursery} / ${nurseryCapacity} (${pct(nurseryUtil)})`,
            `corpses: ${pendingCorpses} pending, ${state.corpses.length} total`,
            `trail: ${trailCellsAboveFloor} cells above floor, mass ${Math.round(trailMass)}`,
        ],
    };

    return [populationSection, deathsSection, foodSection, envSection, structureSection];
}
