// Fixed-corner tuning dashboard: population, deaths, food economy,
// environment, and colony-structure readouts. Reads `state` directly for
// instantaneous values; reads the client-side TuningStats accumulator
// (main.ts) for cumulative/windowed values step() itself doesn't retain.
//
// Everything here is RNG-free, pure reads — this file never calls step()
// or mutates ColonyState. It DOES mutate its own panel DOM and (via
// TuningStats) a plain mutable accumulator object; that's fine specifically
// because TuningStats is UI-local scratch state, never part of ColonyState
// and never replayed, so the sim's purity discipline doesn't apply to it.
//
// Updates on a throttle (~4/sec via setInterval), not every rAF — nothing
// here needs frame-rate refresh. Toggleable, default ON for this tuning
// phase (localStorage-backed, same pattern as view-switch.ts's toggles).
import type { ColonyState } from "../../sim/state";
import type { TuningStats } from "../main";
import { tilesOf, chamberAt } from "../../sim/world/nest";
import { corpseNeedsUndertaker } from "../../sim/corpses";
import {
    HUNGER_THRESHOLD,
    MAX_ENERGY,
    NURSERY_TILE_CAPACITY,
    MIN_TRAIL,
    COLD_DEATH_TEMP,
} from "../../sim/params";

const STORAGE_KEY = "ant-farm-show-dashboard";
const REFRESH_MS = 250; // ~4/sec
const POP_WINDOW_SHORT = 500;
const POP_WINDOW_LONG = 2000;
const FOOD_WINDOW = 2000;
const DEATH_RATE_WINDOW = 1000;

function readStoredVisible(): boolean | undefined {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "true" || stored === "false" ? stored === "true" : undefined;
    } catch {
        return undefined;
    }
}

function writeStoredVisible(value: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
        // Not worth surfacing — same reasoning as view-switch.ts's localStorage writes.
    }
}

function trendArrow(delta: number): string {
    if (delta > 0.5) return "\u2191"; // up
    if (delta < -0.5) return "\u2193"; // down
    return "\u2192"; // flat
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

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-dashboard {
            position: fixed;
            bottom: 0.5rem;
            right: 0.5rem;
            max-width: 22rem;
            max-height: 80vh;
            overflow-y: auto;
            background: rgba(20, 16, 10, 0.85);
            color: #e8d8b8;
            font: 11px/1.4 "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            padding: 0.6rem 0.75rem;
            border-radius: 6px;
            white-space: pre;
            z-index: 1000;
        }
        .ant-farm-dashboard[hidden] {
            display: none;
        }
        .ant-farm-dashboard-toggle {
            position: fixed;
            bottom: 0.5rem;
            right: 0.5rem;
            z-index: 1001;
            font: 0.75rem sans-serif;
            padding: 0.2rem 0.5rem;
        }
    `;
    document.head.appendChild(style);
}

function section(title: string, lines: string[]): string {
    return `${title}\n${"-".repeat(title.length)}\n${lines.join("\n")}\n`;
}

function buildText(state: ColonyState, stats: TuningStats): string {
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

    const populationSection = section("POPULATION", [
        `total: ${state.ants.size}   queen: ${queenPresent ? "Y" : "N"}${queenPresent ? ` (${queenAge}/${queenLifespan})` : ""}`,
        `caste: workers ${workers}  queen ${queenPresent ? 1 : 0}`,
        `job:   nurses ${nurses}  foragers ${foragers}  undertaking ${undertaking}  idle~${idle}`,
        `where: nest ${inNest}  surface ${onSurface}  (foragers out: ${foragersOut})`,
        `brood: eggs ${eggs}  larvae ${larvae}  pupae ${pupae}   placed ${placedInNursery} / waiting ${waitingInQueenChamber}`,
        `trend: 500t ${trendArrow(popDeltaShort)}${popDeltaShort >= 0 ? "+" : ""}${popDeltaShort}   2000t ${trendArrow(popDeltaLong)}${popDeltaLong >= 0 ? "+" : ""}${popDeltaLong}`,
    ]);

    // ---- Deaths ----
    const deathRateWindow = Math.min(tick, DEATH_RATE_WINDOW) || 1;
    const deathRate = (stats.deathTicks.length / deathRateWindow) * 1000;

    const deathsSection = section("DEATHS", [
        `total: ${stats.deathsTotal}   rate/1000t (last ${DEATH_RATE_WINDOW}t): ${deathRate.toFixed(2)}`,
        `  oldAge ${stats.deathsByCause.oldAge}  starvation ${stats.deathsByCause.starvation}  predator ${stats.deathsByCause.predator}  cold ${stats.deathsByCause.cold}  exposure ${stats.deathsByCause.exposure}`,
        `  nest ${stats.deathsByLocation.nest}  surface ${stats.deathsByLocation.surface}`,
        `births: ${stats.birthsTotal}   net: ${stats.birthsTotal - stats.deathsTotal >= 0 ? "+" : ""}${stats.birthsTotal - stats.deathsTotal}`,
    ]);

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

    const foodSection = section("FOOD ECONOMY", [
        `store: ${Math.round(state.foodStore.amount)} / ${state.foodStore.capacity} (${pct(fill)})   trend 2000t: ${trendArrow(foodDelta)}${foodDelta >= 0 ? "+" : ""}${Math.round(foodDelta)}`,
        `surface: ${state.surface.foodPiles.length} piles, ${Math.round(surfaceFoodTotal)} food`,
        `trips: ${stats.forageDepartsTotal}   delivered: ${Math.round(stats.foodDeliveredTotal)}   per-trip: ${perTrip !== undefined ? perTrip.toFixed(1) : "n/a"}`,
        `avg trip length (rough, ${stats.recentTripLengths.length} samples): ${avgTripLength !== undefined ? avgTripLength.toFixed(0) + "t" : "n/a"}`,
        `hungry now (<${HUNGER_THRESHOLD} energy ratio): ${hungryCount}`,
    ]);

    // ---- Environment ----
    const env = state.env;
    const coldActive = env.ambientTemp < COLD_DEATH_TEMP;
    const forecastStrip = env.weather.forecast.join(" \u2192 ") || "n/a";

    const envSection = section("ENVIRONMENT", [
        `tick: ${tick}   season: ${env.season}   day-of-year: ${env.dayOfYear}   time: ${env.timeOfDay}`,
        `weather: ${env.weather.kind} (${env.weather.ticksRemaining}t left)   forecast: ${forecastStrip}`,
        `temp: ${env.ambientTemp.toFixed(1)}\u00b0${coldActive ? "  [COLD-DEATH ACTIVE]" : ""}`,
        `predator: ${env.predator ? `Y (${env.predator.ticksRemaining}t left)` : "N"}   strikes total: ${stats.predatorStrikesTotal}`,
    ]);

    // ---- Colony structure ----
    const nurseryCapacity = tilesOf(state.nest, "NURSERY").length * NURSERY_TILE_CAPACITY;
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

    const structureSection = section("COLONY STRUCTURE", [
        `nursery: ${placedInNursery} / ${nurseryCapacity} (${pct(nurseryUtil)})`,
        `corpses: ${pendingCorpses} pending, ${state.corpses.length} total`,
        `trail: ${trailCellsAboveFloor} cells above floor, mass ${Math.round(trailMass)}`,
    ]);

    return [populationSection, deathsSection, foodSection, envSection, structureSection].join("\n");
}

export function mountDashboard(
    container: HTMLElement,
    getState: () => ColonyState,
    getStats: () => TuningStats,
): void {
    injectStyles();

    const panel = document.createElement("div");
    panel.className = "ant-farm-dashboard";

    const toggle = document.createElement("button");
    toggle.className = "ant-farm-dashboard-toggle";
    toggle.type = "button";

    container.append(panel, toggle);

    let visible = readStoredVisible() ?? true; // default ON for this tuning phase

    function applyVisibility(): void {
        panel.hidden = !visible;
        toggle.textContent = visible ? "Hide stats" : "Show stats";
        writeStoredVisible(visible);
    }

    toggle.addEventListener("click", () => {
        visible = !visible;
        applyVisibility();
    });

    applyVisibility();

    function refresh(): void {
        if (visible) {
            panel.textContent = buildText(getState(), getStats());
        }
    }

    refresh();
    setInterval(refresh, REFRESH_MS);
}