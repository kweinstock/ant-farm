import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { STARTING_FOOD_STORE, MAX_ENERGY } from "../../src/sim/params";
import { step } from "../../src/sim";
import { exitMouth } from "../../src/sim/world/nest";
import type { FoodPile } from "../../src/sim/world/surface";

describe("nest <-> surface transition", () => {
    it("a forager crosses to the surface, picks up food, crosses back, and stocks the store", () => {
        const state = createInitialState(12345);

        // Turn one starter worker into a forager standing at the exit mouth,
        // full energy so it isn't diverted by hunger. colony/workforce.ts
        // picks nurses OLDEST-first (capped at half the workforce), so to
        // keep the job allocator from reclaiming this one the instant a
        // nurse is needed, age every OTHER starter worker up instead —
        // that leaves our ant the strict youngest, and therefore never a
        // nurse candidate, regardless of how early the queen's first egg
        // lands (Phase 9 shifted that timing: every ant now consumes one
        // extra RNG draw at creation for its sleep phase, so the queen's
        // first lay roll — and thus brood.length, and thus the nurse
        // target — no longer lines up with a pre-Phase-9 seed run).
        const workers = [...state.ants.values()].filter((a) => a.caste === "WORKER");
        const forager = workers[0];
        if (!forager) throw new Error("expected a starter worker");
        for (const other of workers.slice(1)) {
            other.ageTicks = 1_000_000;
        }
        forager.job = "FORAGER";
        forager.energy = MAX_ENERGY;
        forager.ageTicks = 0;
        forager.location = { where: "nest", pos: exitMouth(state.nest) };
        const foragerId = forager.id;

        // A pile just outside the hole (hole is at surface bottom-centre) so
        // the round trip is short. id well past nextPileId so spawned piles
        // can't collide with it.
        const pile: FoodPile = {
            id: "pile-999",
            pos: { x: state.surface.holePos.x, y: state.surface.holePos.y - 4 },
            amount: 300,
            capacity: 300,
            ageTicks: 0,
        };
        state.surface.foodPiles.push(pile);

        let sawSurface = false;
        let sawCarrying = false;
        let sawBackInNest = false;
        let storeRose = false;

        let s = state;
        let prevStore = s.foodStore.amount;

        for (let t = 0; t < 300; t++) {
            s = step(s, 1).state;
            const f = s.ants.get(foragerId);
            if (!f) throw new Error(`forager died at tick ${t} — unexpected in 300 ticks`);

            if (f.location.where === "surface") sawSurface = true;
            if (f.carryingFood > 0) sawCarrying = true;
            if (sawSurface && f.location.where === "nest") sawBackInNest = true;
            if (s.foodStore.amount > prevStore) storeRose = true;
            prevStore = s.foodStore.amount;
        }

        expect(sawSurface).toBe(true);
        expect(sawCarrying).toBe(true);
        expect(sawBackInNest).toBe(true);
        expect(storeRose).toBe(true);
        // Nothing else raises the store (regen is gone), and nobody eats in
        // 300 ticks starting from full energy — so the store strictly grew.
        expect(s.foodStore.amount).toBeGreaterThan(STARTING_FOOD_STORE);
    });
});
