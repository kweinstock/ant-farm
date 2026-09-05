import { describe, expect, it } from "vitest";

import type { Ant } from "../../src/sim/ants/ant";
import type { Perception } from "../../src/sim/ants/senses";
import { decide } from "../../src/sim/ants/behavior";

// Hand-built, not derived from createInitialState — decide() is pure (ant +
// perception in, one Action out), so it doesn't need a real ColonyState,
// grid, or RNG to test. That's the whole point of keeping behavior.ts
// separate from senses.ts and jobs.ts.
function makeAnt(overrides: Partial<Ant> = {}): Ant {
    return {
        id: "ant-test",
        name: "ant-test",
        caste: "WORKER",
        job: "FORAGER",
        position: { x: 0, y: 0 },
        energy: 750,
        ageTicks: 200,
        lifespanTicks: 800,
        ...overrides,
    };
}

function makePerception(overrides: Partial<Perception> = {}): Perception {
    return {
        onFoodPileIndex: undefined,
        nearBroodId: undefined,
        hungerRatio: 0.9,
        ...overrides,
    };
}

describe("decide", () => {
    it("eats when hunger is below threshold and standing on food", () => {
        const ant = makeAnt({ job: "FORAGER" });
        const perception = makePerception({ onFoodPileIndex: 2, hungerRatio: 0.2 });

        expect(decide(ant, perception)).toEqual({ type: "eat", pileIndex: 2 });
    });

    it("tends brood when the ant is a nurse near an untended entry", () => {
        const ant = makeAnt({ job: "NURSE" });
        const perception = makePerception({ nearBroodId: "brood-1", hungerRatio: 0.9 });

        expect(decide(ant, perception)).toEqual({ type: "tend", broodId: "brood-1" });
    });

    it("wanders when neither rule matches", () => {
        const ant = makeAnt({ job: "FORAGER" });
        const perception = makePerception();

        expect(decide(ant, perception)).toEqual({ type: "wander" });
    });

    it("eats before tending, even for a hungry nurse standing on food near brood", () => {
        // Same ant/perception qualifies for both "eat" and "tend" — this is
        // the test that actually exercises "first match wins," not just that
        // each rule works when it's the only one that could fire.
        const ant = makeAnt({ job: "NURSE" });
        const perception = makePerception({
            onFoodPileIndex: 0,
            nearBroodId: "brood-1",
            hungerRatio: 0.1,
        });

        expect(decide(ant, perception)).toEqual({ type: "eat", pileIndex: 0 });
    });
});