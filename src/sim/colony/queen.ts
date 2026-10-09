// Queen behavior: egg-laying rate as a function of food stores, temperature,
// season (peaks SPRING/SUMMER, near-zero WINTER), and queen age. Models stored
// sperm from the founding nuptial flight: a finite reserve that depletes over
// years. Fertilized egg -> female (worker/future queen); unfertilized -> male
// drone (haplodiploidy). Emits eggs into colony/brood.ts. QueenDied event when
// she reaches lifespan — colony then declines unless colony/caste.ts has raised
// a replacement.
//
// PHASE 3a: MAX_BROOD is gone. The nursery-tile cap (3 eggs/tile, enforced in
// ants/jobs.ts's placeEgg) plus the nurse-carrying cap (3/nurse, enforced in
// ants/behavior.ts) are the real ceiling on placed brood now — a colony-level
// brood cap on top of that would just be a second, disagreeing limit.

import { rng } from "../rng";
import { ageAndMeter } from "../ants/lifecycle";
import type { Ant } from "../ants/ant";
import type { AntLocation } from "../ants/ant";
import type { ColonyState } from "../state";
import { layEgg, type Brood } from "./brood";
import { allTilesOf, chamberIdAt } from "../world/nest";
import { getNeighbors, isPassable, manhattanDistance, type Position } from "../world/grid";
import { BASE_LAY_PROBABILITY, FOOD_STORE_LAY_HALT_RATIO, NURSERY_TILE_CAPACITY, NURSE_BROOD_PER_NURSE, NURSE_LAY_HEADROOM, POPULATION_SOFT_TARGET, QUEEN_STEP_INTERVAL_TICKS, SLEEP_CYCLE_TICKS, SLEEP_DURATION_TICKS, QUEEN_SLEEP_MULT } from "../params";
import { layFactor } from "../environment/season";

export type QueenTickResult = {
    brood: Brood[];
    queen: Ant;
    isDead: boolean;
    deathCause?: "oldAge" | "starvation";
    rngSeed: number;
};

function queenStep(state: ColonyState, chamberId: string, pos: Position, target: Position): Position {
    if (pos.x === target.x && pos.y === target.y) {
        return pos;
    }

    const neighbors = getNeighbors(state.grid, pos.x, pos.y).filter(
        (n) => isPassable(state.grid, n.x, n.y) && chamberIdAt(state.nest, n) === chamberId
    );

    if (neighbors.length === 0) {
        return pos;
    }

    let best = neighbors[0];
    let bestDist = manhattanDistance(best, target);
    for (let i = 1; i < neighbors.length; i++) {
        const d = manhattanDistance(neighbors[i], target);
        if (d < bestDist) {
            bestDist = d;
            best = neighbors[i];
        }
    }
    return best;
}

export function tickQueen(state: ColonyState): QueenTickResult {
    const queenBeforeTick = state.ants.get(state.queenId);

    if (!queenBeforeTick) {
        throw new Error(
            `tickQueen called with no queen ${state.queenId} in state.ants — caller must guard`
        );
    }

    const metered = ageAndMeter(queenBeforeTick);
    let queen = metered.ant;

    if (metered.isDead) {
        return {
            brood: state.brood,
            queen,
            isDead: true,
            deathCause: metered.cause,
            rngSeed: state.rngSeed,
        };
    }

    const queenCycle = SLEEP_CYCLE_TICKS * QUEEN_SLEEP_MULT;
    const queenSleepDuration = SLEEP_DURATION_TICKS * QUEEN_SLEEP_MULT;

    if (queen.asleep) {
        if (state.simTime >= queen.wakeAt) {
            queen = {...queen, asleep: false, ticksAwake: 0};
        }
    } else {
        // ticksAwake alone (see ants/behavior.ts's isSleepy) — not
        // + sleepPhase, which only seeded her starting ticksAwake at birth.
        const due = queen.ticksAwake % queenCycle >= queenCycle - queenSleepDuration;
        if (due) {
            queen = {...queen, asleep: true, wakeAt: state.simTime + queenSleepDuration, ticksAwake: 0};
        }
    }

    if (!queen.asleep && state.simTime % QUEEN_STEP_INTERVAL_TICKS === 0) {
        const chamberId = chamberIdAt(state.nest, queen.location.pos);
        const chamber = state.nest.chambers.find((c) => c.id === chamberId);

        if (chamber && chamber.tiles.length > 0) {
            const PATROL_TICKS = QUEEN_STEP_INTERVAL_TICKS * 20;
            const targetIndex = Math.floor(state.simTime / PATROL_TICKS) % chamber.tiles.length;
            const target = chamber.tiles[targetIndex]

            const newPos = queenStep(state, chamber.id, queen.location.pos, target);
            const location: AntLocation = {where: "nest", pos: newPos};
            queen = {...queen, location};
        }
    }

    const population = Math.max(state.ants.size, 1);
    // Squared, not linear: a colony at 2x POPULATION_SOFT_TARGET used to
    // still lay at half rate (target/pop = 0.5) — nowhere near enough of a
    // brake once per-ant death rates dropped low enough that population has
    // no other real ceiling short of a food-supply crash. Squaring it drops
    // that same 2x-over colony to a quarter rate, well before she's anywhere
    // near the point the surface can't feed. Still an asymptotic taper, not
    // a hard stop — a boom past target loses steam fast but keeps varying,
    // it doesn't just freeze at some fixed headcount.
    const populationFactor = (POPULATION_SOFT_TARGET / Math.max(population, POPULATION_SOFT_TARGET)) ** 2;

    const foodFactor = state.foodStore.amount / state.foodStore.capacity;
    const layProbability = BASE_LAY_PROBABILITY * populationFactor * layFactor(state.env.season) * foodFactor;

    // The taper above only ever slows her down, it never actually reaches
    // zero — so with the store already running low AND a population that's
    // already at/above what it's meant to support, every additional egg
    // she lays now is a future mouth the colony can least afford, right when
    // it can least afford it. This is the real circuit-breaker: a full stop
    // that only engages when BOTH signs of resource stress line up
    // together, not a fixed headcount ceiling — a colony that's small but
    // temporarily low on food, or one that's big but well-stocked, is still
    // free to keep laying and varying normally.
    const foodCritical = foodFactor < FOOD_STORE_LAY_HALT_RATIO && population >= POPULATION_SOFT_TARGET;

    // Roll unconditionally (keeps the RNG cadence identical whether or not the
    // nursery is full), then gate on capacity.
    const roll = rng(state.rngSeed);
    const nurseryCapacity = allTilesOf(state.nest, "NURSERY").length * NURSERY_TILE_CAPACITY;

    // The physical tile cap alone let her lay far faster than the CURRENT
    // nurse count could ever ferry+tend — workforce.ts's allocator responds
    // to brood load, but only after the fact, so a laying binge would already
    // have piled up a backlog of eggs the existing nurses can't touch before
    // some of it stalls/dies. Gate on nurse throughput too, using the same
    // per-nurse ratio the allocator itself targets, so she never lays the
    // colony further ahead of its nursing capacity than that ratio allows.
    let nurseCount = 0;
    for (const ant of state.ants.values()) {
        if (ant.caste === "WORKER" && ant.job === "NURSE") nurseCount += 1;
    }
    // NURSE_LAY_HEADROOM matters, not just a fudge factor: workforce.ts's
    // allocator sizes nurses off THIS tick's brood count, so a 1x cap here
    // (brood capped at exactly nurseCount * ratio) is a self-consistent trap
    // — 1 nurse supports exactly 6 brood, which in turn only ever justifies
    // 1 nurse, forever. Found in review: a colony would settle at 1 nurse /
    // 6 brood permanently and stop growing. Capping at a multiple of current
    // capacity instead leaves room for brood to grow past what today's
    // nurses handle, which is what pulls the allocator into assigning more
    // next tick — the cap still throttles the queen well below the old
    // unconstrained nursery-tile cap, it just isn't pinned to a fixed point.
    // Floor of one nurse's worth even at nurseCount === 0: workforce.ts only
    // ever allocates a nurse once there's brood to justify one
    // (desiredNurseCount(0, W) = 0), so a hard `nurseCount * ratio` cap would
    // deadlock the colony the instant brood ever hits zero — nothing could
    // lay the egg that would bring the first nurse back. This still throttles
    // her to the real ratio everywhere else; it only guarantees the one egg
    // that restarts the cycle.
    const nurseCapacity = Math.max(nurseCount * NURSE_BROOD_PER_NURSE * NURSE_LAY_HEADROOM, NURSE_BROOD_PER_NURSE);

    const shouldLay =
        !queen.asleep &&
        !foodCritical &&
        roll.value < layProbability &&
        state.brood.length < Math.min(nurseryCapacity, nurseCapacity);

    const brood = shouldLay ? [...state.brood, layEgg(state)] : state.brood;

    return {
        brood,
        queen,
        isDead: false,
        rngSeed: roll.seed,
    };
}
