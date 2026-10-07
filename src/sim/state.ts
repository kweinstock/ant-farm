// PHASE 3b: the sim now spans two coordinate spaces. state.grid/state.nest is
// still the underground cross-section; state.surface (world/surface.ts) is
// the new top-down foraging ground. Every Ant (queen included, for a uniform
// record) now carries `location: { where: "nest" | "surface"; pos }` instead
// of a bare `position` — see ants/ant.ts. The queen's `where` is always
// "nest"; only foragers ever set it to "surface".

import { createStarterNest, chambersOf, allTilesOf, type Chamber, type Nest } from "./world/nest";
import type { Position } from "./world/grid";
import { createSurface, type Surface } from "./world/surface";
import type { Grid } from "./world/grid";
import { type Ant, type AntId, createQueen, createWorker } from "./ants/ant";
import type { Brood } from "./colony/brood";
import type { Corpse } from "./corpses";
import { FOOD_STORE_CAP, GRID_HEIGHT, GRID_WIDTH, STARTER_WORKER_COUNT, STARTING_FOOD_STORE, SURFACE_HEIGHT, SURFACE_WIDTH } from "./params";
import type { TimeOfDay } from "./environment/clock";
import { timeOfDay, dayOfYear, phaseOfDay } from "./environment/clock";
import type { Season } from "./environment/season";
import { seasonOf } from "./environment/season";
import type { WeatherState } from "./environment/weather";
import { initialWeather } from "./environment/weather";
import type { Predator } from "./environment/hazards";
import { ambientTemp } from "./environment/temperature";
import type { WeatherKind } from "./environment/weather";
import type { DigPlan } from "./colony/decisions";
import type { AntDTO, BroodDTO, CorpseDTO, SnapshotDTO } from "../shared/protocol";

export type EnvState = {
    timeOfDay: TimeOfDay;
    dayOfYear: number;
    phase: number;
    season: Season;
    ambientTemp: number;
    weather: WeatherState;
    predator: Predator | null;
    graveyardThreat: number;
};

// Test/debug scaffolding, NOT a normal gameplay path. When present on
// ColonyState, advanceEnvironment (index.ts) pins these instead of letting
// the clock/Markov chain drive them — used by balance.test.ts to hold the
// sim in glut / drought / harsh winter / constant-predator conditions
// without simulating tens of thousands of ticks to reach a real winter.
// Left undefined in createInitialState's normal call, so it has zero effect
// on determinism or (later) serialization.
export type ClimateOverride = {
    season?: Season;
    weather?: WeatherKind;
    predatorAlways?: boolean;
};

export type ColonyState = {
    seq: number;
    simTime: number;
    rngSeed: number;
    grid: Grid;
    nest: Nest;
    surface: Surface;
    env: EnvState;
    ants: Map<AntId, Ant>;
    nextAntId: number;
    nextBroodId: number;
    queenId: AntId;
    brood: Brood[];
    corpses: Corpse[];
    nextCorpseId: number;
    foodStore: { amount: number; capacity: number };
    climateOverride?: ClimateOverride;
    pendingDigPlan?: DigPlan;
};

function chamberCenter(chamber: Chamber): Position {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const tile of chamber.tiles) {
        minX = Math.min(minX, tile.x);
        maxX = Math.max(maxX, tile.x);
        minY = Math.min(minY, tile.y);
        maxY = Math.max(maxY, tile.y);
    }

    return {
        x: Math.floor((minX + maxX) / 2),
        y: Math.floor((minY + maxY) / 2),
    }
}

export function createInitialState(seed: number, climateOverride?: ClimateOverride): ColonyState {
    const {grid, nest} = createStarterNest(GRID_WIDTH, GRID_HEIGHT);
    const surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);

    const ants = new Map<AntId, Ant>();
    let nextAntId = 1;
    let currentSeed = seed;

    const queenId = `queen-ant-${nextAntId++}`;
    const queenChamber = chambersOf(nest, "QUEEN")[0];
    const queenStart: Position = queenChamber ? chamberCenter(queenChamber) : {x: 0, y: 0};
    const queen = createQueen(queenId, queenStart, currentSeed)
    currentSeed = queen.seed;
    ants.set(queenId, queen.ant);

    const commonTiles = allTilesOf(nest, "COMMONS");

    for (let i = 0; i < STARTER_WORKER_COUNT; i++) {
        const workerId = `ant-${nextAntId++}`;
        const worker = createWorker(workerId, commonTiles[i % commonTiles.length], currentSeed);
        currentSeed = worker.seed;
        ants.set(workerId, worker.ant);
    }

    const simTime = 0;
    const season = climateOverride?.season ?? seasonOf(simTime);
    const { weather: rolledWeather, seed: envSeed } = initialWeather(currentSeed);
    currentSeed = envSeed;
    const weather: WeatherState = climateOverride?.weather
        ? { kind: climateOverride.weather, ticksRemaining: rolledWeather.ticksRemaining, forecast: [] }
        : rolledWeather;
    const env: EnvState = {
        timeOfDay: timeOfDay(simTime),
        dayOfYear: dayOfYear(simTime),
        phase: phaseOfDay(simTime),
        season,
        ambientTemp: ambientTemp(season, timeOfDay(simTime), weather.kind),
        weather,
        predator: null,
        graveyardThreat: 0,
    };

    return {
        seq: 0,
        simTime: 0,
        rngSeed: currentSeed,
        grid,
        nest,
        surface,
        env,
        ants,
        nextAntId,
        nextBroodId: 1,
        queenId,
        brood: [],
        corpses: [],
        nextCorpseId: 1,
        foodStore: {
            amount: STARTING_FOOD_STORE,
            capacity: FOOD_STORE_CAP,
        },
        climateOverride,
    };
}

// ---- Snapshot projection (PHASE 13) ----
//
// Converts a live ColonyState into the flat, JSON-safe SnapshotDTO defined in
// shared/protocol.ts. This is what actually goes over the wire — never
// JSON.stringify(state) itself, which would silently mangle `ants` (a Map)
// and `nest.distanceFields` (Int16Array per chamber; also routing-internal,
// not something the client renders, so it's dropped here rather than
// projected).
//
// Deliberately naive/hand-rolled: rebuilds the full array every call, no
// memoization. Fine for a projection that runs once per tick server-side
// (src/worker/broadcast.ts calls it before and after each alarm's step() to
// diff the two). A real binary encoding for DO storage is a separate
// concern — see src/sim/serialize.ts's header note — and is Phase 14, not this.
export function toSnapshot(state: ColonyState): SnapshotDTO {
    const ants: AntDTO[] = [];
    for (const ant of state.ants.values()) {
        ants.push({
            id: ant.id,
            name: ant.name,
            caste: ant.caste,
            job: ant.job,
            where: ant.location.where,
            x: ant.location.pos.x,
            y: ant.location.pos.y,
            carryingFood: ant.carryingFood,
            carryingBroodCount: ant.carrying.length,
            energy: ant.energy,
            ageTicks: ant.ageTicks,
            asleep: ant.asleep,
            lifespanTicks: ant.lifespanTicks,
            undertaking: ant.undertaking?.corpseId,
        });
    }

    const brood: BroodDTO[] = state.brood.map((b) => ({
        id: b.id,
        stage: b.stage,
        x: b.position.x,
        y: b.position.y,
        carriedBy: b.carriedBy,
    }));

    const corpses: CorpseDTO[] = state.corpses.map((c) => ({
        id: c.id,
        where: c.location.where,
        x: c.location.pos.x,
        y: c.location.pos.y,
        carriedBy: c.carriedBy,
    }));

    return {
        seq: state.seq,
        simTime: state.simTime,
        queenId: state.queenId,
        ants,
        brood,
        corpses,
        foodPiles: state.surface.foodPiles.map((p) => ({
            id: p.id,
            x: p.pos.x,
            y: p.pos.y,
            amount: p.amount,
            capacity: p.capacity,
        })),
        foodStore: { amount: state.foodStore.amount, capacity: state.foodStore.capacity },
        graveyard: { ...state.surface.graveyard },
        env: {
            season: state.env.season,
            weather: state.env.weather.kind,
            timeOfDay: state.env.timeOfDay,
            ambientTemp: state.env.ambientTemp,
            dayOfYear: state.env.dayOfYear,
            phase: state.env.phase,
            weatherTicksRemaining: state.env.weather.ticksRemaining,
            weatherForecast: [...state.env.weather.forecast],
            predator: state.env.predator
                ? {
                    x: state.env.predator.pos.x,
                    y: state.env.predator.pos.y,
                    huntingAntId: state.env.predator.huntingAntId,
                }
                : null,
        },
    };
}
