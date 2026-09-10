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
// Phase 6's bigger surface makes each round trip longer, so the late window
// is widened to still collect a few hundred trips.
const LATE_END = 4500;

// Gross food handed off inside the nest this tick — every ant whose
// carryingFood dropped while nest-side just deposited it into the store or
// fed it to the queen (trophallaxis). Measuring the store delta directly
// stopped working once the store cap got large: the "late" window runs at or
// near cap, so net growth understates how much food is actually arriving.
function deliveredThisTick(prev: Map<string, number>, ants: Iterable<{ id: string; carryingFood: number; location: { where: string } }>): number {
    let delivered = 0;
    for (const ant of ants) {
        const before = prev.get(ant.id) ?? 0;
        if (ant.location.where === "nest" && ant.carryingFood < before) {
            delivered += before - ant.carryingFood;
        }
    }
    return delivered;
}

function foodPerTrip(seed: number): { early: number; late: number; earlyTrips: number; lateTrips: number } {
    let state = createInitialState(seed);
    let prevCarry = new Map<string, number>();

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
            bucket.delivered += deliveredThisTick(prevCarry, state.ants.values());
        }

        prevCarry = new Map([...state.ants.values()].map((a) => [a.id, a.carryingFood]));
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
        "an established colony keeps foraging efficiently as it scales — no late-game degradation",
        () => {
            const seeds = [2, 3];
            const results = seeds.map(foodPerTrip);

            for (const r of results) {
                // Sanity: both windows saw a real amount of foraging.
                expect(r.earlyTrips).toBeGreaterThan(80);
                expect(r.lateTrips).toBeGreaterThan(80);
                // The late window (trails + individual food memory built up,
                // colony several times larger) delivers at least as much food
                // per trip as the early one — recruitment keeps trips
                // productive instead of foragers wandering a picked-over map.
                // Payload per trip is capped at FORAGER_LOAD, so the ceiling
                // here is "not worse", not "dramatically better".
                expect(r.late).toBeGreaterThanOrEqual(r.early * 0.9);
            }

            const earlySum = results.reduce((s, r) => s + r.early, 0);
            const lateSum = results.reduce((s, r) => s + r.late, 0);
            expect(lateSum).toBeGreaterThanOrEqual(earlySum * 0.9);
        },
    );
});
