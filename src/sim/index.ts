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
//                                                            and ant.undertaking. A forager's first
//                                                            nest->surface crossExit this tick also emits
//                                                            ForageDepartEvent (see below).
//   5. colony processes                   (colony/*)        queen laying, brood development, caste fate, nuptial flights
//   6. lifecycle resolution               (ants/lifecycle.ts, this file) aging, starvation, old-age death,
//                                                            job reassignment, PLUS (PHASE 4) a per-tick
//                                                            surface hazard roll (SURFACE_DEATH_CHANCE) for
//                                                            any worker still alive and standing on the
//                                                            surface after ageAndMeter — ageAndMeter itself
//                                                            stays RNG-free (ants/lifecycle.ts), so this
//                                                            file rolls that second way to die itself and
//                                                            threads the seed. Either death path drops a
//                                                            Corpse into state.corpses at this point; if the
//                                                            dead ant was mid-haul as an undertaker, the
//                                                            corpse it was carrying is released (carriedBy
//                                                            cleared) rather than lost. DeathEvent now
//                                                            records `where` the ant died.
//   7. world upkeep                       (world/surface.ts spawnFoodPiles/ageFoodPiles, corpses.ts
//                                                            ageCorpses, pheromones.ts evaporate) — renamed
//                                                            from "surface world step": neither corpses nor
//                                                            (now) the trail are surface-only concerns
//                                                            specifically, they just happen to live on
//                                                            state.surface/state.corpses and age/decay on
//                                                            their own schedules alongside piles
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
import { advanceBrood, type BroodLostEvent } from "./colony/brood";
import { reassignJobs } from "./colony/workforce";
import { spreadKnowledge } from "./colony/knowledge";
import { evaluateDecisions } from "./colony/decisions";
import { assignDiggers } from "./colony/digging";
import { spawnFoodPiles, ageFoodPiles, inGraveyard } from "./world/surface";
import { createCorpse, ageCorpses, assignUndertakers } from "./corpses";
import { evaporate } from "./pheromones";
import { rng } from "./rng";
import type { ColonyState } from "./state";
import type { AntId } from "./ants/ant";
import { manhattanDistance, type Position } from "./world/grid";
import { SURFACE_DEATH_CHANCE, WANDER_EXPOSURE, RAIN_EXPOSURE_MULT, WIND_EXPOSURE_MULT, RAIN_EVAPORATION_FACTOR, PREDATOR_STRIKE_CHANCE, ALARM_EVAPORATION_FACTOR, GRAVEYARD_THREAT_RADIUS, GRAVEYARD_THREAT_INCREMENT, GRAVEYARD_THREAT_DECAY, GRAVEYARD_THREAT_CAP } from "./params";
import { seasonOf } from "./environment/season";
import { timeOfDay, dayOfYear, phaseOfDay } from "./environment/clock";
import { ambientTemp, tempAtDepth } from "./environment/temperature";
import { advanceWeather, type WeatherKind } from "./environment/weather";
import { advancePredator, predatorCanStrike, coldDeathChance } from "./environment/hazards";
import type { EnvState } from "./state";


export type DeathEvent = {
    kind: "death";
    antId: AntId;
    ageTicks: number;
    where: "nest" | "surface";
    cause: "oldAge" | "starvation" | "predator" | "cold" | "exposure";
};

export type WeatherChangedEvent = { 
    kind: "weatherChanged";
    from: WeatherKind; 
    to: WeatherKind 
};

export type PredatorAppearedEvent = { 
    kind: "predatorAppeared" 
};

export type PredatorLeftEvent = { 
    kind: "predatorLeft" 
};

export type PredatorStrikeEvent = { 
    kind: "predatorStrike"; 
    antId: AntId 
};

export type BirthEvent = {
    kind: "birth";
    antId: AntId;
    ageTicks: number;
};

export type ForageDepartEvent = {
    kind: "forageDepart";
    antId: AntId;
};

export type SimEvent =
    | DeathEvent
    | BirthEvent
    | ForageDepartEvent
    | WeatherChangedEvent
    | PredatorAppearedEvent
    | PredatorLeftEvent
    | PredatorStrikeEvent
    | BroodLostEvent;

type TickResult = {
    state: ColonyState;
    events: SimEvent[];
};

function recordDeath(corpses: ColonyState["corpses"], nextCorpseId: number, deadAnt: Parameters<typeof createCorpse>[0]): { corpses: ColonyState["corpses"]; nextCorpseId: number } {
    const withNewCorpse = [...corpses, createCorpse(deadAnt, `corpse-${nextCorpseId}`)];

    const released = withNewCorpse.some((corpse) => corpse.carriedBy === deadAnt.id)
        ? withNewCorpse.map((corpse) => corpse.carriedBy === deadAnt.id ? { ...corpse, carriedBy: undefined } : corpse)
        : withNewCorpse;

    return { corpses: released, nextCorpseId: nextCorpseId + 1 };
}

// Remove a dead worker: drop it from state.ants, leave a corpse, push the
// DeathEvent. Shared by the two ways a worker dies in the loop below
// (ageAndMeter's age/starvation, and the surface hazard roll).
function killWorker(cs: ColonyState, dead: Parameters<typeof recordDeath>[2], cause: DeathEvent["cause"], events: SimEvent[]): ColonyState {
    const nextAnts = new Map(cs.ants);
    nextAnts.delete(dead.id);

    // A predator kill is eaten on the spot — no corpse for an undertaker to
    // find or a graveyard to receive. Bug found in review: this used to run
    // recordDeath unconditionally, leaving a body behind exactly as if she'd
    // died of old age. Anything the ant was itself hauling still needs to be
    // released, not vanish with its carrier.
    let corpses = cs.corpses;
    let nextCorpseId = cs.nextCorpseId;
    if (cause === "predator") {
        corpses = corpses.some((corpse) => corpse.carriedBy === dead.id)
            ? corpses.map((corpse) => (corpse.carriedBy === dead.id ? { ...corpse, carriedBy: undefined } : corpse))
            : corpses;
    } else {
        ({ corpses, nextCorpseId } = recordDeath(cs.corpses, cs.nextCorpseId, dead));
    }

    events.push({ kind: "death", antId: dead.id, ageTicks: dead.ageTicks, where: dead.location.where, cause });
    return { ...cs, ants: nextAnts, corpses, nextCorpseId };
}

function singleTick(state: ColonyState): TickResult {
    const events: SimEvent[] = [];

    const envResult = advanceEnvironment(state);
    events.push(...envResult.events);

    const undertakerAssignment = assignUndertakers(envResult.state);

    let currentState: ColonyState = {
        ...envResult.state,
        ants: undertakerAssignment.ants,
        rngSeed: undertakerAssignment.rngSeed,
    };

    const diggerAssignment = assignDiggers(currentState);
    currentState = {
        ...currentState,
        ants: diggerAssignment.ants,
        pendingDigPlan: diggerAssignment.pendingDigPlan,
        rngSeed: diggerAssignment.rngSeed,
    };

    const workers = Array.from(currentState.ants.values())
        .filter((ant) => ant.caste === "WORKER")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const worker of workers) {
        const {ant: aged, isDead: agedDead, cause: meterCause} = ageAndMeter(worker);

        if (agedDead) {
            currentState = killWorker(currentState, aged, meterCause ?? "oldAge", events);
            continue;
        }

        let metered = aged;
        if (metered.asleep) {
            if (currentState.simTime >= metered.wakeAt) {
                metered = {...metered, asleep: false, ticksAwake: 0};
            } else {
                const nextAnts = new Map(currentState.ants);
                nextAnts.set(metered.id, metered);
                currentState = {...currentState, ants: nextAnts};
                continue;
            }
        }


        const perception = perceive(currentState, metered);
        const action = decide(metered, perception);

        // Surface hazard roll — AFTER the decision so exposure can scale with
        // what the ant chose to do. Commit the roll's seed to currentState
        // right away: a survivor goes on to act() below, which reads
        // state.rngSeed. (A nest ant never rolls — the stream just doesn't
        // advance for it, which is fine and deterministic given the fixed
        // worker sort order.)
        if (metered.location.where === "surface") {
            let exposure = action.type === "surfaceWander" ? WANDER_EXPOSURE : 1;
            if (currentState.env.weather.kind === "RAIN") exposure *= RAIN_EXPOSURE_MULT;
            if (currentState.env.weather.kind === "WIND") exposure *= WIND_EXPOSURE_MULT;

            const baseChance = SURFACE_DEATH_CHANCE * exposure;
            const hazardRoll = rng(currentState.rngSeed);
            currentState = { ...currentState, rngSeed: hazardRoll.seed };
            if (hazardRoll.value < baseChance) {
                currentState = killWorker(currentState, metered, "exposure", events);
                continue;
            }

            if (predatorCanStrike(currentState.env.predator ?? undefined, {id: metered.id, pos: metered.location.pos})) {
                // Bug found in review: this was `>= PREDATOR_STRIKE_CHANCE`,
                // which — with a strict `<` roll uniform on [0,1) — makes the
                // kill probability `1 - PREDATOR_STRIKE_CHANCE` (60% at the
                // current 0.4), the inverse of what the name says and of the
                // `roll.value < chance` convention every other hazard roll in
                // this file already uses two lines up (hazardRoll < baseChance)
                // and in hazards.ts/queen.ts/surface.ts.
                const strikeRoll = rng(currentState.rngSeed);
                currentState = { ...currentState, rngSeed: strikeRoll.seed };
                if (strikeRoll.value < PREDATOR_STRIKE_CHANCE) {
                    events.push({ kind: "predatorStrike", antId: metered.id });
                    currentState = killWorker(currentState, metered, "predator", events);
                    continue;
                }
            }
        }

        const tileTemp =
            metered.location.where === "surface"
                ? currentState.env.ambientTemp
                : tempAtDepth(currentState.env.ambientTemp, metered.location.pos.y);
        const coldChance = coldDeathChance(tileTemp);
        if (coldChance > 0) {
            const coldRoll = rng(currentState.rngSeed);
            currentState = { ...currentState, rngSeed: coldRoll.seed };
            if (coldRoll.value < coldChance) {
                currentState = killWorker(currentState, metered, "cold", events);
                continue;
            }
        }

        const actResult = act(currentState, metered, action);

        if (
            action.type === "crossExit" &&
            metered.undertaking === undefined &&
            metered.job === "FORAGER" &&
            metered.location.where === "nest" &&
            actResult.ant.location.where === "surface"
        ) {
            events.push({ kind: "forageDepart", antId: metered.id });
        }

        const nextAnts = new Map(currentState.ants);
        nextAnts.set(metered.id, actResult.ant);

        if (actResult.queen !== undefined && currentState.ants.has(currentState.queenId)) {
            nextAnts.set(currentState.queenId, actResult.queen);
        }

        currentState = {
            ...currentState,
            ants: nextAnts,
            brood: actResult.brood,
            foodStore: actResult.foodStore,
            surface: actResult.surface,
            corpses: actResult.corpses,
            rngSeed: actResult.rngSeed,
            grid: actResult.grid ?? currentState.grid,
            nest: actResult.nest ?? currentState.nest,
            pendingDigPlan: actResult.pendingDigPlan === undefined ? currentState.pendingDigPlan : actResult.pendingDigPlan ?? undefined,
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
                where: queenResult.queen.location.where,
                cause: "oldAge",
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
    events.push(...broodResult.events);

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

    // Colony job allocation: keep enough nurses on the placed brood, drawn
    // youngest-first from the nest-side workers. Runs after births so this
    // tick's new adults are counted.
    currentState = { ...currentState, ants: reassignJobs(currentState) };

    const knowlegeResult = spreadKnowledge(currentState);
    currentState = {...currentState, ants: knowlegeResult.ants, rngSeed: knowlegeResult.rngSeed};

    const decisionPatch = evaluateDecisions(currentState);
    if (decisionPatch !== undefined) {
        currentState = { ...currentState, ...decisionPatch };
    }

    const spawnResult = spawnFoodPiles(currentState.surface, currentState.rngSeed, currentState.env.season);
    const surfaceAfterSpawn = ageFoodPiles(spawnResult.surface);
    const evapFactor = currentState.env.weather.kind === "RAIN" ? RAIN_EVAPORATION_FACTOR : undefined;
    const surface = {
        ...surfaceAfterSpawn,
        trail: evaporate(surfaceAfterSpawn.trail, evapFactor),
        // Alarm decays on its own fast schedule (ALARM_EVAPORATION_FACTOR),
        // unaffected by rain — without this the alarm channel only ever
        // grows (deposit's ceiling is ALARM_MAX, there's no floor pulling it
        // back down), so any cell that ever saw a predator flees ants
        // forever. Bug found in review: this call was missing entirely.
        alarm: evaporate(surfaceAfterSpawn.alarm, ALARM_EVAPORATION_FACTOR),
    };
    const corpses = ageCorpses(currentState.corpses);

    return {
        state: {
            ...currentState,
            seq: currentState.seq + 1,
            // simTime is NOT bumped again here — advanceEnvironment already
            // set it to state.simTime + 1 at the top of this function.
            surface,
            corpses,
            rngSeed: spawnResult.seed,
        },
        events,
    };
}

function advanceEnvironment(state: ColonyState): { state: ColonyState; events: SimEvent[] } {
    const events: SimEvent[] = [];
    const simTime = state.simTime + 1;
    const ov = state.climateOverride;
    const season = ov?.season ?? seasonOf(simTime);
    const tod = timeOfDay(simTime);
    const doy = dayOfYear(simTime);

    // advanceWeather still runs (and consumes its rng roll) even when the
    // override pins the kind — keeps the RNG cadence identical to a normal
    // run, so an overridden test and a real run diverge only in weather, not
    // in every downstream roll.
    const weatherStep = advanceWeather(state.env.weather, season, state.rngSeed);
    const weather = ov?.weather
        ? { kind: ov.weather, ticksRemaining: weatherStep.weather.ticksRemaining, forecast: weatherStep.weather.forecast }
        : weatherStep.weather;
    if (!ov?.weather && weatherStep.changed) {
        events.push({ kind: "weatherChanged", from: state.env.weather.kind, to: weatherStep.weather.kind });
    }

    const surfaceAnts: { id: AntId; pos: Position }[] = Array.from(state.ants.values())
        .filter((ant) => ant.location.where === "surface")
        .map((ant) => ({ id: ant.id, pos: ant.location.pos }));
    
    const graveyardBodyCount = state.corpses.filter(
        (corpse) =>
            corpse.carriedBy === undefined &&
            corpse.location.where === "surface" &&
            inGraveyard(state.surface, corpse.location.pos),
    ).length;

    const graveyardCentre: Position = {
        x: Math.floor((state.surface.graveyard.x0 + state.surface.graveyard.x1) / 2),
        y: Math.floor((state.surface.graveyard.y0 + state.surface.graveyard.y1) / 2),
    };

    const predatorStep = advancePredator(
        state.env.predator ?? undefined,
        { season, weatherKind: weather.kind },
        state.surface.grid,
        surfaceAnts,
        { bodyCount: graveyardBodyCount, centre: graveyardCentre },
        weatherStep.seed,
    );
    let predator = predatorStep.predator;

    if (ov?.predatorAlways && predator === undefined) {
        const width = state.surface.grid.width;
        const height = state.surface.grid.height;
        // roamTargetPos must NOT equal pos: advancePredator's arrival check
        // (unhunted + already there) fires the instant she's handed back to
        // it, and with an empty graveyard graveyardPullChance(0) is 0, so she
        // despawned on literally the next tick, every tick, and never got a
        // chance to hunt anyone — this override effectively never had a
        // predator in play. Bug found in review. Give her a real far-edge
        // target, same as a natural spawn (entry N -> target S).
        predator = {
            pos: {x: Math.floor(width / 2), y: 0},
            entryEdge: "N",
            roamTargetPos: {x: Math.floor(width / 2), y: height - 1},
            huntingAntId: undefined,
            huntStreak: 0,
            huntCooldownTicks: 0,
        };
    }
    if (!ov?.predatorAlways) {
        if (predatorStep.appeared) events.push({kind: "predatorAppeared"});
        if (predatorStep.left) events.push({kind: "predatorLeft"});
    }

    const graveyardThreatNow =
        predator !== undefined && manhattanDistance(predator.pos, graveyardCentre) <= GRAVEYARD_THREAT_RADIUS;
    const graveyardThreat = graveyardThreatNow
        ? Math.min(GRAVEYARD_THREAT_CAP, state.env.graveyardThreat + GRAVEYARD_THREAT_INCREMENT)
        : Math.floor(state.env.graveyardThreat * GRAVEYARD_THREAT_DECAY);

    const env: EnvState = {
        timeOfDay: tod,
        dayOfYear: doy,
        phase: phaseOfDay(simTime),
        season,
        ambientTemp: ambientTemp(season, tod, weather.kind),
        weather,
        predator: predator ?? null,
        graveyardThreat,
    };

    return { state: { ...state, env, rngSeed: predatorStep.seed, simTime }, events };
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