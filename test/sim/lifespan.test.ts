import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { MAX_LIFESPAN_TICKS, MIN_LIFESPAN_TICKS } from "../../src/sim/params";
import { step } from "../../src/sim";

describe("ant lifespan", () => {
    it("eventually kills a specific ant, and old-age deaths land inside the configured range", () => {
        const initialState = createInitialState(12345);

        const firstWorker = [...initialState.ants.values()].find((ant) => ant.caste === "WORKER");
        if (!firstWorker) {
            throw new Error("expected createInitialState to seed a starter worker");
        }
        const trackedAntId = firstWorker.id;

        // Run past MAX_LIFESPAN_TICKS so the tracked ant is dead by the end
        // however the RNG rolled its lifespan — and even if it doesn't die of
        // old age first (a worker can now starve or hit a surface hazard
        // before its lifespan, depending on params).
        const result = step(initialState, MAX_LIFESPAN_TICKS + 500);

        expect(result.state.ants.has(trackedAntId)).toBe(false);

        const trackedDeathEvent = result.events.find(
            (event) => event.kind === "death" && event.antId === trackedAntId
        );
        expect(trackedDeathEvent).toBeDefined();
        expect(trackedDeathEvent?.kind).toBe("death");

        if (trackedDeathEvent?.kind === "death") {
            // Every worker death is one of the five classified causes.
            expect(["oldAge", "starvation", "exposure", "predator", "cold"]).toContain(trackedDeathEvent.cause);

            // An old-age death — and only that — must fall inside [MIN, MAX];
            // catches an off-by-one in the age check (`>` vs `>=` against
            // lifespanTicks). A hazard/starvation death can happen at any age.
            if (trackedDeathEvent.cause === "oldAge") {
                expect(trackedDeathEvent.ageTicks).toBeGreaterThanOrEqual(MIN_LIFESPAN_TICKS);
                expect(trackedDeathEvent.ageTicks).toBeLessThanOrEqual(MAX_LIFESPAN_TICKS);
            }
        }
    });
});