import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { inGraveyard } from "../../src/sim/world/surface";
import { allTilesOf } from "../../src/sim/world/nest";
import { assignUndertakers, type Corpse } from "../../src/sim/corpses";
import { CORPSE_DECAY_TICKS, UNDERTAKER_PER_CORPSE } from "../../src/sim/params";
import type { Ant } from "../../src/sim/ants/ant";

function nestCorpse(id: string, pos: { x: number; y: number }, ageTicks = 0): Corpse {
    return { id, location: { where: "nest", pos }, ageTicks, carriedBy: undefined };
}

function countUndertaking(ants: Iterable<Ant>): number {
    let n = 0;
    for (const a of ants) if (a.undertaking !== undefined) n++;
    return n;
}

describe("corpses & the undertaker", () => {
    it("a die-off in a chamber ends up in the graveyard, with roughly the expected crew", () => {
        // Grow a workforce first.
        let state = createInitialState(4242);
        for (let t = 0; t < 700; t++) state = step(state, 1).state;

        // Six bodies on one real passable COMMONS tile (an undertaker has to
        // be able to physically stand on it to pick a body up).
        const spot = allTilesOf(state.nest, "COMMONS")[0];
        const injected = Array.from({ length: 6 }, (_, i) => nestCorpse(`corpse-inj-${i}`, spot));
        const injectedIds = new Set(injected.map((c) => c.id));
        state = { ...state, corpses: [...state.corpses, ...injected] };

        let peakCrew = 0; // undertakers assigned to one of the injected bodies
        let handledAt = -1;

        // Wider window than pre-Phase-6: the nest is ~9x bigger, so the
        // corpse -> exit -> graveyard haul is a much longer walk.
        for (let t = 1; t <= 900; t++) {
            state = step(state, 1).state;

            const crew = [...state.ants.values()].filter(
                (a) => a.undertaking !== undefined && injectedIds.has(a.undertaking.corpseId)
            ).length;
            peakCrew = Math.max(peakCrew, crew);

            const remaining = state.corpses.filter((c) => injectedIds.has(c.id));
            const allHandled = remaining.every(
                (c) => c.location.where === "surface" && inGraveyard(state.surface, c.location.pos)
            );
            if (allHandled && handledAt < 0) {
                handledAt = t;
                break;
            }
        }

        // Every injected body reached the graveyard (none still loose, none
        // decayed — 900 ticks < CORPSE_DECAY_TICKS).
        expect(handledAt).toBeGreaterThan(0);
        for (const c of state.corpses.filter((c) => injectedIds.has(c.id))) {
            expect(c.location.where).toBe("surface");
            expect(inGraveyard(state.surface, c.location.pos)).toBe(true);
        }

        // ~ corpseCount * UNDERTAKER_PER_CORPSE (= 3), with slack for the
        // fact that natural deaths add to the pending count too.
        const expected = 6 * UNDERTAKER_PER_CORPSE;
        expect(peakCrew).toBeGreaterThanOrEqual(Math.max(1, expected - 2));
        expect(peakCrew).toBeLessThanOrEqual(expected + 3);
    });

    it("no corpses -> no undertakers, every tick", () => {
        // With a Phase-6-sized starter workforce foraging a bigger surface, a
        // surface-hazard death inside 400 ticks is now plausible — so this no
        // longer asserts "zero corpses ever," just the actual invariant:
        // whenever the corpse list is empty, nobody is on undertaker duty.
        let state = createInitialState(12345);
        let sawEmptyTick = false;
        for (let t = 0; t < 400; t++) {
            state = step(state, 1).state;
            if (state.corpses.length === 0) {
                sawEmptyTick = true;
                expect(countUndertaking(state.ants.values())).toBe(0);
            }
        }
        // The run really did spend time with no corpses (guards against a
        // vacuous pass).
        expect(sawEmptyTick).toBe(true);
    });

    it("a corpse nobody reaches still decays out by CORPSE_DECAY_TICKS", () => {
        const base = createInitialState(1);
        // Colony = just the queen: no workers means no undertakers, so the
        // only thing that can clear this corpse is the decay backstop.
        const queen = base.ants.get(base.queenId)!;
        const state = {
            ...base,
            ants: new Map([[base.queenId, queen]]),
            corpses: [nestCorpse("corpse-lonely", { x: 12, y: 4 }, CORPSE_DECAY_TICKS - 3)],
        };

        let s = state;
        for (let t = 1; t <= 3; t++) s = step(s, 1).state;
        expect(s.corpses.some((c) => c.id === "corpse-lonely")).toBe(true);

        for (let t = 4; t <= 6; t++) s = step(s, 1).state;
        expect(s.corpses.some((c) => c.id === "corpse-lonely")).toBe(false);
    });

    it("assignment is proximity-weighted: the near ant is picked far more often", () => {
        const base = createInitialState(7);

        // Build a controlled state: 1 corpse, one candidate on it, one
        // candidate across the nest, plus two ineligible workers so the
        // MAX_UNDERTAKER_FRACTION cap still allows one pick.
        const mk = (id: string, pos: { x: number; y: number }, over: Partial<Ant> = {}): Ant => ({
            id,
            name: id,
            caste: "WORKER",
            job: "FORAGER",
            carrying: [],
            carryingFood: 0,
            undertaking: undefined,
            location: { where: "nest", pos },
            energy: 1500,
            ageTicks: 300,
            lifespanTicks: 900,
            ...over,
        });

        const corpsePos = { x: 12, y: 4 };
        const near = mk("ant-near", corpsePos);
        const far = mk("ant-far", { x: 5, y: 8 });
        const filler1 = mk("ant-fill-1", corpsePos, { carryingFood: 10 });
        const filler2 = mk("ant-fill-2", corpsePos, { carryingFood: 10 });

        let nearPicks = 0;
        let farPicks = 0;
        const trials = 200;

        for (let seed = 0; seed < trials; seed++) {
            const state = {
                ...base,
                rngSeed: seed * 2654435761 >>> 0,
                ants: new Map([near, far, filler1, filler2].map((a) => [a.id, { ...a }])),
                corpses: [nestCorpse("corpse-x", corpsePos)],
            };

            const { ants } = assignUndertakers(state);
            if (ants.get("ant-near")!.undertaking !== undefined) nearPicks++;
            if (ants.get("ant-far")!.undertaking !== undefined) farPicks++;
        }

        // Exactly one assignment per trial.
        expect(nearPicks + farPicks).toBe(trials);
        // near (dist 0, weight 1) vs far (dist ~11, weight ~1/12): near should
        // dominate — well over half, comfortably past 75%.
        expect(nearPicks / trials).toBeGreaterThan(0.8);
        // ...but not deterministic — the far ant does get picked sometimes.
        expect(farPicks).toBeGreaterThan(0);
    });

    it("assignUndertakers is deterministic for a given seed", () => {
        let state = createInitialState(555);
        for (let t = 0; t < 700; t++) state = step(state, 1).state;
        state = {
            ...state,
            corpses: [
                nestCorpse("c1", { x: 12, y: 4 }),
                nestCorpse("c2", { x: 12, y: 8 }),
                nestCorpse("c3", { x: 6, y: 8 }),
            ],
        };

        const a = assignUndertakers(state);
        const b = assignUndertakers(state);

        expect(a.rngSeed).toBe(b.rngSeed);
        const undA = [...a.ants.values()].filter((x) => x.undertaking).map((x) => `${x.id}:${x.undertaking!.corpseId}`).sort();
        const undB = [...b.ants.values()].filter((x) => x.undertaking).map((x) => `${x.id}:${x.undertaking!.corpseId}`).sort();
        expect(undA).toEqual(undB);
    });
});
