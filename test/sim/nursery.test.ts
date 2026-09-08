import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { chamberAt } from "../../src/sim/world/nest";
import { NURSE_EGG_CAPACITY, NURSERY_TILE_CAPACITY } from "../../src/sim/params";

describe("nursery / egg carrying", () => {
    it("eggs travel queen chamber -> nursery, both caps hold every tick, and adults eventually eclose", () => {
        let state = createInitialState(12345);

        let sawPlacedEgg = false;
        let births = 0;

        // 400 ticks: long enough for a full egg -> larva -> pupa -> adult
        // pipeline (30 + 60 + 50 = 140 tick minimum once placed) plus the
        // ferry time to get the first egg into the nursery.
        for (let t = 0; t < 400; t++) {
            const result = step(state, 1);
            state = result.state;
            births += result.events.filter((e) => e.kind === "birth").length;

            // Per-nurse carry cap.
            for (const ant of state.ants.values()) {
                expect(ant.carrying.length).toBeLessThanOrEqual(NURSE_EGG_CAPACITY);
            }

            // Per-nursery-tile egg cap — placed eggs only (a carried egg's
            // position is synced to its nurse, so it isn't "on" a tile).
            const occupancy = new Map<string, number>();
            for (const brood of state.brood) {
                if (brood.carriedBy === undefined && chamberAt(state.nest, brood.position) === "NURSERY") {
                    const key = `${brood.position.x},${brood.position.y}`;
                    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
                    sawPlacedEgg = true;
                }
            }
            for (const count of occupancy.values()) {
                expect(count).toBeLessThanOrEqual(NURSERY_TILE_CAPACITY);
            }
        }

        // The ferry works: at least one egg made it to the nursery.
        expect(sawPlacedEgg).toBe(true);
        // The full pipeline works: placed brood actually develops to adult.
        expect(births).toBeGreaterThan(0);
    });

    it("a freshly laid egg starts in the queen chamber, not the nursery", () => {
        let state = createInitialState(12345);
        // Step until the queen has laid at least one egg.
        while (state.brood.length === 0) {
            state = step(state, 1).state;
        }
        const firstEgg = state.brood[0];
        expect(firstEgg.stage).toBe("EGG");
        expect(chamberAt(state.nest, firstEgg.position)).toBe("QUEEN");
    });
});
