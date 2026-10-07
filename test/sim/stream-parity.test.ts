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

    it("the nest object doesn't change identity in a normal run (the server only sends it when it does)", () => {
        let state = createInitialState(12345);
        const nest = state.nest;
        for (let i = 0; i < 3000; i++) {
            state = step(state, 1).state;
            expect(state.nest).toBe(nest);
        }
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
