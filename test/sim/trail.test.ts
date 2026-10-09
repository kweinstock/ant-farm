import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { exitMouth } from "../../src/sim/world/nest";
import type { FoodPile } from "../../src/sim/world/surface";

function trailSum(cells: Float32Array): number {
    let s = 0;
    for (const c of cells) s += c;
    return s;
}

describe("pheromone trails in the running sim", () => {
    it("a trail forms along the pile <-> hole corridor, then decays away once deposits stop", () => {
        let state = createInitialState(31337);

        // Force several starters into foraging at the exit mouth, full energy.
        for (const ant of state.ants.values()) {
            if (ant.caste !== "WORKER") continue;
            ant.job = "FORAGER";
            ant.energy = 1500;
            ant.location = { where: "nest", pos: exitMouth(state.nest) };
        }

        // One rich pile a short walk straight "up" from the hole. y-5 keeps it
        // inside HOLE_EXCLUSION_RADIUS (6), so it's guaranteed GROUND — no
        // Phase 7 forest obstacle can land on it, and the corridor between is
        // clear.
        const hole = state.surface.holePos;
        const pilePos = { x: hole.x, y: hole.y - 5 };
        const pile: FoodPile = { id: "pile-t", pos: pilePos, amount: 5000, capacity: 5000, ageTicks: 0 };
        state.surface.foodPiles.push(pile);

        // 200 ticks: long enough for a trail network to build up, short
        // enough that Phase 5's exit predator (which camps the hole every
        // forager funnels through) hasn't had a reliable chance to wipe this
        // deliberately tiny 5-forager colony out from under the test. Trail
        // *formation* is what this case checks — survival under the predator
        // is balance.test.ts's job.
        for (let t = 0; t < 200; t++) state = step(state, 1).state;

        const cells = state.surface.trail.cells;
        const w = state.surface.trail.width;
        const at = (x: number, y: number) => cells[y * w + x];

        // Something got laid down.
        expect(trailSum(cells)).toBeGreaterThan(50);

        // The corridor between the hole and the pile is stronger than a strip
        // of open ground the same distance away on the far side of the map.
        let corridor = 0;
        for (let y = pilePos.y; y <= hole.y; y++) corridor += at(hole.x, y);
        let elsewhere = 0;
        for (let y = pilePos.y; y <= hole.y; y++) elsewhere += at(3, y);
        expect(corridor).toBeGreaterThan(elsewhere);
        expect(corridor).toBeGreaterThan(0);

        // Now cut off all deposits — drop the pile and every worker — and let
        // evaporation run. ~150 ticks of x0.95 clears even a maxed trail
        // (200 * 0.95^150 is far below MIN_TRAIL, which floors to 0).
        const queen = state.ants.get(state.queenId)!;
        state = {
            ...state,
            ants: new Map([[state.queenId, queen]]),
            surface: { ...state.surface, foodPiles: [] },
        };

        for (let t = 0; t < 160; t++) state = step(state, 1).state;

        expect(trailSum(state.surface.trail.cells)).toBe(0);
    });
});
