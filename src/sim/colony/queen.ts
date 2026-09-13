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
import { BASE_LAY_PROBABILITY, NURSERY_TILE_CAPACITY, POPULATION_SOFT_TARGET, QUEEN_STEP_INTERVAL_TICKS, SLEEP_CYCLE_TICKS, SLEEP_DURATION_TICKS, QUEEN_SLEEP_MULT } from "../params";
import { layFactor } from "../environment/season";

export type QueenTickResult = {
    brood: Brood[];
    queen: Ant;
    isDead: boolean;
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
    const populationFactor = POPULATION_SOFT_TARGET / Math.max(population, POPULATION_SOFT_TARGET);

    // Still no foodFactor. It's a real forager-stocked economy as of 3b, but
    // the 10k probe showed the store sits near-full (foragers out-deliver
    // consumption) and the colony stays bounded on populationFactor alone —
    // adding a lay-rate brake now would just destabilise a working balance
    // for no benefit. Phase 4 revisits it, where weather/season give a
    // foodFactor something real to respond to.
    const foodFactor = state.foodStore.amount / state.foodStore.capacity;
    const layProbability = BASE_LAY_PROBABILITY * populationFactor * layFactor(state.env.season) * foodFactor;

    // Roll unconditionally (keeps the RNG cadence identical whether or not the
    // nursery is full), then gate on capacity.
    const roll = rng(state.rngSeed);
    const nurseryCapacity = allTilesOf(state.nest, "NURSERY").length * NURSERY_TILE_CAPACITY;
    const shouldLay = !queen.asleep && roll.value < layProbability && state.brood.length < nurseryCapacity;

    const brood = shouldLay ? [...state.brood, layEgg(state)] : state.brood;

    return {
        brood,
        queen,
        isDead: false,
        rngSeed: roll.seed,
    };
}
