import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { chamberAt, allTilesOf } from "../../src/sim/world/nest";
import { NURSE_EGG_CAPACITY, NURSERY_TILE_CAPACITY } from "../../src/sim/params";

describe("nursery / egg carrying", () => {
    it("eggs travel queen chamber -> nursery, both caps hold every tick, and adults eventually eclose", () => {
        let state = createInitialState(12345);
        const allNurseryTiles = allTilesOf(state.nest, "NURSERY");

        let sawPlacedEgg = false;
        let births = 0;

        // 800 ticks: long enough for a full egg -> larva -> pupa -> adult
        // pipeline (30 + 60 + 50 = 140 tick minimum once placed) plus the
        // ferry time to get the first egg into the nursery, plus slack for
        // Phase 9 sleep — nurses (and the queen) are asleep and unable to
        // ferry/tend/lay roughly 1 tick in 4, and a nurse due for a nap
        // detours to a commons first, so real elapsed ticks per pipeline
        // stage run noticeably longer than the bare minimum above.
        for (let t = 0; t < 800; t++) {
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

            // Brood spreads before it stacks: no tile holds 2+ while another
            // nursery tile is still empty. (occupancy only has entries for
            // used tiles, so "empty tiles exist" == used < total.)
            const totalTiles = allNurseryTiles.length;
            const maxStack = occupancy.size > 0 ? Math.max(...occupancy.values()) : 0;
            if (occupancy.size < totalTiles) {
                expect(maxStack).toBeLessThanOrEqual(1);
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
