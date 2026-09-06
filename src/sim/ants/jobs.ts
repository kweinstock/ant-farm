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
import { eatFromStore } from "../world/resources";



// Per-tile nursery capacity — distinct from behavior.ts's NURSE_EGG_CAPACITY
// (per-nurse) even though both happen to be 3 today. Keeping them separate
// constants means changing one doesn't silently change the other if they
// ever need to diverge.
export const NURSERY_TILE_CAPACITY = 3;

export const NURSE_AGE_THRESHOLD_TICKS = 150;

export type ActResult = {
    ant: Ant;
    brood: Brood[];
    foodStore: { amount: number; capacity: number };
    rngSeed: number;
};

export function act(state: ColonyState, ant: Ant, action: Action): ActResult {
    switch (action.type) {
        case "goto": {
            const distanceField = state.nest.distanceFields[action.role];
            const result = moveToward(state.grid, distanceField, ant.position, state.rngSeed);

            // Whoever moves the nurse writes the same new position onto
            // every egg she's currently holding, in this same step — that's
            // what keeps a carried egg's Brood.position from ever diverging
            // from the ant carrying it. Only relevant here: an ant carrying
            // anything always resolves to "goto" or "placeEgg" per
            // behavior.ts's rule 1, never "mill," so no equivalent sync is
            // needed in the mill branch below.
            const brood =
                ant.carrying.length > 0
                    ? state.brood.map((entry) =>
                          ant.carrying.includes(entry.id) ? { ...entry, position: result.position } : entry
                      )
                    : state.brood;

            return {
                ant: { ...ant, position: result.position },
                brood,
                foodStore: state.foodStore,
                rngSeed: result.seed,
            };
        }

        case "mill": {
            const result = wander(state.grid, ant.position, state.rngSeed);

            return {
                ant: { ...ant, position: result.position },
                brood: state.brood,
                foodStore: state.foodStore,
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
                // Perception said an egg was available; if another nurse
                // claimed it earlier in this same tick's per-ant loop, this
                // nurse just does nothing rather than crashing on a missing
                // egg.
                return { ant, brood: state.brood, foodStore: state.foodStore, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === egg.id ? { ...entry, carriedBy: ant.id } : entry
            );

            return {
                ant: { ...ant, carrying: [...ant.carrying, egg.id] },
                brood,
                foodStore: state.foodStore,
                rngSeed: state.rngSeed,
            };
        }

        case "placeEgg": {
            if (ant.carrying.length === 0) {
                // decide() shouldn't produce placeEgg for an ant carrying
                // nothing, but a no-op is the safe response to that
                // invariant being violated, not a crash on ant.carrying[0].
                return { ant, brood: state.brood, foodStore: state.foodStore, rngSeed: state.rngSeed };
            }

            const eggId = ant.carrying[0];

            // Count only PLACED eggs (carriedBy === undefined). A carried
            // egg's position is synced to its nurse each tick, so a nurse
            // standing in the nursery would otherwise make her own carried
            // egg count against the tile she's about to place it on.
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
                // Every nursery tile full — the nurse just keeps holding the
                // egg. This IS the real brood ceiling now (replacing Phase
                // 3's MAX_BROOD constant, which queen.ts can drop), not a
                // bug: growth stalls until a pupa ecloses and frees a slot.
                return { ant, brood: state.brood, foodStore: state.foodStore, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === eggId ? { ...entry, position: freeTile, carriedBy: undefined } : entry
            );

            return {
                ant: { ...ant, carrying: ant.carrying.filter((id) => id !== eggId) },
                brood,
                foodStore: state.foodStore,
                rngSeed: state.rngSeed,
            };
        }

        case "eat": {
            const {store, consumed} = eatFromStore(state.foodStore);

            return {
                ant: { ...ant, energy: Math.min(ant.energy + consumed, MAX_ENERGY) },
                brood: state.brood,
                foodStore: store,
                rngSeed: state.rngSeed,
            };
        }
    }
}

export function assignJob(ant: Ant): Job {
    return ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS ? "NURSE" : "FORAGER";
}