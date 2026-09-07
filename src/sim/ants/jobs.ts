// Executes a decided Action. goto/mill move the ant; pickUpEgg/placeEgg/eat
// do the room's actual work. The carried-egg source of truth is the Brood
// entry itself (its own `carriedBy` and `position`), not a duplicated
// position on the Ant — Ant.carrying is just "which broodIds am I holding,"
// a marker for behavior.ts/senses.ts to read, never a second copy of where
// those eggs physically are.
import type { Ant, Job } from "./ant";
import { MAX_ENERGY } from "./ant";
import type { Action } from "./behavior";
import { wander, moveToward } from "./movement";
import { chamberAt, tilesOf } from "../world/nest";
import type { ColonyState } from "../state";
import type { Brood } from "../colony/brood";
import type { Surface } from "../world/surface";
import { eatFromStore } from "../world/resources";
import { crossExit, pickUpFood, depositFood, surfaceStep, surfaceWander } from "./foraging";

export const NURSERY_TILE_CAPACITY = 3;
export const NURSE_AGE_THRESHOLD_TICKS = 150;

export type ActResult = {
    ant: Ant;
    brood: Brood[];
    foodStore: { amount: number; capacity: number };
    surface: Surface;
    rngSeed: number;
};

export function act(state: ColonyState, ant: Ant, action: Action): ActResult {
    switch (action.type) {
        case "goto": {
            const distanceField = state.nest.distanceFields[action.role];
            const result = moveToward(state.grid, distanceField, ant.location.pos, state.rngSeed);

            const brood =
                ant.carrying.length > 0
                    ? state.brood.map((entry) =>
                          ant.carrying.includes(entry.id) ? { ...entry, position: result.position } : entry
                      )
                    : state.brood;

            return {
                ant: { ...ant, location: { where: "nest", pos: result.position } },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                rngSeed: result.seed,
            };
        }

        case "mill": {
            const result = wander(state.grid, ant.location.pos, state.rngSeed);

            return {
                ant: { ...ant, location: { where: "nest", pos: result.position } },
                brood: state.brood,
                foodStore: state.foodStore,
                surface: state.surface,
                rngSeed: result.seed,
            };
        }

        case "pickUpEgg": {
            const egg = state.brood.find(
                (entry) =>
                    entry.stage === "EGG" &&
                    chamberAt(state.nest, entry.position) === "QUEEN" &&
                    entry.carriedBy === undefined
            );

            if (!egg) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === egg.id ? { ...entry, carriedBy: ant.id } : entry
            );

            return {
                ant: { ...ant, carrying: [...ant.carrying, egg.id] },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                rngSeed: state.rngSeed,
            };
        }

        case "placeEgg": {
            if (ant.carrying.length === 0) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, rngSeed: state.rngSeed };
            }

            const eggId = ant.carrying[0];

            const occupancy = new Map<string, number>();
            for (const entry of state.brood) {
                if (entry.carriedBy === undefined && chamberAt(state.nest, entry.position) === "NURSERY") {
                    const key = `${entry.position.x},${entry.position.y}`;
                    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
                }
            }

            const freeTile = tilesOf(state.nest, "NURSERY").find(
                (tile) => (occupancy.get(`${tile.x},${tile.y}`) ?? 0) < NURSERY_TILE_CAPACITY
            );

            if (!freeTile) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === eggId ? { ...entry, position: freeTile, carriedBy: undefined } : entry
            );

            return {
                ant: { ...ant, carrying: ant.carrying.filter((id) => id !== eggId) },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                rngSeed: state.rngSeed,
            };
        }

        case "eat": {
            const { store, consumed } = eatFromStore(state.foodStore);

            return {
                ant: { ...ant, energy: Math.min(ant.energy + consumed, MAX_ENERGY) },
                brood: state.brood,
                foodStore: store,
                surface: state.surface,
                rngSeed: state.rngSeed,
            };
        }

        case "crossExit":
            return crossExit(state, ant);

        case "pickUpFood":
            return pickUpFood(state, ant);

        case "depositFood":
            return depositFood(state, ant);

        case "surfaceStep":
            return surfaceStep(state, ant, action.target);

        case "surfaceWander":
            return surfaceWander(state, ant);
    }
}

export function assignJob(ant: Ant): Job {
    return ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS ? "NURSE" : "FORAGER";
}