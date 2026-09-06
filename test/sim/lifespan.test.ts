import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { MAX_LIFESPAN_TICKS, MIN_LIFESPAN_TICKS } from "../../src/sim/ants/ant";
import { step } from "../../src/sim";

describe("ant lifespan", () => {
    it("eventually kills a specific ant, within the configured lifespan range", () => {
        const initialState = createInitialState(12345);

        // A starter worker, not the queen — she's mortal (4000-7000) but that's
        // longer than this 1200-tick run. A worker can't dodge death past
        // MAX_LIFESPAN_TICKS: the age check fires at <= 1000, and pure
        // starvation would take STARTING_ENERGY (1500) ticks anyway, so age
        // always wins first and the death is guaranteed lifespan-driven and
        // inside [MIN, MAX].
        const firstWorker = [...initialState.ants.values()].find(
            (ant) => ant.caste === "WORKER"
        );
        if (!firstWorker) {
            throw new Error("expected createInitialState to seed a starter worker");
        }
        const trackedAntId = firstWorker.id;

        // 1200 comfortably clears MAX_LIFESPAN_TICKS (1000) so the tracked
        // ant is guaranteed dead by the end, however the RNG rolled its
        // lifespan.
        const result = step(initialState, 1200);

        expect(result.state.ants.has(trackedAntId)).toBe(false);

        // Not toHaveLength(1) anymore — other ants in the colony can die
        // over 2000 ticks too now, so this only asserts the tracked ant's
        // death is present, not that it's the only one.
        const trackedDeathEvent = result.events.find(
            (event) => event.kind === "death" && event.antId === trackedAntId
        );

        expect(trackedDeathEvent).toBeDefined();

        // Ties this test to the actual roll range instead of just ">0" —
        // catches an off-by-one in the death check (e.g. `>` vs `>=` against
        // lifespanTicks) that ">0" alone would miss.
        expect(trackedDeathEvent?.ageTicks).toBeGreaterThanOrEqual(MIN_LIFESPAN_TICKS);
        expect(trackedDeathEvent?.ageTicks).toBeLessThanOrEqual(MAX_LIFESPAN_TICKS);
    });
});