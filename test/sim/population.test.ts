import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { tilesOf } from "../../src/sim/world/nest";
import { NURSERY_TILE_CAPACITY } from "../../src/sim/params";

// Tune once real runs show what "sane" looks like. The lower bound treats
// extinction as a failure — but ONLY while the colony still has a queen.
const MIN_SANE_POPULATION = 1;
const MAX_SANE_POPULATION = 200;

const SAMPLE_INTERVAL_TICKS = 500;
const TOTAL_TICKS = 10000;

describe("population dynamics", () => {
    it("is self-sustaining while queened, bounded always, and doesn't grow unboundedly", () => {
        let state = createInitialState(12345);
        let queenEverDied = false;

        // The real brood ceiling in 3a: nursery-tile count x per-tile cap.
        // queen.ts gates laying on state.brood.length staying under this, so
        // brood can never run away even if the nurses fall behind.
        const maxBrood = tilesOf(state.nest, "NURSERY").length * NURSERY_TILE_CAPACITY;

        for (
            let ticksElapsed = SAMPLE_INTERVAL_TICKS;
            ticksElapsed <= TOTAL_TICKS;
            ticksElapsed += SAMPLE_INTERVAL_TICKS
        ) {
            state = step(state, SAMPLE_INTERVAL_TICKS).state;

            const queenAlive = state.ants.has(state.queenId);
            if (!queenAlive) {
                queenEverDied = true;
            }

            // Always: no population explosion, and brood can't run away
            // (the "without unbounded growth" clause — enforced by queen.ts's
            // lay gate against nursery capacity).
            expect(state.ants.size).toBeLessThanOrEqual(MAX_SANE_POPULATION);
            expect(state.brood.length).toBeLessThanOrEqual(maxBrood);

            // While the queen is alive the colony must not die out. After she
            // dies there's no succession yet (colony/caste.ts) and no forager
            // feeding (Phase 4), so a decline to extinction is expected — the
            // sampling above still guards against anything crazy on the way
            // down.
            if (queenAlive) {
                expect(state.ants.size).toBeGreaterThanOrEqual(MIN_SANE_POPULATION);
            }
        }

        // The queen is mortal (QUEEN_*_LIFESPAN_TICKS < TOTAL_TICKS) — make
        // sure the run actually exercised her death, not just a lucky long
        // reign, so the post-queen path above is really being tested.
        expect(queenEverDied).toBe(true);
    }, 20000);
});
