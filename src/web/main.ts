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
// PHASE 12a/b: mountViews now hands back a sceneContainer (render/engine.ts's
// three.js cube lives there, not two flat canvases). This file also now
// tracks prevState + tickStartTime alongside state itself, purely so
// render/engine.ts can interpolate ant motion between ticks
// (state/interpolate.ts) — prevState is whatever `state` was immediately
// before the current setInterval callback's tick, tickStartTime is when
// that callback finished.
//
// PHASE 5: local mode used to throw away step()'s events entirely. Now
// every tick's events feed a TuningStats accumulator (below), which
// ui/dashboard-stats.ts reads for cumulative/windowed readouts state alone
// can't give it (deaths by cause, food delivered per trip, etc). TuningStats
// is plain mutable UI-side scratch state — never part of ColonyState, never
// replayed — so it's intentionally NOT held to the sim's pure-copy-modify
// discipline. NOTE for later: demography.ts's header already says it
// "feeds Stats DTO" — Phase 6 may promote some of this into the sim/DO
// properly; for now it's client-side only, rebuilt fresh on every page load.
//
// PHASE 12f: the one-off "Fast-forward" button (20 ticks/interval) that
// used to live here is gone — it was explicitly marked TEMPORARY, and the
// panel-system rework was the agreed point to actually remove it rather
// than migrate it into ui/control-panel.ts's dock.
import { createInitialState } from "../sim/state";
import { step } from "../sim";
import type { ColonyState } from "../sim/state";
import type { AntId } from "../sim/ants/ant";
import type { SimEvent, DeathEvent } from "../sim";
import { getDemography } from "../sim/colony/demography";
import type { FrameSource } from "./render/engine";
import { SOURCE, TICK_INTERVALS_MS } from "./config";
import { startRenderLoop } from "./render/engine";
import { mountViews } from "./ui/view-switch";
import { mountControlPanel } from "./ui/control-panel";
import { mountAntCard } from "./ui/ant-card";
import { mountNavBar } from "./ui/nav-bar";
import { mountPinnedTray } from "./ui/pinned-tray";
import { mountLoadingScreen } from "./ui/loading-screen";
import { createPinStore } from "./state/pins";
import { ColonyStreamClient, colonyStreamUrl } from "./net/socket";
import { PROTOCOL_VERSION } from "../shared/constants";
import { colonyStateFromSnapshot } from "./net/remote-state";
import type { Tally } from "../shared/tally";

const viewsContainer = document.getElementById("ant-farm-views");

if (!(viewsContainer instanceof HTMLElement)) {
    throw new Error('Expected a <div id="ant-farm-views"> element in index.html');
}

const { sceneContainer } = mountViews(viewsContainer);
const { renderOptions, onResetView, setScreen, openInfo, update: updateControlPanel } = mountControlPanel(viewsContainer);
// When the card moves on to a dead ant's heir, the camera goes with it.
// Pinned ants (client-only, in localStorage); a pin follows its ant's heir.
const pins = createPinStore();
const antCard = mountAntCard(viewsContainer, (id) => scene.focusAnt(id), () => scene.exitFocus(), pins);
const pinnedTray = mountPinnedTray(viewsContainer, pins, (id) => showAnt(id));
// The menu: screens (Colony / View / Pinned / About) with ant arrows on either side.
mountNavBar(viewsContainer, {
    onScreen: (screen) => {
        setScreen(screen === "pins" ? null : screen);
        pinnedTray.setOpen(screen === "pins");
        pinnedTray.render(state);
    },
    onAbout: openInfo,
    onCycle: (direction) => cycleAnt(direction),
});
// One call for everything that redraws on a sim update.
function updatePanel(state: ColonyState, stats: TuningStats): void {
    updateControlPanel(state, stats);
    antCard.update(state);
    pinnedTray.render(state);
}

// Fixed, same as scripts/print-sim.ts — deterministic while tuning behavior.
const seed = 12345;

let state = createInitialState(seed);
let prevState: ColonyState | undefined;
let tickStartTime = performance.now();

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

// Stream mode only: start the cumulative counters from the colony's lifetime
// totals (sent with every Snapshot — connect, or a resync after a drop), so a
// viewer who opens the page late sees the real numbers, not "0". Frames'
// events keep them current from there via updateTuningStats. lastFoodAmount is
// reset so the jump to the snapshot's store level doesn't count as a delivery.
function applyTally(stats: TuningStats, tally: Tally, state: ColonyState): void {
    stats.birthsTotal = tally.births;
    stats.deathsTotal = tally.deathsTotal;
    stats.deathsByCause = { ...tally.deathsByCause };
    stats.deathsByLocation = { ...tally.deathsByLocation };
    stats.forageDepartsTotal = tally.forageDeparts;
    stats.predatorStrikesTotal = tally.predatorStrikes;
    stats.foodDeliveredTotal = tally.foodDelivered;
    stats.lastFoodAmount = state.foodStore.amount;
    stats.tripDepartedAt.clear(); // a trip we only saw the start of before a resync can't be timed
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

const frameSource: FrameSource = {
    getPrev: () => prevState,
    getCurr: () => state,
    getTickStartTime: () => tickStartTime,
};

const scene = startRenderLoop(sceneContainer, frameSource, renderOptions, antCard.select);
onResetView(scene.resetCamera);
// The nav bar's arrows: step through the living ants in the order the colony lists
// them (queen first, then oldest to newest). Starts at the first/last ant when
// nothing is selected.
function cycleAnt(direction: 1 | -1): void {
    const ids = [...state.ants.keys()];
    if (ids.length === 0) {
        return;
    }
    const current = antCard.selected();
    const index = current === undefined ? -1 : ids.indexOf(current);
    const next =
        index === -1
            ? (direction === 1 ? 0 : ids.length - 1)
            : (index + direction + ids.length) % ids.length;
    showAnt(ids[next]);
}
// Select an ant, open its card and fly the camera to it.
function showAnt(id: AntId): void {
    antCard.select(id);
    antCard.update(state);
    scene.focusAnt(id);
}
scene.setPinnedAnts(pins.ids());
pins.subscribe(() => {
    scene.setPinnedAnts(pins.ids());
    pinnedTray.render(state);
});
updatePanel(state, stats);

if (SOURCE === "local") {
    setInterval(() => {
        const stateBeforeThisInterval = state;
        const result = step(state, 1);
        state = result.state;
        updateTuningStats(stats, state, result.events);
        prevState = stateBeforeThisInterval;
        tickStartTime = performance.now();
        pins.update(state);
        updatePanel(state, stats);
    }, TICK_INTERVALS_MS);
} else {
    // slots the local branch mutates above are mutated here instead — the
    // render loop and control panel below neither know nor care which
    // branch is feeding them.
    //
    // `baseState` supplies ONLY static geometry (grid/nest/surface shape)
    // that never crosses the wire — see remote-state.ts's header for why
    // that's safe. Everything else in every reconstructed frame is real
    // network data.
    const baseState = createInitialState(seed);

    // Until the first Snapshot arrives the scene is only that placeholder colony
    // (frozen ants), so cover it; it also comes back if the connection drops.
    const loading = mountLoadingScreen(viewsContainer);
    // True once the live stream is flowing for the current connection.
    let live = false;

    const client = new ColonyStreamClient(colonyStreamUrl(), {
        onHello: (hello) => {
            console.log(`[ant-farm] connected: protocol v${hello.protocolVersion}, colony "${hello.colonyId}"`);
            loading.show("loading");
        },
        onUpdate: (snapshot, events, tally) => {
            // Got the colony's state, but the ants only move once live frames
            // follow (onLive below): keep the screen up until then.
            if (!live) loading.show("syncing");
            const stateBeforeThisUpdate = state;
            state = colonyStateFromSnapshot(baseState, snapshot);
            // Snapshot (connect / resync): start the cumulative counters from the
            // colony's lifetime totals. Frames: their events keep counting.
            if (tally) applyTally(stats, tally, state);
            updateTuningStats(stats, state, events);
            prevState = stateBeforeThisUpdate;
            tickStartTime = performance.now();
            // Only ever called with real colony data (never the placeholder state
            // above), because the first look drops pins whose ant is gone.
            pins.update(state);
            updatePanel(state, stats);
        },
        onLive: () => {
            live = true;
            loading.hide();
        },
        onProtocolMismatch: (serverVersion) => {
            console.error(`[ant-farm] protocol mismatch: client v${PROTOCOL_VERSION}, server v${serverVersion}. Reload to pick up the new client.`);
            loading.showUpdateRequired();
        },
        onClose: () => {
            console.warn("[ant-farm] stream closed — reconnecting");
            live = false;
            loading.show("reconnecting");
        },
    });
    client.connect();
}