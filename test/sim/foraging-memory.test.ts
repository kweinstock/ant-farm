import { describe, expect, it } from "vitest";

import {
    emptyMemory,
    rememberFoodSite,
    rememberEmptyPatch,
    patchKnownEmpty,
    bestRememberedSite,
} from "../../src/sim/ants/memory";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { FERTILE_PATCHES, EMPTY_PATCH_TTL_TICKS } from "../../src/sim/params";

const inRect = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

describe("foraging memory (Phase 7 review)", () => {
    it("a remembered food site is only offered while a pile is actually still there", () => {
        let mem = emptyMemory();
        mem = rememberFoodSite(mem, { x: 40, y: 20 }, 100);
        mem = rememberFoodSite(mem, { x: 55, y: 44 }, 120);

        // Both sites still stocked -> the freshest one comes back.
        expect(bestRememberedSite(mem, 200, () => true)).toEqual({ x: 55, y: 44 });

        // The fresher site has been picked clean -> fall back to the older
        // one that still has food, not the empty tile the ant remembers best.
        const onlyOldStocked = (p: { x: number; y: number }) => p.x === 40 && p.y === 20;
        expect(bestRememberedSite(mem, 200, onlyOldStocked)).toEqual({ x: 40, y: 20 });

        // Nothing stocked -> nothing to route to.
        expect(bestRememberedSite(mem, 200, () => false)).toBeUndefined();

        // TTL still applies.
        expect(bestRememberedSite(mem, 100_000, () => true)).toBeUndefined();
    });

    it("an empty-patch note expires after EMPTY_PATCH_TTL_TICKS", () => {
        const mem = rememberEmptyPatch(emptyMemory(), 3, 1000);
        expect(patchKnownEmpty(mem, 3, 1000)).toBe(true);
        expect(patchKnownEmpty(mem, 3, 1000 + EMPTY_PATCH_TTL_TICKS - 1)).toBe(true);
        expect(patchKnownEmpty(mem, 3, 1000 + EMPTY_PATCH_TTL_TICKS)).toBe(false);
        expect(patchKnownEmpty(mem, 4, 1000)).toBe(false);
    });

    it("a running colony fans out across several patches and its foragers learn which ones are dry", () => {
        let state = createInitialState(77345);

        const patchesVisited = new Set<number>();
        let anyEmptyPatchMemory = false;

        for (let t = 0; t < 4000; t++) {
            state = step(state, 1).state;

            for (const ant of state.ants.values()) {
                if (ant.location.where !== "surface") continue;
                const { x, y } = ant.location.pos;
                FERTILE_PATCHES.forEach((p, i) => {
                    if (inRect(x, y, p)) patchesVisited.add(i);
                });
                if (ant.memory.emptyPatches.length > 0) anyEmptyPatchMemory = true;
            }
        }

        // Not every forager glued to the one patch it found first.
        expect(patchesVisited.size).toBeGreaterThanOrEqual(4);
        // Foragers actually recorded dry patches (the "see a spot is empty,
        // look elsewhere" behaviour).
        expect(anyEmptyPatchMemory).toBe(true);
    });
});
