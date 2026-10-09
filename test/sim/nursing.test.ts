import { describe, expect, it } from "vitest";

import type { Ant } from "../../src/sim/ants/ant";
import type { Perception } from "../../src/sim/ants/senses";
import { decideNurse } from "../../src/sim/ants/nursing";
import { NURSE_EGG_CAPACITY } from "../../src/sim/params";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";

function makeAnt(overrides: Partial<Ant> = {}): Ant {
    return {
        id: "nurse-1",
        name: "nurse-1",
        caste: "WORKER",
        job: "NURSE",
        carrying: [],
        carryingFood: 0,
        location: { where: "nest", pos: { x: 40, y: 40 } },
        energy: 1000,
        ageTicks: 300,
        lifespanTicks: 2000,
        ...overrides,
    };
}

function makePerception(overrides: Partial<Perception> = {}): Perception {
    return {
        where: "nest",
        currentChamber: "NURSERY",
        currentChamberId: undefined,
        queenEggPos: undefined,
        nurseryPlacementPos: undefined,
        broodNeedingTendPos: undefined,
        broodUrgentTendPos: undefined,
        eggsWaitingCount: 0,
        queenHungry: false,
        queenPos: { x: 40, y: 5 },
        atExitMouth: false,
        atHole: false,
        holePos: { x: 20, y: 27 },
        onFoodPileId: undefined,
        nearestFoodPilePos: undefined,
        trailNeighbor: undefined,
        rememberedFoodPos: undefined,
        nearestPatchTarget: undefined,
        barrenPatchIndex: undefined,
        inGraveyard: false,
        graveyardCentre: { x: 0, y: 0 },
        carrying: [],
        hungerRatio: 0.9,
        eggsAvailableInQueenChamber: false,
        assignedCorpse: undefined,
        assignedCorpseBuried: false,
        carryingCorpse: false,
        onAssignedCorpse: false,
        graveyardPos: { x: 0, y: 0 },
        atGraveyardSlot: false,
        ...overrides,
    };
}

describe("decideNurse — ferry loop", () => {
    it("fills up to NURSE_EGG_CAPACITY before delivering: keeps fetching while carrying < cap and eggs wait", () => {
        // carrying 1, more eggs available -> go get another, don't deliver yet
        const carryingOne = makeAnt({ carrying: ["brood-1"], location: { where: "nest", pos: { x: 41, y: 6 } } });
        expect(
            decideNurse(carryingOne, makePerception({
                carrying: ["brood-1"],
                eggsAvailableInQueenChamber: true,
                eggsWaitingCount: 5,
                queenEggPos: { x: 40, y: 5 },
                nurseryPlacementPos: { x: 30, y: 40 },
            })),
        ).toEqual({ type: "moveToNestPoint", target: { x: 40, y: 5 } });
    });

    it("delivers once carrying a full load, even with eggs still waiting", () => {
        const full = Array.from({ length: NURSE_EGG_CAPACITY }, (_, i) => `brood-${i}`);
        const laden = makeAnt({ carrying: full, location: { where: "nest", pos: { x: 30, y: 40 } } });
        expect(
            decideNurse(laden, makePerception({
                carrying: full,
                eggsAvailableInQueenChamber: true,
                eggsWaitingCount: 9,
                queenEggPos: { x: 40, y: 5 },
                nurseryPlacementPos: { x: 30, y: 40 },
            })),
        ).toEqual({ type: "placeEgg" });
    });

    it("delivers a partial load when the queen chamber has run dry", () => {
        const laden = makeAnt({ carrying: ["brood-1"], location: { where: "nest", pos: { x: 31, y: 41 } } });
        expect(
            decideNurse(laden, makePerception({
                carrying: ["brood-1"],
                eggsAvailableInQueenChamber: false,
                nurseryPlacementPos: { x: 30, y: 40 },
            })),
        ).toEqual({ type: "moveToNestPoint", target: { x: 30, y: 40 } });
    });

    it("ferries waiting eggs before tending merely-due brood", () => {
        const idle = makeAnt();
        expect(
            decideNurse(idle, makePerception({
                eggsAvailableInQueenChamber: true,
                eggsWaitingCount: 2,
                queenEggPos: { x: 40, y: 5 },
                broodNeedingTendPos: { x: 45, y: 42 },
            })),
        ).toEqual({ type: "moveToNestPoint", target: { x: 40, y: 5 } });
    });

    it("but drops the ferry to tend brood that's about to die", () => {
        const idle = makeAnt();
        expect(
            decideNurse(idle, makePerception({
                eggsAvailableInQueenChamber: true,
                eggsWaitingCount: 2,
                queenEggPos: { x: 40, y: 5 },
                broodUrgentTendPos: { x: 45, y: 42 },
            })),
        ).toEqual({ type: "moveToNestPoint", target: { x: 45, y: 42 } });
    });

    it("tends due brood when there's nothing to ferry", () => {
        const onTile = makeAnt({ location: { where: "nest", pos: { x: 45, y: 42 } } });
        expect(
            decideNurse(onTile, makePerception({ broodNeedingTendPos: { x: 45, y: 42 } })),
        ).toEqual({ type: "tendBrood" });
    });
});

describe("nursing in a running colony", () => {
    it("nurses actually carry multi-egg loads, and brood is raised without a mass die-off", () => {
        let state = createInitialState(12345);
        let maxLoad = 0;
        let births = 0;
        let lost = 0;

        for (let t = 0; t < 2000; t++) {
            const r = step(state, 1);
            state = r.state;
            for (const e of r.events) {
                if (e.kind === "birth") births += 1;
                if (e.kind === "broodLost") lost += 1;
            }
            for (const ant of state.ants.values()) {
                if (ant.caste === "WORKER") maxLoad = Math.max(maxLoad, ant.carrying.length);
            }
        }

        expect(maxLoad).toBeGreaterThan(1); // batching happens
        expect(births).toBeGreaterThan(20);
        expect(lost).toBeLessThan(births / 4); // not a nursery collapse
    });

    it("keeps foragers >= nurses at every tick", () => {
        let state = createInitialState(4001);
        for (let t = 0; t < 2500; t++) {
            state = step(state, 1).state;
            let nurses = 0;
            let foragers = 0;
            for (const a of state.ants.values()) {
                if (a.caste !== "WORKER") continue;
                if (a.job === "NURSE") nurses += 1;
                else foragers += 1;
            }
            expect(foragers).toBeGreaterThanOrEqual(nurses);
        }
    });
});
