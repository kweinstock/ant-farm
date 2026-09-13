// Browser entry for the Ant Farm view. index.html loads this file directly.
//
// PHASE 2 (still true): local mode only — main.ts owns both the sim clock
// (setInterval below) and a mutable `state` slot; render/engine.ts just
// reads that slot every animation frame, never calls step() itself.
//
// PHASE 3b: the single <canvas id="ant-farm-canvas"> is gone. index.html
// now has a plain <div id="ant-farm-views"> that ui/view-switch.ts
// populates with two canvases (one per coordinate space) and hands back —
// this file no longer looks up a canvas by id itself.
//
// PHASE 4: mountViews also hands back renderOptions (the Trails toggle's
// live state) — passed straight through to startRenderLoop unchanged,
// same "own it in one place, thread it through" pattern as everything else
// here.
//
// PHASE 5: local mode used to throw away step()'s events entirely. Now
// every tick's events feed a TuningStats accumulator (below), which
// ui/weather-hud.ts's dashboard reads for cumulative/windowed readouts state alone can't
// give it (deaths by cause, food delivered per trip, etc). TuningStats is
// plain mutable UI-side scratch state — never part of ColonyState, never
// replayed — so it's intentionally NOT held to the sim's pure-copy-modify
// discipline. NOTE for later: demography.ts's header already says it
// "feeds Stats DTO" — Phase 6 may promote some of this into the sim/DO
// properly; for now it's client-side only, rebuilt fresh on every page load.
import { createInitialState } from "../sim/state";
import { step } from "../sim";
import type { ColonyState } from "../sim/state";
import type { AntId } from "../sim/ants/ant";
import type { SimEvent, DeathEvent } from "../sim";
import { getDemography } from "../sim/colony/demography";
import { SOURCE, TICK_INTERVALS_MS } from "./config";
import { startRenderLoop } from "./render/engine";
import { mountViews } from "./ui/view-switch";
import { mountDashboard } from "./ui/weather-hud";

const viewsContainer = document.getElementById("ant-farm-views");

if (!(viewsContainer instanceof HTMLElement)) {
    throw new Error('Expected a <div id="ant-farm-views"> element in index.html');
}

const { nestCanvas, surfaceCanvas, renderOptions } = mountViews(viewsContainer);

// Fixed, same as scripts/print-sim.ts — deterministic while tuning behavior.
const seed = 12345;

let state = createInitialState(seed);

// ---- TuningStats accumulator ----

export type TuningStats = {
    populationHistory: { tick: number; population: number }[];
    foodHistory: { tick: number; amount: number }[];
    deathsByCause: Record<DeathEvent["cause"], number>;
    deathsByLocation: { nest: number; surface: number };
    deathsTotal: number;
    birthsTotal: number;
    deathTicks: number[];
    forageDepartsTotal: number;
    foodDeliveredTotal: number;
    tripDepartedAt: Map<AntId, number>;
    recentTripLengths: number[];
    predatorStrikesTotal: number;
    lastFoodAmount: number;
    asleepNow: number;
    asleepFraction: number;
    peakAsAsleepFraction: number;
};

const POP_HISTORY_WINDOW = 2000;
const FOOD_HISTORY_WINDOW = 2000;
const DEATH_RATE_WINDOW = 1000;
const MAX_TRIP_SAMPLES = 200;

function createTuningStats(initial: ColonyState): TuningStats {
    const initialAsleep = getDemography(initial).asleep
    const initialFraction = initial.ants.size > 0 ? initialAsleep / initial.ants.size : 0;

    return {
        populationHistory: [{ tick: initial.simTime, population: initial.ants.size }],
        foodHistory: [{ tick: initial.simTime, amount: initial.foodStore.amount }],
        deathsByCause: { oldAge: 0, starvation: 0, predator: 0, cold: 0, exposure: 0 },
        deathsByLocation: { nest: 0, surface: 0 },
        deathsTotal: 0,
        birthsTotal: 0,
        deathTicks: [],
        forageDepartsTotal: 0,
        foodDeliveredTotal: 0,
        tripDepartedAt: new Map(),
        recentTripLengths: [],
        predatorStrikesTotal: 0,
        lastFoodAmount: initial.foodStore.amount,
        asleepNow: initialAsleep,
        asleepFraction: initialFraction,
        peakAsAsleepFraction: initialFraction,
    };
}

// Mutates `stats` in place — see the header note on why that's fine here.
function updateTuningStats(stats: TuningStats, nextState: ColonyState, events: SimEvent[]): void {
    const tick = nextState.simTime;

    for (const event of events) {
        if (event.kind === "death") {
            stats.deathsTotal += 1;
            stats.deathsByCause[event.cause] += 1;
            stats.deathsByLocation[event.where] += 1;
            stats.deathTicks.push(tick);
            // Died mid-trip — drop the open trip rather than let it hang.
            stats.tripDepartedAt.delete(event.antId);
        } else if (event.kind === "birth") {
            stats.birthsTotal += 1;
        } else if (event.kind === "forageDepart") {
            stats.forageDepartsTotal += 1;
            stats.tripDepartedAt.set(event.antId, tick);
        } else if (event.kind === "predatorStrike") {
            stats.predatorStrikesTotal += 1;
        }
    }

    // Food delivered = any rise in the store this tick — deposits are the
    // only thing that raises it (EAT_AMOUNT is the only thing that lowers it).
    if (nextState.foodStore.amount > stats.lastFoodAmount) {
        stats.foodDeliveredTotal += nextState.foodStore.amount - stats.lastFoodAmount;
    }
    stats.lastFoodAmount = nextState.foodStore.amount;

    // Rough trip-length tracking: a departed forager "completes" its trip the
    // first tick it's back in the nest empty-handed. This also fires on an
    // empty-handed hungry return (behavior.ts's documented "heads home
    // hungry" branch), not only a successful delivery — deliberately an
    // approximation, separate from foodDeliveredTotal / forageDepartsTotal
    // (the exact per-trip metric above).
    for (const [antId, departedAtTick] of stats.tripDepartedAt) {
        const ant = nextState.ants.get(antId);
        if (!ant) {
            stats.tripDepartedAt.delete(antId);
            continue;
        }
        if (ant.location.where === "nest" && ant.carryingFood === 0) {
            stats.recentTripLengths.push(tick - departedAtTick);
            if (stats.recentTripLengths.length > MAX_TRIP_SAMPLES) {
                stats.recentTripLengths.shift();
            }
            stats.tripDepartedAt.delete(antId);
        }
    }

    stats.populationHistory.push({ tick, population: nextState.ants.size });
    stats.foodHistory.push({ tick, amount: nextState.foodStore.amount });

    const popCutoff = tick - POP_HISTORY_WINDOW;
    while (stats.populationHistory.length > 1 && stats.populationHistory[0].tick < popCutoff) {
        stats.populationHistory.shift();
    }
    const foodCutoff = tick - FOOD_HISTORY_WINDOW;
    while (stats.foodHistory.length > 1 && stats.foodHistory[0].tick < foodCutoff) {
        stats.foodHistory.shift();
    }
    const deathCutoff = tick - DEATH_RATE_WINDOW;
    while (stats.deathTicks.length > 0 && stats.deathTicks[0] < deathCutoff) {
        stats.deathTicks.shift();
    }

    stats.asleepNow = getDemography(nextState).asleep;
    stats.asleepFraction = nextState.ants.size > 0 ? stats.asleepNow / nextState.ants.size : 0;
    stats.peakAsAsleepFraction = Math.max(stats.peakAsAsleepFraction, stats.asleepFraction);
}

const stats = createTuningStats(state);

startRenderLoop(nestCanvas, surfaceCanvas, () => state, renderOptions);
mountDashboard(viewsContainer, () => state, () => stats);

// ============================================================================
// TEMPORARY — DELETE BEFORE CLOUDFLARE
// DAY_LENGTH_TICKS is 1000 ticks; at TICK_INTERVALS_MS=100ms that's a ~100s
// real day, too slow to eyeball season/weather cycling while tuning. This
// button multiplies ticks-per-interval rather than shrinking the interval
// itself, so TICK_INTERVALS_MS (and anything timing-sensitive around it)
// stays untouched — it's purely "run more simulated ticks per real second."
let fastForward = false;
const ffButton = document.createElement("button");
ffButton.type = "button";
ffButton.textContent = "Fast-forward: OFF";
ffButton.style.position = "fixed";
ffButton.style.bottom = "0.5rem";
ffButton.style.left = "0.5rem";
ffButton.style.zIndex = "1001";
ffButton.addEventListener("click", () => {
    fastForward = !fastForward;
    ffButton.textContent = fastForward ? "Fast-forward: ON (20x)" : "Fast-forward: OFF";
});
document.body.appendChild(ffButton);
// ============================================================================

if (SOURCE === "local") {
    setInterval(() => {
        // One tick at a time even in fast-forward, so updateTuningStats sees
        // each tick's own simTime + events (bucketing 20 ticks of deaths onto
        // one timestamp would skew every windowed readout on the dashboard).
        const ticksThisInterval = fastForward ? 20 : 1;
        for (let i = 0; i < ticksThisInterval; i++) {
            const result = step(state, 1);
            state = result.state;
            updateTuningStats(stats, state, result.events);
        }
    }, TICK_INTERVALS_MS);
} else {
    // Phase 6
}