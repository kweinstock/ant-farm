import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { chamberAt } from "../../src/sim/world/nest";
import { desiredNurseCount } from "../../src/sim/colony/workforce";
import {
    NURSE_BROOD_PER_NURSE,
    QUEEN_STEP_INTERVAL_TICKS,
} from "../../src/sim/params";

describe("colony nurse allocation (Phase 8)", () => {
    it("desiredNurseCount is ~1 nurse per NURSE_BROOD_PER_NURSE brood, never more nurses than foragers", () => {
        // No brood -> no nurses.
        expect(desiredNurseCount(0, 20)).toBe(0);
        // ~1 per NURSE_BROOD_PER_NURSE.
        expect(desiredNurseCount(NURSE_BROOD_PER_NURSE * 4, 40)).toBe(4);
        // Capped at half the workforce -> foragers always >= nurses.
        expect(desiredNurseCount(10_000, 30)).toBeLessThanOrEqual(15);
        expect(desiredNurseCount(10_000, 31)).toBeLessThanOrEqual(15);
        expect(desiredNurseCount(5, 0)).toBe(0);
    });

    it("a colony whose founding nurses have aged out still raises a new generation — no brood-care deadlock", () => {
        let state = createInitialState(12345);

        let births = 0;
        let lost = 0;
        for (let t = 0; t < 1500; t++) {
            const r = step(state, 1);
            state = r.state;
            for (const e of r.events) {
                if (e.kind === "birth") births += 1;
                if (e.kind === "broodLost") lost += 1;
            }
        }

        // The pipeline actually produces adults...
        expect(births).toBeGreaterThan(10);
        // ...and isn't just churning eggs straight into the lost pile.
        expect(births).toBeGreaterThan(lost);
        // Nurses are present and were drawn from the workforce dynamically.
        const nurses = [...state.ants.values()].filter((a) => a.caste === "WORKER" && a.job === "NURSE").length;
        expect(nurses).toBeGreaterThan(0);
    });
});

describe("queen life (Phase 8)", () => {
    it("the queen moves over time but never leaves her chamber", () => {
        let state = createInitialState(999);
        const queenStart = state.ants.get(state.queenId)!;
        const startChamberId = chamberAt(state.nest, queenStart.location.pos);
        expect(startChamberId).toBe("QUEEN");

        const positions = new Set<string>();
        for (let t = 0; t < QUEEN_STEP_INTERVAL_TICKS * 40; t++) {
            state = step(state, 1).state;
            const q = state.ants.get(state.queenId);
            if (!q) break; // she may reach old age in a long run — fine
            expect(chamberAt(state.nest, q.location.pos), `queen left her chamber at tick ${t}`).toBe("QUEEN");
            positions.add(`${q.location.pos.x},${q.location.pos.y}`);
        }

        // She actually patrols — more than one tile visited.
        expect(positions.size).toBeGreaterThan(1);
    });

    it("a hungry queen is fed by a returning forager before the store climbs (trophallaxis)", () => {
        let state = createInitialState(4001);
        // Let the colony get foragers moving and food flowing.
        for (let t = 0; t < 400; t++) state = step(state, 1).state;

        // Drop the queen to clearly-hungry.
        const queen = state.ants.get(state.queenId)!;
        state = {
            ...state,
            ants: new Map(state.ants).set(state.queenId, { ...queen, energy: 200 }),
        };

        let fedTick = -1;
        let storeRoseFirstTick = -1;
        let prevQueenEnergy = 200;
        let prevStore = state.foodStore.amount;

        for (let t = 0; t < 1500 && fedTick < 0; t++) {
            state = step(state, 1).state;
            const q = state.ants.get(state.queenId);
            if (!q) break;
            if (q.energy > prevQueenEnergy + 1 && fedTick < 0) fedTick = t;
            if (state.foodStore.amount > prevStore && storeRoseFirstTick < 0) storeRoseFirstTick = t;
            prevQueenEnergy = q.energy;
            prevStore = state.foodStore.amount;
        }

        expect(fedTick).toBeGreaterThanOrEqual(0);
        // The feed landed no later than the first post-hunger store increase —
        // trophallaxis is ahead of store delivery in the forager's priorities.
        if (storeRoseFirstTick >= 0) {
            expect(fedTick).toBeLessThanOrEqual(storeRoseFirstTick);
        }
    });
});
