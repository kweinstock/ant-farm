import { describe, it, expect } from "vitest";
import { createInitialState, type ColonyState } from "../../src/sim/state";
import { step } from "../../src/sim";
import {
    givenNameFor, founderSurname, fullName, surnameOf, queueSurname, claimSurname,
    SURNAME_QUEUE_CAP, HEIRS_CAP,
} from "../../src/sim/names/generator";
import { SURNAMES } from "../../src/sim/names/wordlists";
import { STARTER_WORKER_COUNT } from "../../src/sim/params";

describe("names: generator", () => {
    it("is a pure function of the ant id", () => {
        expect(givenNameFor("ant-7")).toBe(givenNameFor("ant-7"));
        expect(fullName("Ada", "Barrow")).toBe("Ada Barrow");
        expect(surnameOf("Ada Barrow")).toBe("Barrow");
        expect(surnameOf("Ada Yarrow-Finch")).toBe("Yarrow-Finch");
    });

    it("has enough surnames for every founder to start a distinct line", () => {
        expect(SURNAMES.length).toBeGreaterThan(STARTER_WORKER_COUNT + 1);
        const founders = new Set(Array.from({ length: STARTER_WORKER_COUNT + 1 }, (_, i) => founderSurname(i)));
        expect(founders.size).toBe(STARTER_WORKER_COUNT + 1);
    });

    it("an empty queue gives the queen's founding surname and no heir", () => {
        const claim = claimSurname([], {}, "ant-50");
        expect(claim.surname).toBe(founderSurname(0));
        expect(claim.heirs).toEqual({});
    });

    it("the next claim takes the oldest dead ant's surname and becomes its heir", () => {
        let queue = queueSurname([], "ant-1", "Ada Barrow");
        queue = queueSurname(queue, "ant-2", "Bea Cobb");
        const first = claimSurname(queue, {}, "ant-50");
        expect(first.surname).toBe("Barrow");
        expect(first.heirs).toEqual({ "ant-1": "ant-50" });
        const second = claimSurname(first.queue, first.heirs, "ant-51");
        expect(second.surname).toBe("Cobb");
        expect(second.heirs).toEqual({ "ant-1": "ant-50", "ant-2": "ant-51" });
    });

    it("the queue and the heirs map stay bounded, dropping the oldest", () => {
        let queue: ReturnType<typeof queueSurname> = [];
        for (let i = 0; i < SURNAME_QUEUE_CAP + 10; i++) queue = queueSurname(queue, `dead-${i}`, "Ada Barrow");
        expect(queue.length).toBe(SURNAME_QUEUE_CAP);
        expect(queue[0].deadId).toBe("dead-10");

        let heirs: Record<string, string> = {};
        for (let i = 0; i < HEIRS_CAP + 10; i++) {
            heirs = claimSurname([{ deadId: `dead-${i}`, surname: "Barrow" }], heirs, `new-${i}`).heirs;
        }
        expect(Object.keys(heirs).length).toBe(HEIRS_CAP);
        expect(heirs["dead-0"]).toBeUndefined();
        expect(heirs[`dead-${HEIRS_CAP + 9}`]).toBe(`new-${HEIRS_CAP + 9}`);
    });
});

describe("names: in the sim", () => {
    const run = (s: ColonyState, ticks: number) => {
        for (let i = 0; i < ticks; i++) s = step(s, 1).state;
        return s;
    };

    it("founders each start a distinct surname line, and everyone has a full name", () => {
        const state = createInitialState(12345);
        const surnames = [...state.ants.values()].map((ant) => surnameOf(ant.name));
        expect(new Set(surnames).size).toBe(state.ants.size);
        for (const ant of state.ants.values()) expect(ant.name).toMatch(/^\S+ \S+$/);
    });

    it("two runs of the same seed give identical names", () => {
        const names = (s: ColonyState) => [...s.ants.values()].map((a) => `${a.id}:${a.name}`);
        expect(names(run(createInitialState(12345), 6000))).toEqual(names(run(createInitialState(12345), 6000)));
    });

    it("a hatched ant inherits a dead ant's surname and is recorded as its heir", () => {
        let state = run(createInitialState(12345), 2000);
        // Force an old-age death so the test doesn't depend on when the sim's own
        // first death happens.
        const victim = [...state.ants.values()].find((ant) => ant.caste === "WORKER")!;
        const victimSurname = surnameOf(victim.name);
        const ants = new Map(state.ants);
        ants.set(victim.id, { ...victim, ageTicks: victim.lifespanTicks });
        state = { ...state, ants };

        let heirId: string | undefined;
        for (let i = 0; i < 4000 && heirId === undefined; i++) {
            state = step(state, 1).state;
            heirId = state.heirs[victim.id];
        }
        expect(state.ants.has(victim.id)).toBe(false);
        expect(heirId).toBeDefined();
        expect(surnameOf(state.ants.get(heirId!)!.name)).toBe(victimSurname);
        expect(state.surnameQueue.length).toBeLessThanOrEqual(SURNAME_QUEUE_CAP);
        expect(Object.keys(state.heirs).length).toBeLessThanOrEqual(HEIRS_CAP);
    });
});

// Names are cosmetic and must never move the simulation. These numbers were
// recorded from the code BEFORE names existed (population every 1000 ticks,
// totals and the RNG state at tick 40,000, seed 12345); the tuned params in
// params.ts were optimized against exactly this run.
describe("names do not change the simulation", () => {
    it("seed 12345 follows the pre-names trajectory", () => {
        let s = createInitialState(12345);
        const pops: number[] = [];
        let births = 0;
        let deaths = 0;
        for (let t = 1; t <= 40000; t++) {
            const r = step(s, 1);
            s = r.state;
            for (const e of r.events) {
                if (e.kind === "birth") births++;
                if (e.kind === "death") deaths++;
            }
            if (t % 1000 === 0) pops.push(s.ants.size);
        }
        expect(pops).toEqual([24, 25, 31, 32, 41, 46, 49, 50, 50, 51, 53, 53, 54, 54, 53, 55, 55, 58, 57, 59, 62, 62, 64, 64,
            66, 68, 70, 72, 75, 76, 77, 78, 79, 80, 80, 81, 81, 83, 82, 83]);
        expect(births).toBe(74);
        expect(deaths).toBe(12);
        expect(s.rngSeed).toBe(1286039969);
    }, 120000);
});
