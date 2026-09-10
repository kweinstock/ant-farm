import { describe, expect, it } from "vitest";

import { createSurface, spawnFoodPiles } from "../../src/sim/world/surface";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import {
    SURFACE_WIDTH,
    SURFACE_HEIGHT,
    MAX_PILES,
    FOOD_TILE_CAPACITY,
    FOOD_PILE_START_AMOUNT,
} from "../../src/sim/params";

describe("surface food piles — per-tile capacity (Phase 7 review)", () => {
    it("a pile never exceeds FOOD_TILE_CAPACITY, repeated spawns top up one tile instead of stacking, and distinct piles stay <= MAX_PILES", () => {
        let surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);
        let seed = 4242;

        let sawTopUp = false;
        for (let i = 0; i < 8000; i++) {
            const r = spawnFoodPiles(surface, seed, "SUMMER");
            seed = r.seed;
            surface = r.surface;

            // One entry per tile — a repeat spawn merges, it doesn't add a
            // second pile at the same position.
            const seen = new Set<string>();
            for (const p of surface.foodPiles) {
                const key = `${p.pos.x},${p.pos.y}`;
                expect(seen.has(key), `two piles on ${key}`).toBe(false);
                seen.add(key);

                expect(p.amount).toBeLessThanOrEqual(FOOD_TILE_CAPACITY);
                expect(p.capacity).toBe(FOOD_TILE_CAPACITY);
                if (p.amount > FOOD_PILE_START_AMOUNT) sawTopUp = true;
            }

            expect(surface.foodPiles.length).toBeLessThanOrEqual(MAX_PILES);
        }

        // With only MAX_PILES tiles allowed and thousands of spawn attempts,
        // the same tile must have been hit again and topped up past the
        // starting amount.
        expect(sawTopUp).toBe(true);
    });

    it("in a running colony no pile is ever over capacity", () => {
        let state = createInitialState(20260910);
        for (let t = 0; t < 2500; t++) {
            state = step(state, 1).state;
            for (const pile of state.surface.foodPiles) {
                expect(pile.amount).toBeLessThanOrEqual(pile.capacity);
                expect(pile.capacity).toBe(FOOD_TILE_CAPACITY);
            }
        }
    });
});
