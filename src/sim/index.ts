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
//   3.5 undertaker assignment             (corpses.ts)      assignUndertakers, run against tick-start
//                                                            corpses/ants before the worker loop below —
//                                                            a corpse created by THIS tick's deaths is
//                                                            picked up starting next tick, not this one
//   4. sense -> decide -> act, per worker (ants/*)          nest-side goto/mill/pickUpEgg/placeEgg/eat,
//                                                            or surface-side crossExit/pickUpFood/
//                                                            depositFood/surfaceStep/surfaceWander, or
//                                                            the undertaker round trip (moveToNestPoint/
//                                                            pickUpCorpse/dropCorpse/clearUndertaking) —
//                                                            act() branches internally on ant.location.where
//                                                            and ant.undertaking
//   5. colony processes                   (colony/*)        queen laying, brood development, caste fate, nuptial flights
//   6. lifecycle resolution               (ants/lifecycle.ts) aging, starvation, death, job reassignment —
//                                                            a death (worker OR queen) also drops a Corpse
//                                                            into state.corpses at this point (see below);
//                                                            if the dead ant was mid-haul as an undertaker,
//                                                            the corpse it was carrying is released
//                                                            (carriedBy cleared) rather than lost
//   7. world upkeep                       (world/surface.ts, spawnFoodPiles, ageFoodPiles, ageCorpses — renamed
//                                          corpses.ts)        from "surface world step": corpses aren't
//                                                            surface-only (most die and decay underground),
//                                                            so aging them alongside the surface's own
//                                                            spawn/decay step is bookkeeping, not a surface
//                                                            concern specifically
//   8. genetics + lineage bookkeeping     (genetics/*)      offspring traits, family-tree edges, extinction marks
//   9. collect + return events
//
// PHASE 3b NOTE: steps 1-3 and 8 still don't exist. Steps 4 and 6 stay
// combined into one per-worker loop below, same reasoning as before —
// nothing yet needs a completed pass over all ants before resolving deaths.
// The queen is still not part of that loop; she's handled entirely by
// colony/queen.ts's tickQueen, as part of step 5. She also never touches
// the surface, so nothing about this phase's location split applies to her.
//
// PHASE 3c NOTE: step 3.5 is new. It's deliberately its own step rather than
// folded into the step-4 loop, because assignUndertakers needs to see ALL
// workers and ALL corpses at once (it's a global proximity-weighted
// assignment, not a per-ant decision) — the step-4 loop below processes one
// worker at a time and couldn't compute that. The queen is never a
// candidate (assignUndertakers filters to caste === "WORKER"), consistent
// with her sitting outside the whole sense->decide->act loop already.
import { ageAndMeter } from "./ants/lifecycle";
import { perceive } from "./ants/senses";
import { decide } from "./ants/behavior";
import { act } from "./ants/jobs";
import { tickQueen } from "./colony/queen";
import { advanceBrood } from "./colony/brood";
import { spawnFoodPiles, ageFoodPiles } from "./world/surface";
import { createCorpse, ageCorpses, assignUndertakers } from "./corpses";
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

function recordDeath(corpses: ColonyState["corpses"], nextCorpseId: number, deadAnt: Parameters<typeof createCorpse>[0]): {corpses: ColonyState["corpses"]; nextCorpseId: number} {
    const withNewCorpse = [...corpses, createCorpse(deadAnt, `corpse-${nextCorpseId}`)];
    const released = withNewCorpse.some((corpse) => corpse.carriedBy === deadAnt.id) ? withNewCorpse.map((corpse) => corpse.carriedBy === deadAnt.id ? { ...corpse, carriedBy: undefined } : corpse) : withNewCorpse;
    return { corpses: released, nextCorpseId: nextCorpseId + 1 };
}

function singleTick(state: ColonyState): TickResult {
    const events: SimEvent[] = [];

    const undertakerAssignment = assignUndertakers(state);

    let currentState: ColonyState = {
        ...state,
        ants: undertakerAssignment.ants,
        rngSeed: undertakerAssignment.rngSeed,
    };

    const workers = Array.from(currentState.ants.values())
        .filter((ant) => ant.caste === "WORKER")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const worker of workers) {
        const {ant: metered, isDead} = ageAndMeter(worker);
        
        if (isDead) {
            const nextAnts = new Map(currentState.ants);
            nextAnts.delete(metered.id);

            const { corpses, nextCorpseId } = recordDeath(currentState.corpses, currentState.nextCorpseId, metered);

            currentState = {...currentState, ants: nextAnts, corpses, nextCorpseId};

            events.push({kind: "death", antId: metered.id, ageTicks: metered.ageTicks});
            continue;
        }

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
            surface: actResult.surface,
            corpses: actResult.corpses,
            rngSeed: actResult.rngSeed,
        };
    }

    if (currentState.ants.has(currentState.queenId)) {
        const broodCountBeforeQueen = currentState.brood.length;
        const queenResult = tickQueen(currentState);

        const nextAntsAfterQueen = new Map(currentState.ants);
        let corpses = currentState.corpses;
        let nextCorpseId = currentState.nextCorpseId;

        if (queenResult.isDead) {
            nextAntsAfterQueen.delete(currentState.queenId);
            ({ corpses, nextCorpseId } = recordDeath(corpses, nextCorpseId, queenResult.queen));

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
            corpses,
            nextCorpseId,
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

    const spawnResult = spawnFoodPiles(currentState.surface, currentState.rngSeed);
    const surface = ageFoodPiles(spawnResult.surface);
    const corpses = ageCorpses(currentState.corpses);

    return {
        state: {
            ...currentState,
            seq: currentState.seq + 1,
            simTime: currentState.simTime + 1,
            surface,
            corpses,
            rngSeed: spawnResult.seed,
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