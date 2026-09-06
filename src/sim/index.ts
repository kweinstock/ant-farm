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
//   4. sense -> decide -> move-toward-chamber / act-in-chamber (ants/*)
//   5. colony processes                   (colony/*)        queen laying, brood development, caste fate, nuptial flights
//   6. lifecycle resolution               (ants/lifecycle.ts) aging, starvation, death, job reassignment
//   7. genetics + lineage bookkeeping     (genetics/*)      offspring traits, family-tree edges, extinction marks
//   8. collect + return events
//
// PHASE 3a NOTE: steps 1-3 and 7 still don't exist. Steps 4 and 6 stay
// combined into one per-worker loop below, for the same reason as before
// (see ants/lifecycle.ts) — nothing yet needs a completed pass over all ants
// before resolving deaths. The queen is still not part of that loop; she's
// handled entirely by colony/queen.ts's tickQueen, as part of step 5.
import { ageAndMeter } from "./ants/lifecycle";
import { perceive } from "./ants/senses";
import { decide } from "./ants/behavior";
import { act } from "./ants/jobs";
import { tickQueen } from "./colony/queen";
import { advanceBrood } from "./colony/brood";
import { regenFoodStore } from "./world/resources";
import type { ColonyState } from "./state";
import type { AntId } from "./ants/ant";


export type DeathEvent = {
    kind: "death";
    antId: AntId;
    ageTicks: number;
};

export type BirthEvent = {
    kind: "birth";
    antId: AntId;
    ageTicks: number;
};

export type SimEvent = DeathEvent | BirthEvent;

type TickResult = {
    state: ColonyState;
    events: SimEvent[];
};

function singleTick(state: ColonyState): TickResult {
    const events: SimEvent[] = [];

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
            brood: actResult.brood,
            foodStore: actResult.foodStore,
            rngSeed: actResult.rngSeed,
        };
    }

    // Colony processes: queen laying, then brood development. Order matters
    // — advanceBrood should see any egg the queen just laid this tick.
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

    // advanceBrood's placement logic is unchanged — it just does less now
    // (no tendedThisTick gate), since brood.ts moved the real bottleneck to
    // whether an egg has been physically carried into the NURSERY.
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

    // Passive regen placeholder, replacing Phase 3's per-pile
    // regrowFoodPiles — still doesn't belong in environment/* until seasons
    // exist to scale it, still called directly here for the same reason as
    // before.
    const foodStore = regenFoodStore(currentState.foodStore);

    return {
        state: {
            ...currentState,
            seq: currentState.seq + 1,
            simTime: currentState.simTime + 1,
            foodStore,
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