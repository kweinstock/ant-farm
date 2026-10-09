import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import type { SimEvent } from "../../src/sim";
import { emptyTally, addTick, statEvents, parseTally } from "../../src/shared/tally";

describe("tally", () => {
    it("matches an independent count of the raw event stream over a long run", () => {
        let state = createInitialState(12345);
        const tally = emptyTally();
        const raw = { births: 0, deaths: 0, departs: 0, strikes: 0 };
        let delivered = 0;

        for (let i = 0; i < 4000; i++) {
            const before = state.foodStore.amount;
            const result = step(state, 1);
            state = result.state;
            addTick(tally, result.events, before, state.foodStore.amount);

            for (const e of result.events) {
                if (e.kind === "birth") raw.births += 1;
                if (e.kind === "death") raw.deaths += 1;
                if (e.kind === "forageDepart") raw.departs += 1;
                if (e.kind === "predatorStrike") raw.strikes += 1;
            }
            if (state.foodStore.amount > before) delivered += state.foodStore.amount - before;
        }

        expect(tally.births).toBe(raw.births);
        expect(tally.deathsTotal).toBe(raw.deaths);
        expect(tally.forageDeparts).toBe(raw.departs);
        expect(tally.predatorStrikes).toBe(raw.strikes);
        expect(tally.foodDelivered).toBe(delivered);
        // The run has to actually exercise the counters, or this proves nothing.
        expect(raw.departs).toBeGreaterThan(0);
        expect(delivered).toBeGreaterThan(0);
    });

    it("deaths by cause and by location add up to the total", () => {
        const tally = emptyTally();
        const death = (cause: "starvation" | "oldAge", where: "nest" | "surface"): SimEvent => ({
            kind: "death", antId: "a1", ageTicks: 1, where, cause, caste: "WORKER", job: "FORAGER",
        });
        addTick(tally, [death("starvation", "nest"), death("oldAge", "surface"), death("starvation", "surface")], 0, 0);

        expect(tally.deathsTotal).toBe(3);
        expect(tally.deathsByCause.starvation).toBe(2);
        expect(tally.deathsByCause.oldAge).toBe(1);
        expect(tally.deathsByLocation).toEqual({ nest: 1, surface: 2 });
    });

    it("counts births, forage departures and predator strikes, and food only when the store rises", () => {
        const tally = emptyTally();
        addTick(tally, [
            { kind: "birth", antId: "a1", ageTicks: 0 },
            { kind: "birth", antId: "a2", ageTicks: 0 },
            { kind: "forageDepart", antId: "a1" },
            { kind: "predatorStrike", antId: "a1" },
        ], 100, 160);
        addTick(tally, [], 160, 150); // store fell (eating): not a delivery

        expect(tally.births).toBe(2);
        expect(tally.forageDeparts).toBe(1);
        expect(tally.predatorStrikes).toBe(1);
        expect(tally.foodDelivered).toBe(60);
        expect(tally.deathsTotal).toBe(0);
    });

    it("statEvents keeps only the kinds that are counted or tracked", () => {
        const events: SimEvent[] = [
            { kind: "weatherChanged", from: "CLEAR", to: "RAIN" },
            { kind: "predatorAppeared" },
            { kind: "birth", antId: "a2", ageTicks: 0 },
            { kind: "forageDepart", antId: "a2" },
            { kind: "predatorStrike", antId: "a2" },
        ];
        expect(statEvents(events).map((e) => e.kind)).toEqual(["birth", "forageDepart", "predatorStrike"]);
    });

    it("parseTally starts from zero for missing or malformed saves, and keeps a good one", () => {
        expect(parseTally(undefined)).toEqual(emptyTally());
        expect(parseTally("nonsense")).toEqual(emptyTally());
        expect(parseTally({ births: "many" })).toEqual(emptyTally());

        const good = emptyTally();
        good.births = 7;
        good.deathsByCause.cold = 2;
        good.deathsTotal = 2;
        expect(parseTally(structuredClone(good))).toEqual(good);
    });
});
