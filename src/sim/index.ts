// Public surface of the simulation engine. This is the ONLY file the Worker
// imports from src/sim.
//
//   step(state, queuedInputs, dtTicks) -> { state, events }
//
// Pure and deterministic: no Date.now(), no Math.random(), no I/O. All time comes
// from dtTicks, all randomness from state.rngSeed (see rng.ts). Same inputs =>
// same output, which is what lets the Durable Object replay elapsed ticks after
// hibernation and what test/sim/determinism.test.ts asserts.
//
// Also re-exports: createInitialState, toSnapshot, diff, and the params object so
// callers touch one module.
//
// Tick order (implemented here, delegated to submodules):
//   1. apply queued visitor inputs        (inputs.ts)
//   2. advance environment                (environment/*)  clock, season, weather, temperature, hazards
//   3. pheromone diffuse + evaporate      (pheromones.ts)
//   4. per-ant sense -> decide -> act     (ants/*)          movement, foraging, brood care, building, defense
//   5. colony processes                   (colony/*)        queen laying, brood development, caste fate, nuptial flights
//   6. lifecycle resolution               (ants/lifecycle.ts) aging, starvation, death, job reassignment
//   7. genetics + lineage bookkeeping     (genetics/*)      offspring traits, family-tree edges, extinction marks
//   8. collect + return events
import { randomDirection } from "./rng";
import { type ColonyState } from "./state";
import { getNeighbors, type Position } from "./world/grid";

const METABOLISM_COST = 1;

// PHASE 1 NOTE: only one event variant exists so far. This union grows as
// later phases add Birth, WeatherChanged, etc. (see events.ts's stub).
export type DeathEvent = {
    kind: "death";
    ageTicks: number;
};

export type SimEvent = DeathEvent

type TickResult = {
    state: ColonyState;
    events: SimEvent[];
};

// Advances exactly ONE tick. `step()` below is just a loop over this — that
// split is what makes "one call with dtTicks=50" and "fifty calls with
// dtTicks=1" produce identical results (see the second determinism test):
// they're both just this same function called 50 times in a row.
function singleTick(state: ColonyState): TickResult {
    if (state.ant === null) {
        // HEADS UP: once the ant is dead, this branch returns `state`
        // completely unchanged — seq and simTime stop advancing too, not
        // just the ant. Fine while the ant is the only thing in the world,
        // but once environment/weather/season exist (Phase 5) those need to
        // keep ticking regardless of ant state, so this early-return will
        // need to become "skip ant logic, still advance the rest."
        return {
            state,
            events: [],
        };
    }

    const ageTicks = state.ant.ageTicks + 1;
    const energy = state.ant.energy - METABOLISM_COST;
    const isDead = energy <= 0 || ageTicks >= state.ant.lifespanTicks;

    if (isDead) {
        return {
            state: {
                ...state,
                seq: state.seq + 1,
                simTime: state.simTime + 1,
                ant: null,
            },
            events: [
                {
                    kind: "death",
                    ageTicks,
                },
            ],
        };
    }

    // Pick a direction, then check whether it actually lands on a valid
    // neighbor — if it doesn't (grid edge), the ant just stays put this tick
    // rather than re-rolling. Simple, but it means edge/corner tiles get an
    // implicit "wait" bias baked in (e.g. a corner ant has a 2-in-4 chance of
    // not moving, vs 0-in-4 in the open middle of the grid). Harmless with a
    // starting position in the center and a 10x10 grid, but worth knowing
    // once wander patterns matter (Phase 3+) — the fix would be to re-roll
    // among only the valid neighbors instead of the full direction set.
    const directionResult = randomDirection(state.rngSeed, false);
    const neighbors = getNeighbors(state.grid, state.ant.position.x, state.ant.position.y);

    const target: Position = {
        x: state.ant.position.x + directionResult.value.dx,
        y: state.ant.position.y + directionResult.value.dy,
    };

    const canMove = neighbors.some((neighbor) => neighbor.x === target.x && neighbor.y === target.y);
    const position = canMove ? target : state.ant.position;

    return {
        state: {
            ...state,
            seq: state.seq + 1,
            simTime: state.simTime + 1,
            rngSeed: directionResult.seed,
            ant: {
                ...state.ant,
                ageTicks,
                energy,
                position,
            },
        },
        events: [],
    };
}

export function step(state: ColonyState, dtTicks: number): TickResult {
    let currentState = state;
    const events: SimEvent[] = [];

    for (let i = 0; i < dtTicks; i++) {
        const result = singleTick(currentState);

        currentState = result.state;
        events.push(...result.events);
    }

    return {
        state: currentState,
        events,
    };
}