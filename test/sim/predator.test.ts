import { describe, expect, it } from "vitest";

import { advancePredator, predatorCanStrike, type Predator } from "../../src/sim/environment/hazards";
import { createGrid, setTile, TILE, manhattanDistance, type Grid } from "../../src/sim/world/grid";
import { createSurface } from "../../src/sim/world/surface";
import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import { deposit } from "../../src/sim/pheromones";
import { decide } from "../../src/sim/ants/behavior";
import { perceive } from "../../src/sim/ants/senses";
import { flee } from "../../src/sim/ants/fleeing";
import type { Ant } from "../../src/sim/ants/ant";
import {
    SURFACE_WIDTH,
    SURFACE_HEIGHT,
    PREDATOR_VISION_RADIUS,
    PREDATOR_STRIKE_RANGE,
    PREDATOR_HOME_THREAT_RADIUS,
    PREDATOR_FLEE_AVOID_RADIUS,
    ALARM_FLEE_THRESHOLD,
    SPOOK_COOLDOWN_TICKS,
} from "../../src/sim/params";

function openGrid(width: number, height: number): Grid {
    const grid = createGrid(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            setTile(grid, x, y, TILE.GROUND);
        }
    }
    return grid;
}

const noGraveyard = { bodyCount: 0, centre: { x: 0, y: 0 } };
const env = { season: "SUMMER" as const, weatherKind: "CLEAR" as const };

describe("predator — edge-to-edge track (Phase 10)", () => {
    it("only despawns by reaching the far edge, never mid-map", () => {
        const grid = openGrid(30, 20);
        let predator: Predator | undefined = { pos: { x: 0, y: 10 }, entryEdge: "W", roamTargetPos: { x: 29, y: 10 }, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 };
        let seed = 777;

        for (let i = 0; i < 200; i++) {
            const r = advancePredator(predator, env, grid, [], noGraveyard, seed);
            seed = r.seed;
            if (r.left) {
                // She must have been AT or PAST the target edge the tick
                // before this, not silently dropped mid-map.
                expect(predator!.pos.x === 0 || predator!.pos.x === grid.width - 1 || predator!.pos.y === 0 || predator!.pos.y === grid.height - 1).toBe(true);
                predator = undefined;
                break;
            }
            expect(r.predator).toBeDefined();
            predator = r.predator;
            expect(predator!.pos.x).toBeGreaterThanOrEqual(0);
            expect(predator!.pos.x).toBeLessThan(grid.width);
            expect(predator!.pos.y).toBeGreaterThanOrEqual(0);
            expect(predator!.pos.y).toBeLessThan(grid.height);
        }

        expect(predator).toBeUndefined(); // reached the far edge within 200 ticks
    });

    it("never appears twice without leaving in between", () => {
        // Run the real sim a while and just check env.predator's defined-ness
        // never "teleports" — every appeared/left pair brackets a defined run.
        let state = createInitialState(42);
        let sawDefinedRun = false;
        let wasDefined = false;
        // PREDATOR_APPEAR_CHANCE is small (0.0003/tick); 20000 ticks gives an
        // expected ~6 appearances (Poisson P(zero) < 0.3%), so "she showed up
        // at least once" is a reliable check, not a coin flip on the seed.
        for (let t = 0; t < 20000; t++) {
            const r = step(state, 1);
            state = r.state;
            const appeared = r.events.some((e) => e.kind === "predatorAppeared");
            const left = r.events.some((e) => e.kind === "predatorLeft");
            if (appeared) expect(wasDefined).toBe(false);
            if (left) expect(wasDefined).toBe(true);
            wasDefined = state.env.predator !== null;
            if (wasDefined) sawDefinedRun = true;
        }
        expect(sawDefinedRun).toBe(true);
    });

    it("never picks an impassable spawn point or roam target, even when almost the whole edge is blocked", () => {
        // Bug found in review: a target landing on a ROCK/TREE tile can be
        // approached but never exactly occupied, so the arrival check
        // (pos === roamTargetPos) would never fire and she'd orbit that spot
        // forever, unable to despawn or redirect ("stuck trying to leave but
        // can't"). Block every edge down to a single passable tile each —
        // the worst case short of an edge with zero — and check she never
        // spawns or targets an obstacle across many forced appearances.
        const grid = openGrid(30, 20);
        for (let x = 0; x < 30; x++) if (x !== 15) setTile(grid, x, 0, TILE.ROCK);
        for (let x = 0; x < 30; x++) if (x !== 15) setTile(grid, x, 19, TILE.ROCK);
        for (let y = 0; y < 20; y++) if (y !== 10) setTile(grid, 0, y, TILE.ROCK);
        for (let y = 0; y < 20; y++) if (y !== 10) setTile(grid, 29, y, TILE.ROCK);

        let seed = 42;
        let appeared = 0;
        for (let trial = 0; trial < 200000 && appeared < 40; trial++) {
            const r = advancePredator(undefined, env, grid, [], noGraveyard, seed);
            seed = r.seed;
            if (r.appeared && r.predator) {
                appeared += 1;
                expect(grid.tiles[r.predator.pos.y * grid.width + r.predator.pos.x]).toBe(TILE.GROUND);
                expect(grid.tiles[r.predator.roamTargetPos.y * grid.width + r.predator.roamTargetPos.x]).toBe(TILE.GROUND);
            }
        }
        expect(appeared).toBeGreaterThan(0);
    });
});

describe("predator — vision, hunting, contact (Phase 10)", () => {
    it("locks onto the nearest visible ant and drops the lock once it's out of sight", () => {
        const grid = openGrid(30, 20);
        const predator: Predator = { pos: { x: 10, y: 10 }, entryEdge: "W", roamTargetPos: { x: 29, y: 10 }, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 };
        const nearAnt = { id: "ant-near", pos: { x: 12, y: 10 } }; // within PREDATOR_VISION_RADIUS
        const farAnt = { id: "ant-far", pos: { x: 10, y: 10 + PREDATOR_VISION_RADIUS + 5 } };

        const r = advancePredator(predator, env, grid, [farAnt, nearAnt], noGraveyard, 123);
        expect(r.predator?.huntingAntId).toBe("ant-near");

        // The ant flees out of vision range -> the lock drops next tick and
        // she resumes roaming instead of chasing a phantom.
        const r2 = advancePredator(r.predator, env, grid, [], noGraveyard, r.seed);
        expect(r2.predator?.huntingAntId).toBeUndefined();
    });

    it("a rock between predator and ant blocks the lock (line of sight)", () => {
        const grid = openGrid(30, 20);
        setTile(grid, 11, 10, TILE.ROCK);
        const predator: Predator = { pos: { x: 10, y: 10 }, entryEdge: "W", roamTargetPos: { x: 29, y: 10 }, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 };
        const ant = { id: "ant-1", pos: { x: 12, y: 10 } };

        const r = advancePredator(predator, env, grid, [ant], noGraveyard, 5);
        expect(r.predator?.huntingAntId).toBeUndefined();
    });

    it("predatorCanStrike requires both the hunt-lock and contact range", () => {
        const huntingClose: Predator = { pos: { x: 5, y: 5 }, entryEdge: "N", roamTargetPos: { x: 5, y: 5 }, huntingAntId: "prey", huntStreak: 5, huntCooldownTicks: 0 };
        expect(predatorCanStrike(huntingClose, { id: "prey", pos: { x: 5, y: 5 + PREDATOR_STRIKE_RANGE } })).toBe(true);
        expect(predatorCanStrike(huntingClose, { id: "prey", pos: { x: 5, y: 5 + PREDATOR_STRIKE_RANGE + 1 } })).toBe(false);
        // Adjacent but not the hunted ant -> no strike; she's locked onto someone else.
        expect(predatorCanStrike(huntingClose, { id: "bystander", pos: { x: 5, y: 5 } })).toBe(false);
        expect(predatorCanStrike(undefined, { id: "prey", pos: { x: 5, y: 5 } })).toBe(false);
    });
});

function makeAnt(overrides: Partial<Ant> = {}): Ant {
    return {
        id: "ant-1",
        name: "ant-1",
        caste: "WORKER",
        job: "FORAGER",
        carrying: [],
        carryingFood: 0,
        undertaking: undefined,
        memory: { foodSites: [], emptyPatches: [] },
        location: { where: "surface", pos: { x: 50, y: 50 } },
        energy: 1000,
        ageTicks: 300,
        lifespanTicks: 2000,
        asleep: false,
        wakeAt: 0,
        ticksAwake: 0,
        sleepPhase: 0,
        spookedUntil: 0,
        ...overrides,
    };
}

describe("fleeing (Phase 10)", () => {
    it("an ant that sees the predator flees instead of running its normal job", () => {
        const surface = createSurface(SURFACE_WIDTH, SURFACE_HEIGHT);
        let state = createInitialState(9001);
        const antPos = { x: surface.holePos.x + 3, y: surface.holePos.y };
        const predator: Predator = {
            pos: { x: antPos.x + 2, y: antPos.y },
            entryEdge: "W",
            roamTargetPos: { x: antPos.x + 2, y: antPos.y },
            huntingAntId: undefined,
            huntStreak: 0,
            huntCooldownTicks: 0,
        };
        state = { ...state, env: { ...state.env, predator } };

        const ant = makeAnt({ location: { where: "surface", pos: antPos } });
        const perception = perceive(state, ant);
        expect(perception.predatorVisible).toBe(true);

        const action = decide(ant, perception);
        expect(action.type).toBe("flee");
    });

    it("an ant standing on strong alarm flees even without seeing the predator", () => {
        let state = createInitialState(9002);
        const pos = { x: 10, y: 10 };
        const hotAlarm = deposit(state.surface.alarm, pos.x, pos.y, ALARM_FLEE_THRESHOLD + 50, 200, 0);
        state = { ...state, surface: { ...state.surface, alarm: hotAlarm } };

        const ant = makeAnt({ location: { where: "surface", pos } });
        const perception = perceive(state, ant);
        expect(perception.predatorVisible).toBe(false);
        expect(perception.alarmLevel).toBeGreaterThan(ALARM_FLEE_THRESHOLD);

        expect(decide(ant, perception).type).toBe("flee");
    });

    it("fleeing deposits alarm behind the fleeing ant", () => {
        let state = createInitialState(9003);
        const ant = makeAnt({ location: { where: "surface", pos: { x: 40, y: 40 } } });
        state = { ...state, ants: new Map(state.ants).set(ant.id, ant) };

        // Hunting but outside PREDATOR_STRIKE_RANGE — she's visible and
        // locked on (so the ant flees), not close enough to eat it this
        // tick, so the flee action actually gets to run instead of the
        // strike roll firing first and removing the ant from state.ants.
        for (let t = 0; t < 5; t++) {
            const a = state.ants.get(ant.id);
            if (!a) break;
            const chasePos = { x: a.location.pos.x + PREDATOR_STRIKE_RANGE + 2, y: a.location.pos.y };
            state = { ...state, env: { ...state.env, predator: { pos: chasePos, entryEdge: "N", roamTargetPos: chasePos, huntingAntId: ant.id, huntStreak: 0, huntCooldownTicks: 0 } } };
            state = step(state, 1).state;
        }

        let alarmTotal = 0;
        for (const v of state.surface.alarm.cells) alarmTotal += v;
        expect(alarmTotal).toBeGreaterThan(0);
    });

    it("routes around a predator sitting on the shortest path home, not through her", () => {
        // Bug found in review: routing straight for the hole only avoided
        // terrain — a predator sitting on (or near) the direct line between
        // the ant and the hole, without being close enough to the hole
        // itself to count as "camped" (PREDATOR_HOME_THREAT_RADIUS), got
        // walked right at instead of around.
        let state = createInitialState(555);
        const hole = state.surface.holePos;
        const predatorPos = { x: hole.x, y: hole.y - (PREDATOR_HOME_THREAT_RADIUS + 4) };
        const antStart = { x: hole.x, y: predatorPos.y - 5 };
        state = {
            ...state,
            env: {
                ...state.env,
                predator: { pos: predatorPos, entryEdge: "N", roamTargetPos: predatorPos, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 },
            },
        };

        const ant = makeAnt({ location: { where: "surface", pos: antStart } });
        let s = { ...state, rngSeed: 999 };
        let pos = antStart;
        let minDistToPredator = Infinity;

        for (let i = 0; i < 40 && !(pos.x === hole.x && pos.y === hole.y); i++) {
            const result = flee(s, { ...ant, location: { where: "surface", pos } });
            pos = result.ant.location.pos;
            s = { ...s, rngSeed: result.rngSeed, surface: result.surface };
            minDistToPredator = Math.min(minDistToPredator, manhattanDistance(pos, predatorPos));
        }

        expect(minDistToPredator).toBeGreaterThan(PREDATOR_FLEE_AVOID_RADIUS);
    });

    it("a forager that just fled into the nest stays put instead of heading straight back out", () => {
        let state = createInitialState(9004);
        const ant = makeAnt({
            job: "FORAGER",
            carryingFood: 0,
            location: { where: "nest", pos: { x: 40, y: 40 } },
            spookedUntil: state.simTime + SPOOK_COOLDOWN_TICKS,
        });
        state = { ...state, ants: new Map(state.ants).set(ant.id, ant) };

        const perception = perceive(state, ant);
        expect(perception.isSpooked).toBe(true);
        const action = decide(ant, perception);
        expect(action.type).not.toBe("crossExit");
        expect(action.type === "goto" && action.role === "EXIT").toBe(false);

        // And once the cooldown has actually elapsed, it resumes heading out.
        const later = { ...state, simTime: state.simTime + SPOOK_COOLDOWN_TICKS + 1 };
        const laterPerception = perceive(later, ant);
        expect(laterPerception.isSpooked).toBe(false);
    });
});

describe("predator — graveyard attraction (Phase 10)", () => {
    it("a bigger graveyard makes her appear more often", () => {
        const grid = openGrid(40, 30);
        const graveyardCentre = { x: 20, y: 15 };

        function appearanceRate(bodyCount: number): number {
            let seed = 1000;
            let appearances = 0;
            const trials = 20000;
            for (let i = 0; i < trials; i++) {
                const r = advancePredator(undefined, env, grid, [], { bodyCount, centre: graveyardCentre }, seed);
                seed = r.seed;
                if (r.appeared) appearances += 1;
            }
            return appearances / trials;
        }

        const empty = appearanceRate(0);
        const stocked = appearanceRate(30);
        expect(stocked).toBeGreaterThan(empty);
    });

    it("a well-stocked graveyard can redirect a roaming predator toward it", () => {
        const grid = openGrid(40, 30);
        const graveyardCentre = { x: 20, y: 15 };
        // Predator sitting right on the target edge, unhunted, arrived — the
        // exact condition that rolls the leave-vs-graveyard gate.
        const predator: Predator = { pos: { x: 20, y: 0 }, entryEdge: "S", roamTargetPos: { x: 20, y: 0 }, huntingAntId: undefined, huntStreak: 0, huntCooldownTicks: 0 };

        let sawGraveyardRedirect = false;
        let seed = 55;
        for (let i = 0; i < 2000 && !sawGraveyardRedirect; i++) {
            const r = advancePredator(predator, env, grid, [], { bodyCount: 40, centre: graveyardCentre }, seed);
            seed = r.seed;
            if (r.predator && r.predator.roamTargetPos.x === graveyardCentre.x && r.predator.roamTargetPos.y === graveyardCentre.y) {
                sawGraveyardRedirect = true;
            }
        }
        expect(sawGraveyardRedirect).toBe(true);
    });
});

describe("predator — determinism (Phase 10)", () => {
    it("step(N) matches N x step(1) with a predator active throughout", () => {
        const seed = 4004;
        let a = createInitialState(seed, { predatorAlways: true });
        for (let i = 0; i < 1500; i++) a = step(a, 1).state;
        const b = step(createInitialState(seed, { predatorAlways: true }), 1500).state;
        expect(a).toEqual(b);
    });
});
