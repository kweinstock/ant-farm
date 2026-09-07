import { describe, expect, it } from "vitest";

import type { Ant } from "../../src/sim/ants/ant";
import type { Perception } from "../../src/sim/ants/senses";
import { decide } from "../../src/sim/ants/behavior";

// Hand-built, not derived from createInitialState — decide() / decideForager()
// are pure (ant + perception in, one Action out), so no real ColonyState,
// nest, surface, or RNG needed.
function makeAnt(overrides: Partial<Ant> = {}): Ant {
    return {
        id: "ant-test",
        name: "ant-test",
        caste: "WORKER",
        job: "FORAGER",
        carrying: [],
        carryingFood: 0,
        location: { where: "nest", pos: { x: 0, y: 0 } },
        energy: 1200,
        ageTicks: 200,
        lifespanTicks: 800,
        ...overrides,
    };
}

function makePerception(overrides: Partial<Perception> = {}): Perception {
    return {
        where: "nest",
        currentChamber: "COMMONS",
        atExitMouth: false,
        atHole: false,
        holePos: { x: 20, y: 27 },
        onFoodPileId: undefined,
        nearestFoodPilePos: undefined,
        carrying: [],
        hungerRatio: 0.9,
        eggsAvailableInQueenChamber: false,
        ...overrides,
    };
}

describe("decide — nest rules", () => {
    it("carrying an egg heads for the nursery", () => {
        const ant = makeAnt({ job: "NURSE", carrying: ["brood-1"] });
        expect(decide(ant, makePerception({ carrying: ["brood-1"] }))).toEqual({ type: "goto", role: "NURSERY" });
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

    it("hungry in the nest heads for / eats at the food store", () => {
        expect(decide(makeAnt(), makePerception({ hungerRatio: 0.2 }))).toEqual({ type: "goto", role: "FOOD_STORAGE" });
        expect(
            decide(makeAnt(), makePerception({ hungerRatio: 0.2, currentChamber: "FOOD_STORAGE" }))
        ).toEqual({ type: "eat" });
    });

    it("a nurse with eggs waiting heads for / picks up in the queen chamber", () => {
        const ant = makeAnt({ job: "NURSE" });
        expect(decide(ant, makePerception({ eggsAvailableInQueenChamber: true }))).toEqual({ type: "goto", role: "QUEEN" });
        expect(
            decide(ant, makePerception({ eggsAvailableInQueenChamber: true, currentChamber: "QUEEN" }))
        ).toEqual({ type: "pickUpEgg" });
    });

    it("a nurse with no eggs to fetch defaults to the commons", () => {
        const ant = makeAnt({ job: "NURSE" });
        expect(decide(ant, makePerception({ currentChamber: "QUEEN" }))).toEqual({ type: "goto", role: "COMMONS" });
        expect(decide(ant, makePerception({ currentChamber: "COMMONS" }))).toEqual({ type: "mill" });
    });
});

describe("decide — forager round trip (rule 4 -> decideForager)", () => {
    it("nest, no load, not at the mouth -> walk to the exit", () => {
        expect(decide(makeAnt(), makePerception())).toEqual({ type: "goto", role: "EXIT" });
    });

    it("nest, no load, at the mouth -> cross out", () => {
        expect(decide(makeAnt(), makePerception({ currentChamber: "EXIT", atExitMouth: true }))).toEqual({
            type: "crossExit",
        });
    });

    it("a forager ignores waiting eggs (rule 4 catches it before rule 5)", () => {
        expect(
            decide(makeAnt({ job: "FORAGER" }), makePerception({ eggsAvailableInQueenChamber: true, currentChamber: "QUEEN" }))
        ).toEqual({ type: "goto", role: "EXIT" });
    });

    it("surface, no load, sees a pile -> step toward it", () => {
        const perception = makePerception({ where: "surface", currentChamber: undefined, nearestFoodPilePos: { x: 5, y: 5 } });
        expect(decide(makeAnt({ location: { where: "surface", pos: { x: 1, y: 1 } } }), perception)).toEqual({
            type: "surfaceStep",
            target: { x: 5, y: 5 },
        });
    });

    it("surface, no load, standing on a pile -> pick it up", () => {
        const perception = makePerception({ where: "surface", currentChamber: undefined, onFoodPileId: "pile-3" });
        expect(decide(makeAnt({ location: { where: "surface", pos: { x: 5, y: 5 } } }), perception)).toEqual({
            type: "pickUpFood",
        });
    });

    it("surface, no load, no pile in sight -> wander", () => {
        const perception = makePerception({ where: "surface", currentChamber: undefined });
        expect(decide(makeAnt({ location: { where: "surface", pos: { x: 1, y: 1 } } }), perception)).toEqual({
            type: "surfaceWander",
        });
    });

    it("surface, carrying a load -> walk to the hole, then cross in", () => {
        const carrying = makeAnt({ carryingFood: 80, location: { where: "surface", pos: { x: 1, y: 1 } } });
        expect(decide(carrying, makePerception({ where: "surface", currentChamber: undefined }))).toEqual({
            type: "surfaceStep",
            target: { x: 20, y: 27 },
        });
        expect(decide(carrying, makePerception({ where: "surface", currentChamber: undefined, atHole: true }))).toEqual({
            type: "crossExit",
        });
    });

    it("surface, hungry and empty-handed -> also heads home (was the bug: it used to mill on the hole forever)", () => {
        const hungry = makeAnt({ location: { where: "surface", pos: { x: 1, y: 1 } } });
        expect(
            decide(hungry, makePerception({ where: "surface", currentChamber: undefined, hungerRatio: 0.2 }))
        ).toEqual({ type: "surfaceStep", target: { x: 20, y: 27 } });
        expect(
            decide(hungry, makePerception({ where: "surface", currentChamber: undefined, hungerRatio: 0.2, atHole: true }))
        ).toEqual({ type: "crossExit" });
    });

    it("nest, carrying a load -> deliver to the food store", () => {
        const carrying = makeAnt({ carryingFood: 80 });
        expect(decide(carrying, makePerception())).toEqual({ type: "goto", role: "FOOD_STORAGE" });
        expect(decide(carrying, makePerception({ currentChamber: "FOOD_STORAGE" }))).toEqual({ type: "depositFood" });
    });
});
