import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { MAX_PILES } from "../../src/sim/world/surface";

describe("surface food economy", () => {
    it("piles keep spawning, stay capped, and are actually consumed", () => {
        let state = createInitialState(12345);

        let everHadPiles = false;
        let everRestocked = false; // foodStore rose => a forager delivered
        let prevStore = state.foodStore.amount;

        for (let t = 0; t < 3000; t++) {
            state = step(state, 1).state;

            // Hard cap holds every single tick, not just at samples.
            expect(state.surface.foodPiles.length).toBeLessThanOrEqual(MAX_PILES);

            if (state.surface.foodPiles.length > 0) everHadPiles = true;
            if (state.foodStore.amount > prevStore) everRestocked = true;
            prevStore = state.foodStore.amount;
        }

        expect(everHadPiles).toBe(true);
        expect(everRestocked).toBe(true);
    });
});
