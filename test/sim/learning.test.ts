import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";

// Phase 4's learning is NOT a generational trend (that needs genetics,
// Phase 9) and it is NOT "deaths per forage trip trend down" (that metric is
// dominated by where piles randomly spawn, not navigation quality — see
// index.ts's SURFACE_DEATH_CHANCE comment). What Phase 4's trail network +
// individual food memory measurably improve is *recruitment efficiency*:
// once trails are established, each forage trip brings home more food. That's
// the "food store filling faster as recruitment kicks in" effect.

// Early window is deliberately near the start — the colony has barely any
// foragers and zero trail network yet. Late window is after the trails and
// individual memory have had time to build up.
const EARLY_END = 1500;
const LATE_START = 2500;
const LATE_END = 4000;

function foodPerTrip(seed: number): { early: number; late: number; earlyTrips: number; lateTrips: number } {
    let state = createInitialState(seed);
    let prevStore = state.foodStore.amount;

    const early = { trips: 0, delivered: 0 };
    const late = { trips: 0, delivered: 0 };

    for (let t = 1; t <= LATE_END; t++) {
        const r = step(state, 1);
        state = r.state;

        const bucket = t <= EARLY_END ? early : t >= LATE_START ? late : undefined;
        if (bucket) {
            for (const e of r.events) {
                if (e.kind === "forageDepart") bucket.trips++;
            }
            if (state.foodStore.amount > prevStore) bucket.delivered += state.foodStore.amount - prevStore;
        }
        prevStore = state.foodStore.amount;
    }

    return {
        early: early.delivered / early.trips,
        late: late.delivered / late.trips,
        earlyTrips: early.trips,
        lateTrips: late.trips,
    };
}

describe("foraging learning (Phase 4: recruitment efficiency)", () => {
    it(
        "food delivered per forage trip is higher once the trail network has established",
        () => {
            const seeds = [1, 3, 4];
            const results = seeds.map(foodPerTrip);

            for (const r of results) {
                // sanity: each window actually had a meaningful number of trips
                expect(r.earlyTrips).toBeGreaterThan(80);
                expect(r.lateTrips).toBeGreaterThan(80);
                // per-seed the late window is not worse than the early one
                expect(r.late).toBeGreaterThanOrEqual(r.early);
            }

            // Aggregate: clearly more food per trip late than early.
            const earlySum = results.reduce((s, r) => s + r.early, 0);
            const lateSum = results.reduce((s, r) => s + r.late, 0);
            expect(lateSum).toBeGreaterThan(earlySum * 1.3);
        },
        20000
    );
});
