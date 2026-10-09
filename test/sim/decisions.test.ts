import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { evaluateDecisions } from "../../src/sim/colony/decisions";
import { inGraveyard, inRect, type Rect } from "../../src/sim/world/surface";
import type { Position } from "../../src/sim/world/grid";
import { DECISION_INTERVAL_TICKS, DECISION_THRESHOLD, GRAVEYARD_THREAT_CAP } from "../../src/sim/params";

function graveyardCentre(rect: Rect): Position {
    return { x: Math.floor((rect.x0 + rect.x1) / 2), y: Math.floor((rect.y0 + rect.y1) / 2) };
}

describe("evaluateDecisions — graveyard relocation (Phase 11)", () => {
    it("does nothing off the DECISION_INTERVAL_TICKS cadence, even with threat maxed", () => {
        let state = createInitialState(7);
        state = { ...state, simTime: 1, env: { ...state.env, graveyardThreat: GRAVEYARD_THREAT_CAP } };
        expect(evaluateDecisions(state)).toBeUndefined();
    });

    it("does nothing when threat is below DECISION_THRESHOLD", () => {
        let state = createInitialState(7);
        state = {
            ...state,
            simTime: DECISION_INTERVAL_TICKS,
            env: { ...state.env, graveyardThreat: Math.floor(GRAVEYARD_THREAT_CAP * DECISION_THRESHOLD) - 1 },
        };
        expect(evaluateDecisions(state)).toBeUndefined();
    });

    it("relocates the graveyard to a different, equally-sized rect once threat clears the threshold on the interval boundary", () => {
        let state = createInitialState(7);
        const originalRect = state.surface.graveyard;
        state = {
            ...state,
            simTime: DECISION_INTERVAL_TICKS,
            env: { ...state.env, graveyardThreat: GRAVEYARD_THREAT_CAP },
        };

        const patch = evaluateDecisions(state);
        expect(patch).toBeDefined();
        expect(patch!.surface).toBeDefined();

        const relocated = patch!.surface!.graveyard;
        expect(relocated).not.toEqual(originalRect);
        expect(relocated.x1 - relocated.x0).toBe(originalRect.x1 - originalRect.x0);
        expect(relocated.y1 - relocated.y0).toBe(originalRect.y1 - originalRect.y0);
    });
});

describe("graveyard relocation under sustained predator threat (Phase 11 integration)", () => {
    it("the graveyard migrates away from a predator camped on top of it, and the old plot stops receiving bodies", () => {
        // Force a predator to sit exactly on the graveyard's centre every
        // tick (re-pinning her position after each step, since advancePredator
        // otherwise moves her toward her own roam target) so
        // GRAVEYARD_THREAT_RADIUS/INCREMENT accumulate for real through
        // advanceEnvironment, the same code path a natural hunt would drive —
        // rather than hand-setting env.graveyardThreat as the unit tests above do.
        let state = createInitialState(9, { predatorAlways: true });
        const originalRect = state.surface.graveyard;

        let relocatedAt: number | undefined;
        for (let t = 1; t <= 3000 && relocatedAt === undefined; t++) {
            if (state.env.predator) {
                state = { ...state, env: { ...state.env, predator: { ...state.env.predator, pos: graveyardCentre(state.surface.graveyard) } } };
            }
            state = step(state, 1).state;
            if (state.surface.graveyard.x0 !== originalRect.x0 || state.surface.graveyard.y0 !== originalRect.y0) {
                relocatedAt = t;
            }
        }

        expect(relocatedAt).toBeDefined();

        const newRect = state.surface.graveyard;
        expect(newRect).not.toEqual(originalRect);

        // Drop the forced predator so the colony goes back to dying of
        // ordinary causes (old age, starvation, cold, exposure) rather than
        // predator strikes, which leave no corpse at all — otherwise there's
        // nothing here for an undertaker to ever carry to the new plot.
        // Then run long enough for natural deaths + hauling to happen and
        // confirm every placed-on-surface corpse since relocation lands in
        // the new plot, never the abandoned one.
        state = { ...state, env: { ...state.env, predator: null }, climateOverride: undefined };
        for (let t = 0; t < 4000; t++) {
            state = step(state, 1).state;
        }

        // Not every surface corpse is necessarily resting in a graveyard yet
        // (it may be lying where it died, waiting for an undertaker), so the
        // only claim to check is the actual one: none of them are sitting in
        // the plot the colony abandoned.
        const placedCorpses = state.corpses.filter((c) => c.carriedBy === undefined && c.location.where === "surface");
        for (const corpse of placedCorpses) {
            expect(inRect(corpse.location.pos, originalRect)).toBe(false);
        }
        // And at least one corpse actually made it into the new plot, so
        // this isn't vacuously true because nothing died.
        expect(placedCorpses.some((c) => inGraveyard(state.surface, c.location.pos))).toBe(true);
    });
});
