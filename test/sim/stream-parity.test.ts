import { describe, it, expect } from "vitest";
import { createInitialState, toSnapshot, type ColonyState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { colonyStateFromSnapshot } from "../../src/web/net/remote-state";
import { buildStatsSections } from "../../src/web/ui/dashboard-stats";
import { encodePheromones, encodeNest } from "../../src/shared/wire-world";
import { digTile, bootstrapFrontierTile } from "../../src/sim/world/nest";
import { applyDiff } from "../../src/web/net/socket";
import { computeDiff } from "../../src/worker/broadcast";
import type { SnapshotDTO } from "../../src/shared/protocol";
import { resolveAnt, formatTicks } from "../../src/web/ui/ant-card";
import { HEIRS_CAP } from "../../src/sim/names/generator";

// The stream-mode client never sees a ColonyState; it rebuilds one from the wire
// (remote-state.ts) and feeds it to the same dashboard code local mode uses. Any
// dashboard readout that depends on something the wire doesn't carry would be
// silently wrong in stream mode (a "queen lifespan 0", a trail count stuck at 0,
// "undertaking 0" while one is working...). These tests build the dashboard from a
// real colony and from that same colony after a JSON trip through the wire, and
// require every line to match.

const base = createInitialState(12345);

// Counters come from events/history, not from state; use one shared object for
// both sides so only the state-derived readouts can differ.
const stats = {
    populationHistory: [{ tick: 0, population: 21 }],
    foodHistory: [{ tick: 0, amount: 500000 }],
    deathsByCause: { oldAge: 0, starvation: 0, predator: 0, cold: 0, exposure: 0 },
    deathsByLocation: { nest: 0, surface: 0 },
    deathsTotal: 0, birthsTotal: 0, deathTicks: [], forageDepartsTotal: 0, foodDeliveredTotal: 0,
    tripDepartedAt: new Map(), recentTripLengths: [], predatorStrikesTotal: 0, lastFoodAmount: 500000,
    asleepNow: 0, asleepFraction: 0, peakAsAsleepFraction: 0,
} as never;

const wireSnapshot = (real: ColonyState): SnapshotDTO =>
    JSON.parse(JSON.stringify({ ...toSnapshot(real), pheromones: encodePheromones(real), nest: encodeNest(real) }));

const throughWire = (real: ColonyState): ColonyState => colonyStateFromSnapshot(base, wireSnapshot(real));
const dashboard = (state: ColonyState): string[] => buildStatsSections(state, stats).flatMap((section) => section.lines);

function expectSameDashboard(real: ColonyState) {
    const a = dashboard(real);
    const b = dashboard(throughWire(real));
    expect(b).toEqual(a);
}

describe("stream parity: dashboard", () => {
    it("every readout matches after a trip through the wire, across a long run", () => {
        let state = createInitialState(12345);
        for (let tick = 0; tick <= 9000; tick++) {
            state = step(state, 1).state;
            if (tick % 150 === 0) expectSameDashboard(state);
        }
    });

    it("the queen's lifespan, the undertaking count, and the trail line are all carried (not zero)", () => {
        let state = createInitialState(12345);
        for (let i = 0; i < 3000; i++) state = step(state, 1).state;

        // Force an undertaker so the readout is exercised regardless of the sim's luck.
        const worker = [...state.ants.values()].find((ant) => ant.caste === "WORKER")!;
        const ants = new Map(state.ants);
        ants.set(worker.id, { ...worker, undertaking: { corpseId: "corpse-test" } });
        const real: ColonyState = { ...state, ants };

        const remote = dashboard(throughWire(real));
        expect(remote.find((l) => l.startsWith("total:"))).not.toMatch(/\/0\)/);
        expect(remote.find((l) => l.startsWith("job:"))).toMatch(/undertaking 1/);
        expect(remote.find((l) => l.startsWith("trail:"))).not.toMatch(/^trail: 0 cells/);
        expectSameDashboard(real);
    });
});

describe("stream parity: world data", () => {
    it("pheromone layers come through bit-for-bit", () => {
        let state = createInitialState(12345);
        for (let i = 0; i < 3000; i++) state = step(state, 1).state;

        const remote = throughWire(state);
        expect(state.surface.trail.cells.some((v) => v > 0)).toBe(true);
        expect(remote.surface.trail.cells).toEqual(state.surface.trail.cells);
        expect(remote.surface.alarm.cells).toEqual(state.surface.alarm.cells);
    });

    it("a nest that has been dug comes through, with working distance fields", () => {
        let state = createInitialState(12345);
        for (let i = 0; i < 2000; i++) state = step(state, 1).state;

        const frontier = bootstrapFrontierTile(state.grid, state.nest, { x: 40, y: 30 });
        expect(frontier).toBeDefined();
        const dug = digTile(state.grid, state.nest, frontier!, { role: "NURSERY" });
        const real: ColonyState = { ...state, grid: dug.grid, nest: dug.nest };

        const remote = throughWire(real);
        expect(remote.nest.chambers.length).toBe(real.nest.chambers.length);
        expect(remote.grid.tiles).toEqual(real.grid.tiles);
        expect(remote.nest.tileChamber).toEqual(real.nest.tileChamber);
        for (const chamber of real.nest.chambers) {
            expect(remote.nest.distanceFields[chamber.id]).toEqual(real.nest.distanceFields[chamber.id]);
        }
        expectSameDashboard(real); // includes "nursery: x / capacity"
    });

    it("a relocated graveyard comes through", () => {
        const state = createInitialState(12345);
        const moved: ColonyState = {
            ...state,
            surface: { ...state.surface, graveyard: { x0: 10, y0: 10, x1: 15, y1: 14 } },
        };
        expect(throughWire(moved).surface.graveyard).toEqual({ x0: 10, y0: 10, x1: 15, y1: 14 });
        expectSameDashboard(moved);
    });

    it("the nest object only changes identity when a dig finishes (the server sends it only then)", () => {
        let state = createInitialState(12345);
        let nest = state.nest;
        let changes = 0;
        const TICKS = 3000;
        for (let i = 0; i < TICKS; i++) {
            state = step(state, 1).state;
            if (state.nest !== nest) {
                changes++;
                nest = state.nest;
            }
        }
        // The tuned params dig steadily (~one change per 100 ticks); what matters is
        // that it is NOT every tick, which would put a 4,800-char layout on every frame.
        expect(changes).toBeLessThan(TICKS / 20);
    });

    it("decoding is cached: the same snapshot gives the same nest and layers every frame", () => {
        const snapshot = wireSnapshot(createInitialState(12345));
        const first = colonyStateFromSnapshot(base, snapshot);
        const second = colonyStateFromSnapshot(base, snapshot);
        expect(second.nest).toBe(first.nest);
        expect(second.surface.trail).toBe(first.surface.trail);
    });
});

describe("stream parity: applyDiff", () => {
    it("carries the nest and pheromones forward by reference until a frame replaces them", () => {
        let state = createInitialState(12345);
        const prev = toSnapshot(state);
        const client: SnapshotDTO = { ...prev, pheromones: encodePheromones(state), nest: encodeNest(state) };

        state = step(state, 1).state;
        const plain = applyDiff(client, computeDiff(prev, toSnapshot(state)));
        expect(plain.pheromones).toBe(client.pheromones);
        expect(plain.nest).toBe(client.nest);

        const fresh = encodePheromones(state);
        const replaced = applyDiff(client, { ...computeDiff(prev, toSnapshot(state)), pheromones: fresh });
        expect(replaced.pheromones).toBe(fresh);
        expect(replaced.nest).toBe(client.nest);
    });

    it("a moved graveyard travels in a diff", () => {
        const state = createInitialState(12345);
        const prev = toSnapshot(state);
        const next = { ...prev, graveyard: { x0: 1, y0: 2, x1: 3, y1: 4 } };
        const diff = computeDiff(prev, next);

        expect(diff.graveyard).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
        expect(applyDiff(prev, diff).graveyard).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
        expect(computeDiff(prev, prev).graveyard).toBeUndefined();
    });
});

describe("stream parity: ant card", () => {
    it("name, age and time left come through the wire unchanged", () => {
        let state = createInitialState(12345);
        for (let i = 0; i < 2000; i++) state = step(state, 1).state;
        const remote = throughWire(state);
        for (const [id, ant] of state.ants) {
            const r = remote.ants.get(id)!;
            expect(r.name).toBe(ant.name);
            expect(r.ageTicks).toBe(ant.ageTicks);
            expect(r.lifespanTicks).toBe(ant.lifespanTicks);
        }
    });

    it("heirs survive the wire, and the card follows a dead ant down its chain", () => {
        const state = createInitialState(12345);
        const [first, second, third] = [...state.ants.keys()].slice(1, 4);
        const ants = new Map(state.ants);
        ants.delete(first);
        ants.delete(second);
        const real: ColonyState = { ...state, ants, heirs: { [first]: second, [second]: third } };

        const remote = throughWire(real);
        expect(remote.heirs).toEqual(real.heirs);
        expect(resolveAnt(remote, first).id).toBe(third);
        expect(resolveAnt(remote, first).ant?.name).toBe(state.ants.get(third)!.name);
    });

    it("a dead ant with no heir yet resolves to nothing, not a crash", () => {
        const state = createInitialState(12345);
        const victim = [...state.ants.keys()][1];
        const ants = new Map(state.ants);
        ants.delete(victim);
        expect(resolveAnt({ ...state, ants }, victim).ant).toBeUndefined();
    });

    it("formats ticks as days and hours alongside the raw count", () => {
        expect(formatTicks(0)).toBe("<1h (0 ticks)");
        expect(formatTicks(54000)).toBe("1d 0h (54,000 ticks)");
        expect(formatTicks(54000 + 2250 * 5)).toBe("1d 5h (65,250 ticks)");
    });
});

describe("stream parity: heirs in diffs", () => {
    it("a diff carries only new heirs, and applyDiff merges them", () => {
        const state = createInitialState(12345);
        const prev = { ...toSnapshot(state), heirs: { a: "b" } };
        const next = { ...prev, heirs: { a: "b", c: "d" } };
        const diff = computeDiff(prev, next);
        expect(diff.heirs).toEqual({ c: "d" });
        expect(applyDiff(prev, diff).heirs).toEqual({ a: "b", c: "d" });
        expect(computeDiff(next, next).heirs).toBeUndefined();
    });

    it("the client re-applies the cap, dropping the oldest", () => {
        const state = createInitialState(12345);
        const heirs: Record<string, string> = {};
        for (let i = 0; i < HEIRS_CAP; i++) heirs[`d${i}`] = `h${i}`;
        const prev = { ...toSnapshot(state), heirs };
        const merged = applyDiff(prev, { ...computeDiff(prev, prev), heirs: { extra: "x" } }).heirs;
        expect(Object.keys(merged).length).toBe(HEIRS_CAP);
        expect(merged["d0"]).toBeUndefined();
        expect(merged["extra"]).toBe("x");
    });
});
