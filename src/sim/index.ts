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
//
// PHASE 3 NOTE: steps 1-3 and 7 still don't exist (no inputs, environment,
// pheromones, or genetics yet). Steps 4 and 6 are combined into one per-worker
// loop below rather than run as two separate passes — see ants/lifecycle.ts's
// file-level comment for exactly why that's safe for now and what breaks the
// equivalence later (Phase 5 hazards needing a completed pass before
// resolving deaths). The queen is NOT part of that per-ant loop; she's
// stationary and handled entirely by colony/queen.ts's tickQueen, called as
// part of step 5.
import { ageAndMeter } from "./ants/lifecycle";
import { perceive } from "./ants/senses";
import { decide } from "./ants/behavior";
import { act } from "./ants/jobs";
import { tickQueen } from "./colony/queen";
import { advanceBrood } from "./colony/brood";
import { regrowFoodPiles } from "./world/resources";
import type { ColonyState } from "./state";
import type { AntId } from "./ants/ant";


// PHASE 1 NOTE retired: DeathEvent now carries antId since there's more than
// one ant that can die. BirthEvent is new — the first event this sim can
// emit that represents growth rather than loss.
export type DeathEvent = {
    kind: "death";
    antId: AntId;
    ageTicks: number;
};

export type BirthEvent = {
    kind: "birth";
    antId: AntId;
    ageTicks: number;
}

export type SimEvent = DeathEvent | BirthEvent

type TickResult = {
    state: ColonyState;
    events: SimEvent[];
};

// Advances exactly ONE tick. `step()` below is just a loop over this — that
// split is what makes "one call with dtTicks=50" and "fifty calls with
// dtTicks=1" produce identical results.
function singleTick(state: ColonyState): TickResult {
    const events: SimEvent[] = [];

    // Sorted explicitly by id, not raw Map iteration order. Map insertion
    // order happens to be deterministic too, but sorting is what the
    // determinism contract actually calls for — it means swapping state.ants
    // for a different collection type later can't silently change which ant
    // acts first, which matters because rngSeed is threaded sequentially
    // across ants within this loop.
    const workers = Array.from(state.ants.values())
    .filter((ant) => ant.caste === "WORKER")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let currentState: ColonyState = state

    for (const worker of workers) {
        const {ant: metered, isDead} = ageAndMeter(worker);
        
        if (isDead) {
            const nextAnts = new Map(currentState.ants);
            nextAnts.delete(metered.id);
            currentState = {...currentState, ants: nextAnts};

            events.push({kind: "death", antId: metered.id, ageTicks: metered.ageTicks});
            continue;
        }

        // sense -> decide -> act, reading/writing currentState as it stands
        // after every previous worker this same tick — not a snapshot from
        // before the loop started. That's what makes ant #2 see ant #1's
        // already-updated resources/rngSeed, and is the seed-threading rule
        // applied across ants rather than across RNG calls within one ant.
        const perception = perceive(currentState, metered);
        const action = decide(metered, perception);
        const actResult = act(currentState, metered, action);

        const nextAnts = new Map(currentState.ants);
        nextAnts.set(metered.id, actResult.ant);

        currentState = {
            ...currentState,
            ants: nextAnts,
            resources: actResult.resources,
            brood: actResult.brood,
            rngSeed: actResult.rngSeed,
        };
    }

    // Colony processes: queen laying, then brood development. Order matters
    // here — advanceBrood should see any egg the queen just laid this tick
    // reflected in currentState.brood, so tickQueen runs first.
    //
    // Guard on the queen still being present: once a prior tick removed her
    // from state.ants and emitted her death, this block must be skipped
    // entirely. There's no succession yet (colony/caste.ts), so a queenless
    // colony just stops laying and lives out its remaining workers. Without
    // this guard, tickQueen returns an undefined `queen` every subsequent
    // tick and the `queenResult.queen.ageTicks` read below crashes.
    if (currentState.ants.has(currentState.queenId)) {
        const broodCountBeforeQueen = currentState.brood.length;
        const queenResult = tickQueen(currentState);

        const nextAntsAfterQueen = new Map(currentState.ants);
        if (queenResult.isDead) {
            nextAntsAfterQueen.delete(currentState.queenId);
            events.push({
                kind: "death",
                antId: currentState.queenId,
                ageTicks: queenResult.queen.ageTicks,
            });
        } else {
            nextAntsAfterQueen.set(currentState.queenId, queenResult.queen);
        }

        const queenLaidEgg = queenResult.brood.length > broodCountBeforeQueen;

        currentState = {
            ...currentState,
            ants: nextAntsAfterQueen,
            brood: queenResult.brood,
            nextBroodId: currentState.nextBroodId + (queenLaidEgg ? 1 : 0),
            rngSeed: queenResult.rngSeed,
        };
    }

    const broodResult = advanceBrood(currentState);

    const nextAntsAfterBrood = new Map(currentState.ants);
    for (const newAdult of broodResult.newAdults) {
        nextAntsAfterBrood.set(newAdult.id, newAdult);
        events.push({kind: "birth", antId: newAdult.id, ageTicks: newAdult.ageTicks});
    }

    currentState = {
        ...currentState,
        ants: nextAntsAfterBrood,
        brood: broodResult.brood,
        nextAntId: currentState.nextAntId + broodResult.newAdults.length,
        rngSeed: broodResult.rngSeed,
    };

    // Doesn't belong in environment/* yet — that module doesn't exist until
    // Phase 5 (seasons/weather scaling regrowth rates). Called directly here
    // for now; move this call once there's an environment step to fold it
    // into instead.
    const resources = regrowFoodPiles(currentState.resources);

    return {
        state: {
            ...currentState,
            seq: currentState.seq + 1,
            simTime: currentState.simTime + 1,
            resources,
        },
        events,
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