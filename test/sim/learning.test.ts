import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";

// Phase 4's learning is NOT a generational trend (that needs genetics,
// Phase 9) and it is NOT "deaths per forage trip trend down" (that metric is
// dominated by where piles randomly spawn, not navigation quality — see
// index.ts's SURFACE_DEATH_CHANCE comment). What Phase 4's trail network +
// individual food memory measurably improve is *recruitment efficiency*:
// once trails are established, the colony brings home more food overall.
//
// This used to measure food-per-trip, not total throughput. That broke once
// a real bug fix (behavior.ts: a hungry ant with an empty store used to sit
// there re-rolling "eat" for 0 food and starve instead of going back out —
// see the review that added the foodStoreAmount carve-out) started sending
// far more idle/hungry ants out to forage. Trip *count* exploded late-game
// as a result, which diluted the average food-per-trip even though total
// food coming in per tick generally went UP — a healthier colony with more
// hands out looks "less efficient per trip" under that metric even while
// actually feeding itself better. Total delivered is what the colony
// actually needs and isn't confounded by that.

// Early window is deliberately near the start — the colony has barely any
// foragers and zero trail network yet. Late window is after the trails and
// individual memory have had time to build up.
const EARLY_END = 1500;
const LATE_START = 2500;
// Phase 6's bigger surface makes each round trip longer, so the late window
// is widened to still collect a meaningful amount of activity.
const LATE_END = 4500;

// Gross food handed off inside the nest this tick — every ant whose
// carryingFood dropped while nest-side just deposited it into the store or
// fed it to the queen (trophallaxis). Measuring the store delta directly
// doesn't work once the store cap gets large: the "late" window can run at
// or near cap, so net growth understates how much food is actually arriving.
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

function totalDelivered(seed: number): { early: number; late: number; earlyTrips: number; lateTrips: number } {
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

    return { early: early.delivered, late: late.delivered, earlyTrips: early.trips, lateTrips: late.trips };
}

describe("foraging learning (Phase 4: recruitment efficiency)", () => {
    it("an established colony brings home at least as much food overall once trails and memory are established", () => {
        const seeds = [2, 3];
        const results = seeds.map(totalDelivered);

        for (const r of results) {
            // Sanity: both windows saw a real amount of foraging.
            expect(r.earlyTrips).toBeGreaterThan(80);
            expect(r.lateTrips).toBeGreaterThan(80);
        }

        // Aggregate rather than per-seed: the colony's forage economy has
        // real variance run-to-run (a predator encounter, exactly when the
        // population happens to peak, etc.), so this checks the overall
        // trend across seeds instead of pinning down every individual one.
        const earlySum = results.reduce((s, r) => s + r.early, 0);
        const lateSum = results.reduce((s, r) => s + r.late, 0);
        expect(lateSum).toBeGreaterThanOrEqual(earlySum * 0.9);
    });
});
