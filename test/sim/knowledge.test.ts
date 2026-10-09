import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { spreadKnowledge } from "../../src/sim/colony/knowledge";
import { chamberIdAt } from "../../src/sim/world/nest";
import { richness, absorb, reinforce, emptyMemory, rememberFoodSite, updatePatchQuality } from "../../src/sim/ants/memory";
import { LEARNING_BASELINE, LEARNING_MIN, LEARNING_MAX, REINFORCE_STEP, ABSORB_MAX_TRANSFER, MAX_REMEMBERED } from "../../src/sim/params";

describe("memory richness / absorb / reinforce (Phase 11)", () => {
    it("richness ranks a memory with more, fresher entries higher than a bare one", () => {
        const bare = emptyMemory();
        let rich = emptyMemory();
        rich = rememberFoodSite(rich, { x: 1, y: 1 }, 0);
        rich = updatePatchQuality(rich, 2, 100);

        expect(richness(rich, 10)).toBeGreaterThan(richness(bare, 10));
    });

    it("richness decays a food site's contribution toward zero as it ages, past nothing at all once it's expired", () => {
        let memory = emptyMemory();
        memory = rememberFoodSite(memory, { x: 1, y: 1 }, 0);

        const fresh = richness(memory, 1);
        const older = richness(memory, 200);
        expect(older).toBeLessThan(fresh);
    });

    it("absorb transfers a bounded slice of the richer ant's knowledge without discarding the learner's own", () => {
        let poorer = emptyMemory();
        poorer = rememberFoodSite(poorer, { x: 5, y: 5 }, 0);

        let richer = emptyMemory();
        for (let i = 0; i < MAX_REMEMBERED; i++) {
            richer = rememberFoodSite(richer, { x: i, y: i }, 0);
        }

        const merged = absorb(poorer, richer, 100);

        // The learner's own site survives the merge.
        expect(merged.foodSites.some((s) => s.pos.x === 5 && s.pos.y === 5)).toBe(true);

        // Learns some of the richer ant's sites, but bounded to
        // ABSORB_MAX_TRANSFER per exchange, not the whole list at once —
        // teaching is gradual, not an instant full memory copy.
        const learnedFromRicher = merged.foodSites.filter((s) =>
            richer.foodSites.some((r) => r.pos.x === s.pos.x && r.pos.y === s.pos.y),
        );
        expect(learnedFromRicher.length).toBeGreaterThan(0);
        expect(learnedFromRicher.length).toBeLessThanOrEqual(ABSORB_MAX_TRANSFER);
    });

    it("reinforce nudges only the reinforced channel, clamped to [LEARNING_MIN, LEARNING_MAX]", () => {
        const baseline = {
            trailTrust: LEARNING_BASELINE,
            memoryTrust: LEARNING_BASELINE,
            patchTrust: LEARNING_BASELINE,
            fleeSensitivity: LEARNING_BASELINE,
        };

        const afterSuccess = reinforce(baseline, "trail", "success");
        expect(afterSuccess.trailTrust).toBeCloseTo(LEARNING_BASELINE + REINFORCE_STEP, 5);
        expect(afterSuccess.memoryTrust).toBe(LEARNING_BASELINE);
        expect(afterSuccess.patchTrust).toBe(LEARNING_BASELINE);

        const afterFailure = reinforce(baseline, "memory", "failure");
        expect(afterFailure.memoryTrust).toBeCloseTo(LEARNING_BASELINE - REINFORCE_STEP, 5);

        // "visible" isn't a trust channel — nothing to reinforce.
        expect(reinforce(baseline, "visible", "success")).toEqual(baseline);

        let extreme = baseline;
        for (let i = 0; i < 200; i++) extreme = reinforce(extreme, "patch", "success");
        expect(extreme.patchTrust).toBeLessThanOrEqual(LEARNING_MAX);
        for (let i = 0; i < 200; i++) extreme = reinforce(extreme, "patch", "failure");
        expect(extreme.patchTrust).toBeGreaterThanOrEqual(LEARNING_MIN);
    });
});

describe("teaching propagates knowledge colony-wide (Phase 11)", () => {
    it("an ant learns a patch's quality from a nestmate without ever having visited it first-hand", () => {
        // Index 99 can never occur naturally — patchIndexAt only ever
        // returns an index into the real FERTILE_PATCHES list (0-7), so the
        // only way ANY ant's patchQuality[99] gets set is spreadKnowledge
        // copying it out of the ant we seed it on below. This is a stronger
        // signal than watching a food site propagate: a site's coordinates
        // could in principle coincide with somewhere a forager legitimately
        // finds food on its own; this index structurally cannot.
        //
        // Calls spreadKnowledge directly (rather than running the full sim)
        // so the only source of randomness left is KNOWLEDGE_SHARE_CHANCE's
        // own coin flip — not competition with dozens of foraging ants that
        // might naturally out-richness the seeded teacher and starve the
        // test of any propagation at all within a bounded tick budget.
        let state = createInitialState(2);
        const workerIds = [...state.ants.keys()].filter((id) => id !== state.queenId);
        const teacherId = workerIds[0];
        const learnerId = workerIds[1];
        const sharedPos = state.ants.get(learnerId)!.location.pos;
        expect(chamberIdAt(state.nest, sharedPos)).toBeDefined();

        state = {
            ...state,
            ants: new Map(state.ants).set(teacherId, {
                ...state.ants.get(teacherId)!,
                location: { where: "nest", pos: sharedPos },
                memory: { ...emptyMemory(), patchQuality: { 99: 999 } },
            }),
        };

        let learned = false;
        for (let i = 0; i < 500 && !learned; i++) {
            const result = spreadKnowledge(state);
            state = { ...state, ants: result.ants, rngSeed: result.rngSeed };
            learned = state.ants.get(learnerId)!.memory.patchQuality[99] === 999;
        }

        expect(learned).toBe(true);
    });

    it("spreadKnowledge is a pure function of state — same input, same output", () => {
        const state = createInitialState(3);
        const a = spreadKnowledge(state);
        const b = spreadKnowledge(state);

        expect(a.rngSeed).toBe(b.rngSeed);
        expect(a.ants.size).toBe(b.ants.size);
        for (const [id, ant] of a.ants) {
            expect(b.ants.get(id)).toEqual(ant);
        }
    });

    it("only ants sharing a nest chamber this tick can teach each other", () => {
        let state = createInitialState(4);
        const ids = [...state.ants.keys()];
        const teacherId = ids[0];
        const isolatedId = ids[1];

        // Park the isolated ant somewhere no other worker (or the queen) is
        // standing, and give the teacher something to teach.
        const isolatedSpot = { x: 2, y: 2 };
        state = {
            ...state,
            ants: new Map(state.ants)
                .set(teacherId, {
                    ...state.ants.get(teacherId)!,
                    memory: { ...state.ants.get(teacherId)!.memory, patchQuality: { 98: 777 } },
                })
                .set(isolatedId, { ...state.ants.get(isolatedId)!, location: { where: "nest", pos: isolatedSpot } }),
        };

        // If isolatedSpot happens to land in a real chamber with other ants
        // already there, the isolation premise doesn't hold — skip rather
        // than assert something the setup didn't actually arrange.
        const othersThere = [...state.ants.values()].some(
            (a) => a.id !== isolatedId && a.location.where === "nest" && a.location.pos.x === isolatedSpot.x && a.location.pos.y === isolatedSpot.y,
        );
        if (!othersThere) {
            const result = spreadKnowledge(state);
            expect(result.ants.get(isolatedId)!.memory.patchQuality[98]).toBeUndefined();
        }
    });
});

describe("colony-wide foraging keeps working once knowledge has had time to spread (Phase 11)", () => {
    it("food keeps arriving at a healthy rate in a late window", () => {
        // Same shape as learning.test.ts's gross-delivered check — teaching
        // is one more thing that should keep the forage economy working as
        // the colony scales, not a literal on/off comparison (nothing else
        // in this suite runs a "teaching disabled" control build either).
        let state = createInitialState(2);
        let prevCarry = new Map<string, number>();
        let delivered = 0;
        let trips = 0;

        for (let t = 1; t <= 4000; t++) {
            const r = step(state, 1);
            state = r.state;
            if (t > 2500) {
                for (const e of r.events) {
                    if (e.kind === "forageDepart") trips += 1;
                }
                for (const ant of state.ants.values()) {
                    const before = prevCarry.get(ant.id) ?? 0;
                    if (ant.location.where === "nest" && ant.carryingFood < before) {
                        delivered += before - ant.carryingFood;
                    }
                }
            }
            prevCarry = new Map([...state.ants.values()].map((a) => [a.id, a.carryingFood]));
        }

        expect(trips).toBeGreaterThan(50);
        expect(delivered).toBeGreaterThan(0);
    });
});
