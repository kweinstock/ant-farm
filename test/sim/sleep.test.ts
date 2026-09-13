import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import type { ColonyState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { act } from "../../src/sim/ants/jobs";
import type { Ant } from "../../src/sim/ants/ant";
import { getDemography } from "../../src/sim/colony/demography";
import {
    DAY_LENGTH_TICKS,
    SLEEPS_PER_DAY,
    SLEEP_DURATION_TICKS,
    STARTING_FOOD_STORE,
} from "../../src/sim/params";

const SEED = 12345;

describe("sleep", () => {
    it("the queen's daily sleep total lands near SLEEPS_PER_DAY x SLEEP_DURATION_TICKS", () => {
        // The queen is the clean case: her nap schedule is driven purely by
        // ticksAwake/wakeAt, with no hunger/undertaking/carrying rule ever
        // competing for the decision ahead of it (unlike a worker — see the
        // next test) — so over a full day her total should land close to
        // the nominal budget for ANY seed, not just a lucky one.
        let state = createInitialState(SEED);
        let queenAsleepTicks = 0;

        for (let t = 0; t < DAY_LENGTH_TICKS; t++) {
            state = step(state, 1).state;
            const queen = state.ants.get(state.queenId);
            if (queen?.asleep) queenAsleepTicks++;
        }

        const target = SLEEPS_PER_DAY * SLEEP_DURATION_TICKS;
        expect(queenAsleepTicks).toBeGreaterThan(target * 0.8);
        expect(queenAsleepTicks).toBeLessThan(target * 1.2);
    });

    it("workers spend a healthy minority of the day asleep — never none, never most", () => {
        // Workers, unlike the queen, have the hunger/undertaking/carrying
        // rules sitting ahead of the sleep rule in decide(), so any one
        // worker's personal duty cycle is noisy (a busy forager naps far
        // less than an idle nurse). Assert on the colony-wide average
        // instead of a single ant: this is what would have caught the
        // "sleepPhase in the top SLEEP_DURATION_TICKS values never wakes
        // up again" bug (average duty cycle pinned near 0 or way above the
        // ~25% ceiling), without being sensitive to which specific ant a
        // test happens to track.
        let state = createInitialState(SEED);
        let workerTicksAlive = 0;
        let workerTicksAsleep = 0;

        for (let t = 0; t < DAY_LENGTH_TICKS; t++) {
            state = step(state, 1).state;
            for (const ant of state.ants.values()) {
                if (ant.caste !== "WORKER") continue;
                workerTicksAlive++;
                if (ant.asleep) workerTicksAsleep++;
            }
        }

        const dutyFraction = workerTicksAsleep / workerTicksAlive;
        expect(dutyFraction).toBeGreaterThan(0.02);
        expect(dutyFraction).toBeLessThan(0.5);
    });

    it("the sleep action itself moves nothing and only flips the sleep fields", () => {
        // A direct unit test on act(), not a simulated tick window: with
        // SLEEP_DURATION_TICKS=1 an ant that falls asleep this tick is
        // already due to wake (and act) again next tick — index.ts lets it
        // fall through the SAME tick it wakes so it isn't idle for one, so
        // there is no later tick where it's still observably "asleep and
        // unmoved" to sample from a running sim. act()'s "sleep" case is
        // the actual place the "no move, no other side effect" contract
        // lives, so test it directly and unambiguously here.
        const ant: Ant = {
            id: "ant-test",
            name: "ant-test",
            caste: "WORKER",
            job: "NURSE",
            carrying: [],
            carryingFood: 0,
            undertaking: undefined,
            memory: {} as Ant["memory"],
            location: { where: "nest", pos: { x: 12, y: 7 } },
            energy: 1500,
            ageTicks: 300,
            lifespanTicks: 2000,
            asleep: false,
            wakeAt: 0,
            ticksAwake: 5,
            sleepPhase: 1,
        };

        const state = {
            simTime: 100,
            brood: [],
            foodStore: { amount: 5000, capacity: 15000 },
            surface: {} as ColonyState["surface"],
            corpses: [],
        } as unknown as ColonyState;

        const result = act(state, ant, { type: "sleep" });

        expect(result.ant.location).toEqual(ant.location);
        expect(result.ant.energy).toBe(ant.energy);
        expect(result.ant.carrying).toEqual(ant.carrying);
        expect(result.ant.carryingFood).toBe(ant.carryingFood);
        expect(result.ant.job).toBe(ant.job);
        expect(result.ant.asleep).toBe(true);
        expect(result.ant.ticksAwake).toBe(0);
        expect(result.ant.wakeAt).toBeGreaterThan(state.simTime);
        expect(result.brood).toBe(state.brood);
        expect(result.foodStore).toBe(state.foodStore);
        expect(result.surface).toBe(state.surface);
        expect(result.corpses).toBe(state.corpses);
    });

    it("no ant is ever asleep on the surface", () => {
        let state = createInitialState(SEED);

        for (let t = 0; t < 3000; t++) {
            state = step(state, 1).state;
            for (const ant of state.ants.values()) {
                expect(ant.asleep && ant.location.where === "surface").toBe(false);
            }
        }
    });

    it("the colony still functions with a realistic fraction of ants asleep at any moment", () => {
        let state = createInitialState(SEED);
        let births = 0;
        let maxFood = state.foodStore.amount;
        let sawSomeAsleep = false;
        let sawMostlyAwake = false;

        // 3000 ticks: comfortably inside the healthy window this seed's
        // economy sustains (population.test.ts validates the same seed
        // out to 10000 ticks staying bounded; picking a shorter window
        // here avoids this test riding into that run's eventual boom/bust
        // famine tail, which is real emergent behavior, not something a
        // sleep-specific test should be asserting against).
        for (let t = 0; t < 3000; t++) {
            const result = step(state, 1);
            state = result.state;
            births += result.events.filter((e) => e.kind === "birth").length;
            maxFood = Math.max(maxFood, state.foodStore.amount);

            if (t % 200 === 0) {
                const fraction = getDemography(state).asleep / state.ants.size;
                if (fraction > 0.02) sawSomeAsleep = true;
                if (fraction < 0.9) sawMostlyAwake = true;
            }
        }

        expect(sawSomeAsleep).toBe(true);
        expect(sawMostlyAwake).toBe(true);
        expect(births).toBeGreaterThan(0);
        expect(maxFood).toBeGreaterThan(STARTING_FOOD_STORE);
    });

    it("determinism holds through sleep, wake, and the queen's cycle", () => {
        const stateA = createInitialState(SEED);
        const stateB = createInitialState(SEED);

        // Long enough to exercise multiple worker nap cycles and at least
        // one queen sleep/wake round trip.
        const bigStep = step(stateA, 300);

        let smallStepState = stateB;
        for (let i = 0; i < 300; i++) {
            smallStepState = step(smallStepState, 1).state;
        }

        expect(bigStep.state).toEqual(smallStepState);
    });
});
