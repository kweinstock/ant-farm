import { describe, expect, it } from "vitest";

import { createInitialState, type ClimateOverride } from "../../src/sim/state";
import { step } from "../../src/sim";
import type { ColonyState } from "../../src/sim/state";

// The roadmap's Phase 5 test: glut / drought / harsh winter / constant
// predator must not NaN, must not throw, and the colony must either recover
// or decline gracefully — never corrupt itself. These run with a
// climateOverride (state.ts) pinning the condition, so we don't have to
// simulate ~60k ticks to reach a real winter.
//
// Runs are 6000 ticks. The founding queen's lifespan (QUEEN_*_LIFESPAN_TICKS
// = 4000-7000) may or may not expire inside that window depending on seed, so
// these deliberately DON'T assert a specific end population — post-queen
// decline to extinction is population.test.ts's job. What each scenario
// checks is the trajectory shape (grew / stayed suppressed / got struck)
// plus assertHealthy: nothing ever went non-finite, negative, or over cap.

const RUN_TICKS = 6000;
const CHECK_EVERY = 250;
const QUEEN_ALIVE_SAMPLE = 3000; // founding queen's min lifespan is 4000

function assertHealthy(state: ColonyState, label: string): void {
    const finite = (n: number, what: string) => {
        if (!Number.isFinite(n)) {
            throw new Error(`${label}: ${what} is not finite (${n}) at tick ${state.simTime}`);
        }
    };

    finite(state.simTime, "simTime");
    finite(state.rngSeed, "rngSeed");
    finite(state.foodStore.amount, "foodStore.amount");
    finite(state.env.ambientTemp, "env.ambientTemp");
    finite(state.env.phase, "env.phase");
    finite(state.env.weather.ticksRemaining, "weather.ticksRemaining");

    expect(state.foodStore.amount).toBeGreaterThanOrEqual(0);
    expect(state.foodStore.amount).toBeLessThanOrEqual(state.foodStore.capacity);
    expect(state.ants.size).toBeGreaterThanOrEqual(0);
    expect(state.brood.length).toBeGreaterThanOrEqual(0);
    expect(state.corpses.length).toBeGreaterThanOrEqual(0);

    for (const ant of state.ants.values()) {
        finite(ant.energy, `ant ${ant.id} energy`);
        finite(ant.ageTicks, `ant ${ant.id} ageTicks`);
        finite(ant.carryingFood, `ant ${ant.id} carryingFood`);
        expect(ant.carryingFood).toBeGreaterThanOrEqual(0);
    }
    for (const pile of state.surface.foodPiles) {
        finite(pile.amount, `pile ${pile.id} amount`);
        expect(pile.amount).toBeGreaterThanOrEqual(0);
    }
    for (const entry of state.brood) {
        finite(entry.progressTicks, `brood ${entry.id} progressTicks`);
    }
    for (const cell of state.surface.trail.cells) {
        finite(cell, "trail cell");
        expect(cell).toBeGreaterThanOrEqual(0);
    }
}

type ScenarioResult = {
    finalState: ColonyState;
    popAtQueenSample: number;
    startPop: number;
    predatorStrikes: number;
    everSawPredator: boolean;
};

function runScenario(seed: number, override: ClimateOverride, label: string): ScenarioResult {
    let state = createInitialState(seed, override);
    const startPop = state.ants.size;
    let popAtQueenSample = startPop;
    let predatorStrikes = 0;
    let everSawPredator = false;

    for (let t = 1; t <= RUN_TICKS; t++) {
        const { state: next, events } = step(state, 1);
        state = next;

        for (const event of events) {
            if (event.kind === "predatorStrike") predatorStrikes += 1;
        }
        if (state.env.predator !== null) everSawPredator = true;
        if (t === QUEEN_ALIVE_SAMPLE) popAtQueenSample = state.ants.size;
        if (t % CHECK_EVERY === 0) assertHealthy(state, label);
    }

    assertHealthy(state, label);
    return { finalState: state, popAtQueenSample, startPop, predatorStrikes, everSawPredator };
}

describe("balance under extreme environments", () => {
    it("glut (spring, clear): colony grows but stays bounded, store never overflows", () => {
        const r = runScenario(4001, { season: "SPRING", weather: "CLEAR" }, "glut");
        // Grew or at least held while the queen was laying into abundance.
        expect(r.popAtQueenSample).toBeGreaterThanOrEqual(r.startPop);
        // Nursery-tile cap is the real ceiling — nothing should ever get near
        // a runaway number.
        expect(r.popAtQueenSample).toBeLessThanOrEqual(250);
    });

    it("drought (winter, clear): scarce food, colony shrinks without corrupting state", () => {
        const r = runScenario(4002, { season: "WINTER", weather: "CLEAR" }, "drought");
        // Low forage abundance + near-zero lay rate: no boom.
        expect(r.popAtQueenSample).toBeLessThanOrEqual(r.startPop + 20);
        // assertHealthy already guarantees the store never went negative and
        // nothing went NaN across the whole run.
    });

    it("harsh winter (winter, snow): cold suppresses the colony without corrupting state", () => {
        const r = runScenario(4003, { season: "WINTER", weather: "SNOW" }, "harsh winter");
        expect(r.finalState.env.ambientTemp).toBeLessThan(-5); // cold-death regime
        // A healthy spring colony runs well over 130 by this point. Near-zero
        // winter lay rate + the per-tick cold-death roll keep this one heavily
        // suppressed — it creeps up slowly from the starter count but stays a
        // fraction of a thriving colony's size. assertHealthy (every 250 ticks
        // + at the end) is what actually guards NaN / negative / over-cap state.
        expect(r.popAtQueenSample).toBeLessThan(70);
        expect(r.finalState.ants.size).toBeLessThan(100);
    });

    it("constant predator at the exit: foragers are struck, colony survives under pressure, no crash", () => {
        const r = runScenario(4004, { predatorAlways: true }, "constant predator");
        expect(r.everSawPredator).toBe(true);
        // Phase 10: ants see and flee her, and she can't camp forever (a hunt
        // patience/cooldown stops her permanently locking onto whoever's
        // nearest the hole — see hazards.ts). So "always present" no longer
        // means "permanent foraging lockdown, guaranteed decline": she gets
        // some genuine strikes in, but the colony can find windows to feed
        // itself between her hunts too. This only checks the hazard is real
        // (some strikes happen) and nothing corrupts — assertHealthy (every
        // 250 ticks + at the end) is what actually guards NaN/negative/
        // over-cap state; growth vs. decline under permanent predation isn't
        // pinned to a direction here.
        expect(r.predatorStrikes).toBeGreaterThan(0);
    });
});
