// ============================================================================
// params.ts — every tunable constant the simulation runs on, in one place.
//
// Flat named exports (not a nested object), so call sites are unchanged even
// if this file's own layout changes — only the import path would move,
// keeping any future migration a pure relocation with no behavior change.
// Re-exported from src/sim/index.ts.
//
// This file has two top-level sections:
//
//   OPTIMIZE          Economy/balance knobs that scripts/optimize-params.ts's
//                      genetic algorithm is allowed to search over and
//                      rewrite in place (see SEARCH_SPACE in that script).
//                      Every constant here MUST stay a bare
//                      `export const NAME = <number>;` (a trailing comment is
//                      fine) — applyGenome() finds and replaces these by an
//                      exact regex match on that shape, so reordering,
//                      renaming, or reformatting one of these lines breaks
//                      the optimizer silently (it throws loudly instead, but
//                      only the next time someone runs it).
//
//   DO NOT OPTIMIZE    Everything else: structural constants (grid/surface
//                      dimensions, world-generation layout, tile
//                      coordinates), and environment tables that describe
//                      what Global Ant Farm's world IS rather than how well
//                      it plays. The GA never touches these; changing one by
//                      hand can change the shape of the simulation itself,
//                      not just its balance.
//
// Inside each top-level section, constants are grouped into named
// sub-sections (queen & brood, pheromones, predator, etc.), and every
// constant carries a short inline comment on what it actually does.
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
// ============================================================================

import type { Season } from "./environment/season";
import type { WeatherKind } from "./environment/weather";

// ============================================================================
// OPTIMIZE
// ============================================================================

// ---- Queen & brood ----
export const BASE_LAY_PROBABILITY = 0.2068; // per-tick chance the queen lays an egg when otherwise eligible
export const POPULATION_SOFT_TARGET = 51; // lay probability tapers off as the live worker count approaches this

// ---- Jobs & nursing ----
export const NURSE_AGE_THRESHOLD_TICKS = 394; // workers younger than this default to NURSE, older to FORAGER
export const NURSE_BROOD_PER_NURSE = 12; // target brood-per-nurse ratio reassignJobs tries to hold
export const NURSE_LAY_HEADROOM = 2.2133; // extra nurse capacity kept above current brood, to absorb the queen's next lay

// ---- Pheromone trail ----
export const MAX_TRAIL = 597; // ceiling a trail cell's strength can accumulate to
export const EVAPORATION_FACTOR = 0.9714; // per-tick multiplicative decay applied to every trail cell
export const MIN_TRAIL = 7.8854; // floor below which a decaying trail cell snaps to zero
export const SPREAD_FRAC = 0.4986; // fraction of a deposit that also spreads into neighboring cells
export const FOLLOW_THRESHOLD = 25; // minimum trail strength before a forager will follow it over its own memory
export const DEPOSIT_AMOUNT = 73; // trail strength added per tick by a forager laying scent

// ---- Alarm trail ----
export const ALARM_MAX = 473; // ceiling an alarm cell's strength can accumulate to
export const ALARM_EVAPORATION_FACTOR = 0.6115; // per-tick multiplicative decay applied to every alarm cell (faster than the food trail's)
export const ALARM_DEPOSIT_AMOUNT = 132; // alarm strength deposited when an ant flees or witnesses a predator strike
export const ALARM_SPREAD_FRAC = 0.5174; // fraction of an alarm deposit that also spreads into neighboring cells
export const ALARM_FLEE_THRESHOLD = 69; // minimum alarm strength before a nearby ant breaks off to flee

// ---- Surface food piles ----
export const MAX_PILES = 53; // cap on distinct food pile tiles allowed on the surface at once
export const FOOD_PILE_START_AMOUNT = 378; // food units a freshly spawned pile starts with
export const FOOD_TILE_CAPACITY = 440; // ceiling a single pile tile can be topped back up to
export const PILE_SPAWN_CHANCE = 0.2366; // per-tick base chance of attempting to spawn or replenish a pile

// ---- Foraging memory ----
export const FORAGING_TRIP_FAILURE_TICKS = 150; // a trip running longer than this is scored as a failure for trust-weight learning
export const MAX_REMEMBERED = 4; // max food sites a single ant keeps in memory at once
export const MEMORY_TTL_TICKS = 300; // ticks a remembered food site stays valid before it's considered stale
export const EMPTY_PATCH_TTL_TICKS = 200; // ticks a patch stays marked "known empty" before an ant will re-explore it
export const MAX_EMPTY_PATCHES_REMEMBERED = 8; // max "known empty" patches a single ant keeps in memory at once

// ---- Teaching & learned trust ----
export const PATCH_QUALITY_EMA_ALPHA = 0.3; // smoothing factor for the exponential moving average tracking a patch's remembered quality
export const MAX_PREDATOR_SIGHTINGS = 5; // max predator sightings a single ant keeps in memory at once
export const PREDATOR_SIGHTING_TTL_TICKS = 500; // ticks a remembered predator sighting stays valid before it's considered stale
export const PATCH_QUALITY_RICHNESS_WEIGHT = 1.5; // weight a known patch-quality entry contributes to an ant's memory richness score
export const PREDATOR_SIGHTING_RICHNESS_WEIGHT = 1; // weight a fresh predator sighting contributes to an ant's memory richness score
export const ABSORB_MAX_TRANSFER = 2; // max entries of any one memory category transferred in a single teaching exchange
export const LEARNING_BASELINE = 1.0; // starting value for every per-ant learned trust weight
export const LEARNING_MIN = 0.2; // floor a learned trust weight can be reinforced down to
export const LEARNING_MAX = 3.0; // ceiling a learned trust weight can be reinforced up to
export const REINFORCE_STEP = 0.1; // amount a trust weight moves per reinforcement event
export const KNOWLEDGE_SHARE_CHANCE = 0.15; // per-tick, per-chamber-group chance that the richest ant present teaches its roommates

// ---- Colony-level decisions ----
export const DECISION_INTERVAL_TICKS = 400; // ticks between evaluateDecisions passes considering colony-level proposals
export const DECISION_THRESHOLD = 0.6; // minimum score a proposal must clear to be committed
export const GRAVEYARD_THREAT_RADIUS = 15; // distance within which the predator counts as threatening the graveyard
export const GRAVEYARD_THREAT_INCREMENT = 1; // per-tick increase to graveyardThreat while the predator is within GRAVEYARD_THREAT_RADIUS
export const GRAVEYARD_THREAT_DECAY = 0.98; // per-tick multiplicative decay applied to graveyardThreat while the predator is elsewhere
export const GRAVEYARD_THREAT_CAP = 150; // ceiling graveyardThreat can accumulate to
export const NURSERY_COLD_TEMP = 8; // average nursery temperature below which a cold-expansion proposal can fire
export const NURSERY_COLD_SCALE = 10; // degrees of deficit below NURSERY_COLD_TEMP needed to fully saturate that proposal's score
export const FOOD_STORE_TRAVEL_THRESHOLD = 35; // average food-store-to-exit distance beyond which a relocation proposal can fire
export const FOOD_STORE_TRAVEL_SCALE = 20; // tiles of distance beyond FOOD_STORE_TRAVEL_THRESHOLD needed to fully saturate that proposal's score

// ============================================================================
// DO NOT OPTIMIZE
// ============================================================================

// ---- Nest / surface dimensions (structural — changing these needs layout regen) ----
export const GRID_WIDTH = 80; // width in tiles of the underground nest cross-section grid
export const GRID_HEIGHT = 60; // height in tiles of the underground nest cross-section grid
export const SURFACE_WIDTH = 100; // width in tiles of the top-down surface grid
export const SURFACE_HEIGHT = 72; // height in tiles of the top-down surface grid

// ---- Colony seed & starting economy ----
export const STARTER_WORKER_COUNT = 20; // workers alive at colony creation, alongside the queen
export const STARTING_FOOD_STORE = 5000; // food units the colony starts with in storage
export const FOOD_STORE_CAP = 15000; // ceiling on total stored food across all FOOD_STORAGE chambers
export const FORAGER_LOAD = 100; // food units a forager carries per successful pickup
export const EAT_AMOUNT = 40; // food units consumed from the store per "eat" action

// ---- Ant energy & lifespan ----
export const STARTING_ENERGY = 2500; // energy a newly hatched worker/queen starts with
export const MAX_ENERGY = 3000; // ceiling an ant's energy can be fed up to
export const HUNGER_THRESHOLD = 0.5; // energy/MAX_ENERGY ratio below which an ant is considered hungry and seeks food
export const MIN_LIFESPAN_TICKS = 1000; // shortest possible rolled lifespan for a worker (when sim starts 108000)
export const MAX_LIFESPAN_TICKS = 3000; // longest possible rolled lifespan for a worker (when sim starts 378000)
export const QUEEN_MIN_LIFESPAN_TICKS = 6000; // shortest possible rolled lifespan for the queen (when sim starts 10800000)
export const QUEEN_MAX_LIFESPAN_TICKS = 9000; // longest possible rolled lifespan for the queen (when sim starts 16200000)
export const METABOLISM_COST = 1; // energy a worker burns per tick just being alive

// ---- Jobs, castes, movement, senses ----
export const NURSERY_TILE_CAPACITY = 3; // max eggs/larvae/pupae a single nursery tile can hold at once
export const NURSE_EGG_CAPACITY = 5; // max eggs a nurse can be ferrying/tending at once
export const SIGHT_RADIUS = 11; // tiles an ant can see/sense around itself
export const NOISE_PROBABILITY = 0.2; // chance a sensed signal (trail, pile, etc.) is dropped/ignored that tick, to keep movement from looking too perfect

// ---- Queen & brood ----
export const EGG_DURATION_TICKS = 30; // ticks an egg spends as EGG before advancing to LARVA
export const LARVA_DURATION_TICKS = 60; // ticks brood spends as LARVA before advancing to PUPA
export const PUPA_DURATION_TICKS = 50; // ticks brood spends as PUPA before eclosing into an adult
export const QUEEN_METABOLISM_COST = 0.25; // energy the queen burns per tick just being alive
export const QUEEN_HUNGER_RATIO = 0.5; // energy/MAX_ENERGY ratio below which the queen signals she needs feeding
export const QUEEN_STEP_INTERVAL_TICKS = 60; // ticks between the queen's own tickQueen decision passes
export const TEND_INTERVAL_TICKS = 40; // ticks between a nurse's brood-tending passes on placed larvae/pupae
export const TEND_STALL_TICKS = 60; // ticks brood can go untended before its development stalls
export const TEND_DEATH_TICKS = 150; // ticks brood can go untended before it dies from neglect


// ---- Surface food piles (world-generation cadence, not economy tuning) ----
export const PILE_DECAY_TICKS = 400; // ticks a food pile can sit un-topped-up before it decays away entirely
export const HOLE_EXCLUSION_RADIUS = 6; // minimum distance from the surface hole that a pile/obstacle/graveyard may spawn
export const MAX_SPAWN_ATTEMPTS = 20; // rejection-sampling attempts allowed per spawn roll before giving up for that tick

// ---- Fertile patches & surface obstacles ----
export const FERTILE_PATCHES = [
    { x0: 24, y0: 10, x1: 31, y1: 17 }, // NW
    { x0: 46, y0: 8, x1: 53, y1: 15 },  // N
    { x0: 68, y0: 10, x1: 75, y1: 17 }, // NE
    { x0: 76, y0: 30, x1: 83, y1: 37 }, // E
    { x0: 68, y0: 52, x1: 75, y1: 59 }, // SE
    { x0: 46, y0: 54, x1: 53, y1: 61 }, // S
    { x0: 24, y0: 52, x1: 31, y1: 59 }, // SW
    { x0: 16, y0: 31, x1: 23, y1: 38 }, // W
]; // fixed rects marking the ring of fertile ground patches food piles are biased to spawn in

export const PATCH_SPAWN_BIAS = 0.8; // chance a pile spawn roll targets a fertile patch over open ground
export const PATCH_EXPLORE_RADIUS = 2; // tiles around a patch's edge an ant will still treat as "part of the patch" for exploration purposes

// ---- Forest floor (surface obstacle generation) ----
export const FOREST_CLUMP_SCALE = 10; // lattice spacing (in tiles) of the broad value-noise octave shaping forest clumping
export const FOREST_DETAIL_SCALE = 2.5; // lattice spacing (in tiles) of the fine value-noise octave shaping forest detail
export const FOREST_SEED_BASE = 0.05; // baseline per-tile probability of seeding tree/rock cover
export const FOREST_SEED_VARIATION = 0.03; // amount the noise field can push FOREST_SEED_BASE up or down
export const PATCH_CLEARING_FACTOR = 0.25; // multiplier reducing forest-seed chance inside a fertile patch, so patches stay open
export const ROCK_FRACTION = 0.3; // of tiles that seed cover, the fraction that become a single ROCK instead of a 2x2 TREE canopy

// ---- Corpses & undertaking ----
export const UNDERTAKER_PER_CORPSE = 0.5; // desired undertakers per unclaimed corpse, scaling the assignment pass
export const MAX_UNDERTAKER_FRACTION = 0.3; // cap on the fraction of the workforce that can be undertaking at once
export const CORPSE_DECAY_TICKS = 600; // ticks a corpse can exist before it decays away entirely
export const CORPSE_PER_GRAVE_TILE = 2; // corpses a single graveyard tile can hold before graveyardSlot prefers a different tile

// ---- Surface hazard (base layer under the predator) ----
export const SURFACE_DEATH_CHANCE = 0.0004; // base per-tick chance of a random fatal hazard for an ant on the surface
export const WANDER_EXPOSURE = 2.5; // multiplier on SURFACE_DEATH_CHANCE while an ant is aimlessly wandering rather than on task

// ---- Clock ----
export const DAY_LENGTH_TICKS = 1000; // ticks in one full day/night cycle (when sim starts 54000)
export const DAWN_START = 0.2; // fraction of the day at which dawn begins
export const DAY_START = 0.3; // fraction of the day at which full daytime begins
export const DUSK_START = 0.75; // fraction of the day at which dusk begins
export const NIGHT_START = 0.85; // fraction of the day at which full night begins

// ---- Calendar ----
export const DAYS_PER_SEASON = 2; // days that make up one season (when sim starts 40)
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4; // days that make up one full year cycle

// ---- Weather ----
// Markov transition chances: current season -> current weather -> next
// weather -> probability. Authored by hand, one full row per season/weather
// pair, so the RNG cadence and outcome are exactly reproducible — see the
// DETERMINISM note at the top of this file.
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
    // shortest a weather kind can last once it starts, in ticks
    CLEAR: 60, RAIN: 40, WIND: 30, HEAT: 40, SNOW: 50,
};
export const WEATHER_MAX_DURATION: Record<WeatherKind, number> = {
    // longest a weather kind can last once it starts, in ticks
    CLEAR: 200, RAIN: 120, WIND: 80, HEAT: 100, SNOW: 150,
};
export const FORECAST_LENGTH = 3; // number of upcoming weather kinds exposed in the forecast

// ---- Temperature ----
export const BASE_TEMP: Record<Season, number> = {
    // daytime ambient temperature baseline per season, in degrees
    SPRING: 15, SUMMER: 28, AUTTMN: 12, WINTER: -2,
};
export const NIGHT_TEMP_DROP = 8; // degrees subtracted from ambient temp during full night
export const DUSK_TEMP_DROP = 3; // degrees subtracted from ambient temp during dusk
export const WEATHER_TEMP_MOD: Record<WeatherKind, number> = {
    // degrees each weather kind adds to or subtracts from ambient temp
    CLEAR: 0, RAIN: -3, WIND: -2, HEAT: 8, SNOW: -10,
};
export const DEPTH_GRADIENT_PER_ROW = 0.6; // degrees warmer per row of depth underground, moving away from surface temp
export const UNDERGROUND_STABLE_TEMP = 13; // temperature deep underground converges toward, regardless of surface weather

// ---- Cold death ----
export const COLD_DEATH_TEMP = -5; // temperature at/below which the cold-death roll can start killing ants
export const COLD_DEATH_CHANCE_AT_ZERO = 0.0002; // per-tick death chance added per degree below COLD_DEATH_TEMP

// ---- Predator ----
export const PREDATOR_APPEAR_CHANCE = 0.0003; // base per-tick chance of a predator spawning when none is present
export const PREDATOR_SEASON_MULT: Record<Season, number> = {
    // multiplier on PREDATOR_APPEAR_CHANCE per season
    SPRING: 1, SUMMER: 1.3, AUTTMN: 1, WINTER: 0.4,
};
export const PREDATOR_WEATHER_MULT: Record<WeatherKind, number> = {
    // multiplier on PREDATOR_APPEAR_CHANCE per current weather kind
    CLEAR: 1, RAIN: 0.5, WIND: 0.8, HEAT: 1, SNOW: 0.3,
};

export const PREDATOR_VISION_RADIUS = 8; // tiles within which the predator can notice and start hunting an ant
export const PREDATOR_STRIKE_RANGE = 1; // tiles within which the predator can attempt a kill strike
export const PREDATOR_STRIKE_CHANCE = 0.4; // chance a strike within range actually kills the target
export const PREDATOR_HUNT_PATIENCE_TICKS = 15; // ticks the predator will keep chasing a target it hasn't caught before giving up
export const PREDATOR_HUNT_COOLDOWN_TICKS = 25; // ticks the predator must wait after a hunt ends before starting a new one
export const PREDATOR_HOME_THREAT_RADIUS = 6; // radius around her spawn/home the predator treats as her hunting ground
export const PREDATOR_FLEE_AVOID_RADIUS = 3; // radius a fleeing ant tries to keep between itself and the predator
export const SPOOK_COOLDOWN_TICKS = 120; // ticks an ant stays "spooked" (avoiding a recent predator sighting) before settling
export const GRAVEYARD_ATTRACTION_MULT = 0.05; // per-corpse pull the graveyard exerts on the predator's roam target

// ---- Season scalars ----
export const SEASON_FORAGE_ABUNDANCE: Record<Season, number> = {
    // multiplier on food-pile spawn abundance per season
    SPRING: 1.2, SUMMER: 1, AUTTMN: 0.9, WINTER: 0.3,
};
export const SEASON_LAY_FACTOR: Record<Season, number> = {
    // multiplier on the queen's lay probability per season
    SPRING: 1.3, SUMMER: 1, AUTTMN: 0.8, WINTER: 0.2,
};
export const SEASON_BROOD_SPEED: Record<Season, number> = {
    // multiplier on brood development speed per season
    SPRING: 1.1, SUMMER: 1, AUTTMN: 0.9, WINTER: 0.6,
};

// ---- Weather effects ----
export const RAIN_EVAPORATION_FACTOR = 0.85; // replaces EVAPORATION_FACTOR for the food trail while it's raining
export const WIND_EXPOSURE_MULT = 1.5; // multiplier on surface hazard exposure while it's windy
export const RAIN_EXPOSURE_MULT = 1.3; // multiplier on surface hazard exposure while it's raining

// ---- Sleep ----
export const SLEEPS_PER_DAY = 250; // number of sleep cycles a day is divided into, sizing SLEEP_CYCLE_TICKS
export const SLEEP_DURATION_TICKS = 1; // base ticks a sleep episode lasts before SLEEP_DEBT_MAX extends it
export const SLEEP_CYCLE_TICKS = DAY_LENGTH_TICKS / SLEEPS_PER_DAY; // ticks between an ant's sleep opportunities

export const QUEEN_SLEEP_MULT = 4; // multiplier on the queen's sleep duration relative to a worker's

export const SLEEP_METABOLISM_MULT = 0; // multiplier on METABOLISM_COST while asleep (0 = no energy burned while sleeping)

export const SLEEP_DEBT_MAX = 20; // cap on extra sleep ticks an overtired ant can accumulate and make up for

// ---- Digging ----
export const DIGGERS_PER_FRONTIER_TILE = 0.5; // desired diggers per open frontier tile on an active dig plan
export const MAX_DIGGER_FRACTION = 0.15; // cap on the fraction of the workforce that can be digging at once
export const DIG_PROGRESS_TICKS = 80; // ticks of dedicated digger effort required to convert one frontier tile
export const DIG_PLAN_TARGET_TILES = 24; // chamber tile count at which an active dig plan is considered complete
