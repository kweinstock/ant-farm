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

export type EnvState = {
    timeOfDay: TimeOfDay;
    dayOfYear: number;
    phase: number;
    season: Season;
    ambientTemp: number;
    weather: WeatherState;
    predator: Predator | null;
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
