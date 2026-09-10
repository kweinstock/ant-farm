// ALL balance constants in one place. Flat named exports (not a nested
// object) so call sites are unchanged — only the import path moves, which is
// what keeps this migration a pure relocation with no behavior change.
// Re-exported from src/sim/index.ts.
//
// DETERMINISM: every value here is a literal. WEATHER_MATRIX's rows must be
// authored by hand in a fixed key order — no Object.fromEntries, no .map,
// nothing computed. A given ColonyState always steps to exactly one next
// state regardless of how these numbers are set, which is what
// determinism.test.ts guards. Note that changing a *duration* constant
// (WEATHER_*_DURATION, PREDATOR_*_DURATION) shifts WHICH ticks consume an
// extra rng() call for a transition roll, so it re-phases the whole RNG
// stream from that point — a re-tuned run diverges from an old seed's run.
// That's expected; it's "different trajectory," not "non-deterministic."

// ---- Nest / surface dimensions (structural — changing these needs layout regen) ----
export const GRID_WIDTH = 80;
export const GRID_HEIGHT = 60;
export const SURFACE_WIDTH = 100;
export const SURFACE_HEIGHT = 72;

// ---- Colony seed & food economy ----
export const STARTER_WORKER_COUNT = 12;
export const STARTING_FOOD_STORE = 5000;
export const FOOD_STORE_CAP = 15000;
export const FORAGER_LOAD = 100;
export const EAT_AMOUNT = 50;

// ---- Ant energy & lifespan ----
export const STARTING_ENERGY = 2500;
export const MAX_ENERGY = 3000;
export const HUNGER_THRESHOLD = 0.5;
export const MIN_LIFESPAN_TICKS = 1000;
export const MAX_LIFESPAN_TICKS = 3000;
export const QUEEN_MIN_LIFESPAN_TICKS = 6000;
export const QUEEN_MAX_LIFESPAN_TICKS = 9000;
export const METABOLISM_COST = 1;

// ---- Jobs, castes, movement, senses ----
export const NURSE_AGE_THRESHOLD_TICKS = 150;
export const NURSERY_TILE_CAPACITY = 3;
export const NURSE_EGG_CAPACITY = 3;
export const SIGHT_RADIUS = 11;
export const NOISE_PROBABILITY = 0.2;

// Colony-level nurse allocation (colony/workforce.ts). Nurse count follows
// the brood, not age: one nurse per NURSE_BROOD_PER_NURSE brood, drawn
// oldest-first from the workforce, and never more nurses than foragers
// (capped at half the workers). assignJob still sets a worker's job for the
// one tick between eclosion and the next allocation pass.
export const NURSE_BROOD_PER_NURSE = 6;

// ---- Queen & brood ----
export const BASE_LAY_PROBABILITY = 0.3;
export const POPULATION_SOFT_TARGET = 30;
export const EGG_DURATION_TICKS = 30;
export const LARVA_DURATION_TICKS = 60;
export const PUPA_DURATION_TICKS = 50;
export const QUEEN_METABOLISM_COST = 0.25;
export const QUEEN_HUNGER_RATIO = 0.5;
export const QUEEN_STEP_INTERVAL_TICKS = 60;
export const TEND_INTERVAL_TICKS = 40;
export const TEND_STALL_TICKS = 60;
export const TEND_DEATH_TICKS = 150;

// ---- Foraging memory ----
export const MAX_REMEMBERED = 4;
export const MEMORY_TTL_TICKS = 300;
// A forager that reaches a patch and finds it bare records the patch as
// empty for this long, so it tries a *different* patch next trip instead of
// walking back to the same dry one. Shorter than MEMORY_TTL_TICKS — a patch
// refills faster than a specific pile stays put.
export const EMPTY_PATCH_TTL_TICKS = 200;
export const MAX_EMPTY_PATCHES_REMEMBERED = 8;

// ---- Pheromones ----
export const MAX_TRAIL = 500;
export const EVAPORATION_FACTOR = 0.95;
export const MIN_TRAIL = 1;
export const SPREAD_FRAC = 0.3;
export const FOLLOW_THRESHOLD = 5;
export const DEPOSIT_AMOUNT = 70;

// ---- Surface food piles ----
// Two knobs size the food on a tile: a fresh pile spawns holding
// FOOD_PILE_START_AMOUNT, and repeated spawns onto a tile that already has a
// pile top it up — never past FOOD_TILE_CAPACITY. So one tile holds at most
// the capacity, and the whole map at most MAX_PILES * FOOD_TILE_CAPACITY.
// (No patch-vs-open size split any more — patches stay the richer find only
// because PATCH_SPAWN_BIAS aims more spawns at them.)
export const MAX_PILES = 24;
export const FOOD_PILE_START_AMOUNT = 150;
export const FOOD_TILE_CAPACITY = 400;
export const PILE_SPAWN_CHANCE = 0.1;
export const PILE_DECAY_TICKS = 400;
export const HOLE_EXCLUSION_RADIUS = 6;
export const MAX_SPAWN_ATTEMPTS = 20;

// ---- Phase 7: fertile patches & surface obstacles ----
// Fertile clearings — small forage-rich pockets scattered through the
// forest, ringed around the centre hole and clear of the top-left graveyard
// (see surface.ts). Hand-authored, fixed order, not generated. 8 of them,
// 8x8, no overlap.
export const FERTILE_PATCHES = [
    { x0: 24, y0: 10, x1: 31, y1: 17 }, // NW
    { x0: 46, y0: 8, x1: 53, y1: 15 },  // N
    { x0: 68, y0: 10, x1: 75, y1: 17 }, // NE
    { x0: 76, y0: 30, x1: 83, y1: 37 }, // E
    { x0: 68, y0: 52, x1: 75, y1: 59 }, // SE
    { x0: 46, y0: 54, x1: 53, y1: 61 }, // S
    { x0: 24, y0: 52, x1: 31, y1: 59 }, // SW
    { x0: 16, y0: 31, x1: 23, y1: 38 }, // W
];

// Probability a spawn attempt targets a patch rect rather than the open
// forest floor. High — patches are the reliable food; the open map still
// gets a trickle so a forager caught far from one isn't stranded.
export const PATCH_SPAWN_BIAS = 0.8;

// ---- Forest floor (surface obstacles) ----
// createSurface walks every tile and rolls FOREST_SEED_BASE against a per-
// tile hash to decide "cover here?". The base is nudged by up to
// +/-FOREST_SEED_VARIATION by a two-octave value noise (CLUMP for the gentle
// regional ebb, DETAIL for local texture) — a narrow band, so the forest is
// evenly scattered with no map-spanning clearings or thickets. A seed
// becomes a 2x2 TREE canopy; where the 2x2 won't fit (map edge / hole radius
// / graveyard / an obstacle already there) or ROCK_FRACTION of the time
// instead, it's a single ROCK. Inside a fertile patch the seed chance is
// scaled by PATCH_CLEARING_FACTOR (patches read as clearings). createSurface
// then runs a connectivity repair that carves the minimum cover needed so
// every GROUND tile stays reachable from the hole (ecology.test.ts asserts
// this), and clears any canopy fragment the repair leaves behind — a tree
// is a full 2x2 or it's ground.
export const FOREST_CLUMP_SCALE = 10;
export const FOREST_DETAIL_SCALE = 2.5;
export const FOREST_SEED_BASE = 0.05;
export const FOREST_SEED_VARIATION = 0.03;
export const PATCH_CLEARING_FACTOR = 0.25;
export const ROCK_FRACTION = 0.3;

// ---- Corpses & undertaking ----
export const UNDERTAKER_PER_CORPSE = 0.5;
export const MAX_UNDERTAKER_FRACTION = 0.3;
export const CORPSE_DECAY_TICKS = 600;
export const CORPSE_PER_GRAVE_TILE = 2;

// ---- Surface hazard (Phase 4 orphans, now the base layer under the predator) ----
export const SURFACE_DEATH_CHANCE = 0.0004;
export const WANDER_EXPOSURE = 2.5;

// ==================== Environment (Phase 5) ====================

// ---- Clock ----
export const DAY_LENGTH_TICKS = 1000;
export const DAWN_START = 0.2;
export const DAY_START = 0.3;
export const DUSK_START = 0.75;
export const NIGHT_START = 0.85;

// ---- Calendar ----
export const DAYS_PER_SEASON = 2;
export const DAYS_PER_YEAR = 80;

// ---- Weather ----
import type { Season } from "./environment/season";
import type { WeatherKind } from "./environment/weather";
// Each row: next-weather-kind probabilities for (season, currentKind),
// hand-authored, keys in a fixed order. Rows need not sum to look "clean" —
// advanceWeather normalizes / walks a cumulative sum, whichever hazards.ts
// ends up doing — but they must always sum to 1 exactly as written here.
export const WEATHER_MATRIX: Record<Season, Record<WeatherKind, Record<WeatherKind, number>>> = {
    SPRING: {
        CLEAR: { CLEAR: 0.55, RAIN: 0.35, WIND: 0.1, HEAT: 0, SNOW: 0 },
        RAIN: { CLEAR: 0.5, RAIN: 0.4, WIND: 0.1, HEAT: 0, SNOW: 0 },
        WIND: { CLEAR: 0.6, RAIN: 0.2, WIND: 0.2, HEAT: 0, SNOW: 0 },
        HEAT: { CLEAR: 1, RAIN: 0, WIND: 0, HEAT: 0, SNOW: 0 },
        SNOW: { CLEAR: 1, RAIN: 0, WIND: 0, HEAT: 0, SNOW: 0 },
    },
    SUMMER: {
        CLEAR: { CLEAR: 0.6, RAIN: 0.15, WIND: 0.1, HEAT: 0.15, SNOW: 0 },
        RAIN: { CLEAR: 0.55, RAIN: 0.35, WIND: 0.1, HEAT: 0, SNOW: 0 },
        WIND: { CLEAR: 0.65, RAIN: 0.15, WIND: 0.2, HEAT: 0, SNOW: 0 },
        HEAT: { CLEAR: 0.5, RAIN: 0.05, WIND: 0.05, HEAT: 0.4, SNOW: 0 },
        SNOW: { CLEAR: 1, RAIN: 0, WIND: 0, HEAT: 0, SNOW: 0 },
    },
    AUTTMN: {
        CLEAR: { CLEAR: 0.55, RAIN: 0.3, WIND: 0.15, HEAT: 0, SNOW: 0 },
        RAIN: { CLEAR: 0.5, RAIN: 0.35, WIND: 0.15, HEAT: 0, SNOW: 0 },
        WIND: { CLEAR: 0.55, RAIN: 0.2, WIND: 0.25, HEAT: 0, SNOW: 0 },
        HEAT: { CLEAR: 1, RAIN: 0, WIND: 0, HEAT: 0, SNOW: 0 },
        SNOW: { CLEAR: 0.7, RAIN: 0, WIND: 0.1, HEAT: 0, SNOW: 0.2 },
    },
    WINTER: {
        CLEAR: { CLEAR: 0.5, RAIN: 0.05, WIND: 0.15, HEAT: 0, SNOW: 0.3 },
        RAIN: { CLEAR: 0.4, RAIN: 0.2, WIND: 0.1, HEAT: 0, SNOW: 0.3 },
        WIND: { CLEAR: 0.45, RAIN: 0.05, WIND: 0.2, HEAT: 0, SNOW: 0.3 },
        HEAT: { CLEAR: 1, RAIN: 0, WIND: 0, HEAT: 0, SNOW: 0 },
        SNOW: { CLEAR: 0.35, RAIN: 0, WIND: 0.1, HEAT: 0, SNOW: 0.55 },
    },
};
export const WEATHER_MIN_DURATION: Record<WeatherKind, number> = {
    CLEAR: 60, RAIN: 40, WIND: 30, HEAT: 40, SNOW: 50,
};
export const WEATHER_MAX_DURATION: Record<WeatherKind, number> = {
    CLEAR: 200, RAIN: 120, WIND: 80, HEAT: 100, SNOW: 150,
};
export const FORECAST_LENGTH = 3;

// ---- Temperature ----
export const BASE_TEMP: Record<Season, number> = {
    SPRING: 15, SUMMER: 28, AUTTMN: 12, WINTER: -2,
};
export const NIGHT_TEMP_DROP = 8;
export const DUSK_TEMP_DROP = 3;
export const WEATHER_TEMP_MOD: Record<WeatherKind, number> = {
    CLEAR: 0, RAIN: -3, WIND: -2, HEAT: 8, SNOW: -10,
};
export const DEPTH_GRADIENT_PER_ROW = 0.6;
export const UNDERGROUND_STABLE_TEMP = 13;

// ---- Cold death ----
export const COLD_DEATH_TEMP = -5;
export const COLD_DEATH_CHANCE_AT_ZERO = 0.0002; // per degree below COLD_DEATH_TEMP

// ---- Predator ----
export const PREDATOR_APPEAR_CHANCE = 0.0003;
export const PREDATOR_SEASON_MULT: Record<Season, number> = {
    SPRING: 1, SUMMER: 1.3, AUTTMN: 1, WINTER: 0.4,
};
export const PREDATOR_WEATHER_MULT: Record<WeatherKind, number> = {
    CLEAR: 1, RAIN: 0.5, WIND: 0.8, HEAT: 1, SNOW: 0.3,
};
export const PREDATOR_MIN_DURATION = 30;
export const PREDATOR_MAX_DURATION = 100;
export const PREDATOR_STRIKE_RADIUS = 4;
export const PREDATOR_STRIKE_CHANCE = 0.05;

// ---- Season scalars ----
export const SEASON_FORAGE_ABUNDANCE: Record<Season, number> = {
    SPRING: 1.2, SUMMER: 1, AUTTMN: 0.9, WINTER: 0.3,
};
export const SEASON_LAY_FACTOR: Record<Season, number> = {
    SPRING: 1.3, SUMMER: 1, AUTTMN: 0.8, WINTER: 0.2,
};
export const SEASON_BROOD_SPEED: Record<Season, number> = {
    SPRING: 1.1, SUMMER: 1, AUTTMN: 0.9, WINTER: 0.6,
};

// ---- Weather effects ----
export const RAIN_EVAPORATION_FACTOR = 0.85; // replaces EVAPORATION_FACTOR while raining
export const WIND_EXPOSURE_MULT = 1.5;
export const RAIN_EXPOSURE_MULT = 1.3;