import { describe, expect, it } from "vitest";

import type { Ant } from "../../src/sim/ants/ant";
import type { Perception } from "../../src/sim/ants/senses";
import { decide } from "../../src/sim/ants/behavior";

// Hand-built, not derived from createInitialState — decide() is pure (ant +
// perception in, one Action out), so it doesn't need a real ColonyState,
// nest, or RNG to test.
function makeAnt(overrides: Partial<Ant> = {}): Ant {
    return {
        id: "ant-test",
        name: "ant-test",
        caste: "WORKER",
        job: "FORAGER",
        carrying: [],
        position: { x: 0, y: 0 },
        energy: 1200,
        ageTicks: 200,
        lifespanTicks: 800,
        ...overrides,
    };
}

function makePerception(overrides: Partial<Perception> = {}): Perception {
    return {
        currentChamber: "COMMONS",
        carrying: [],
        hungerRatio: 0.9,
        eggsAvailableInQueenChamber: false,
        ...overrides,
    };
}

describe("decide", () => {
    it("carrying an egg heads for the nursery", () => {
        const ant = makeAnt({ job: "NURSE", carrying: ["brood-1"] });
        expect(decide(ant, makePerception({ carrying: ["brood-1"], currentChamber: "COMMONS" }))).toEqual({
            type: "goto",
            role: "NURSERY",
        });
    });

    it("carrying an egg while in the nursery places it", () => {
        const ant = makeAnt({ job: "NURSE", carrying: ["brood-1"] });
        expect(decide(ant, makePerception({ carrying: ["brood-1"], currentChamber: "NURSERY" }))).toEqual({
            type: "placeEgg",
        });
    });

    it("carrying an egg beats hunger (rule 1 before rule 2)", () => {
        const ant = makeAnt({ job: "NURSE", carrying: ["brood-1"] });
        expect(
            decide(ant, makePerception({ carrying: ["brood-1"], currentChamber: "FOOD_STORAGE", hungerRatio: 0.1 }))
        ).toEqual({ type: "goto", role: "NURSERY" });
    });

    it("hungry and not in the food store heads there", () => {
        expect(
            decide(makeAnt(), makePerception({ hungerRatio: 0.2, currentChamber: "COMMONS" }))
        ).toEqual({ type: "goto", role: "FOOD_STORAGE" });
    });

    it("hungry and in the food store eats", () => {
        expect(
            decide(makeAnt(), makePerception({ hungerRatio: 0.2, currentChamber: "FOOD_STORAGE" }))
        ).toEqual({ type: "eat" });
    });

    it("a nurse with eggs waiting heads for the queen chamber", () => {
        const ant = makeAnt({ job: "NURSE" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: true, currentChamber: "COMMONS" }))
        ).toEqual({ type: "goto", role: "QUEEN" });
    });

    it("a nurse in the queen chamber with eggs waiting picks one up", () => {
        const ant = makeAnt({ job: "NURSE" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: true, currentChamber: "QUEEN" }))
        ).toEqual({ type: "pickUpEgg" });
    });

    it("a non-nurse ignores waiting eggs", () => {
        const ant = makeAnt({ job: "FORAGER" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: true, currentChamber: "QUEEN" }))
        ).toEqual({ type: "goto", role: "EXIT" });
    });

    it("a forager with nothing pressing heads for the exit; mills once there", () => {
        const ant = makeAnt({ job: "FORAGER" });
        expect(decide(ant, makePerception({ currentChamber: "COMMONS" }))).toEqual({
            type: "goto",
            role: "EXIT",
        });
        expect(decide(ant, makePerception({ currentChamber: "EXIT" }))).toEqual({ type: "mill" });
    });

    it("a nurse with no eggs to fetch defaults to the commons", () => {
        const ant = makeAnt({ job: "NURSE" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: false, currentChamber: "QUEEN" }))
        ).toEqual({ type: "goto", role: "COMMONS" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: false, currentChamber: "COMMONS" }))
        ).toEqual({ type: "mill" });
    });
});
