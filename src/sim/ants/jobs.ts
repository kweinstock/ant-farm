// Executes a decided Action. goto/mill move the ant; pickUpEgg/placeEgg/eat
// do the room's actual work. The carried-egg source of truth is the Brood
// entry itself (its own `carriedBy` and `position`), not a duplicated
// position on the Ant — Ant.carrying is just "which broodIds am I holding,"
// a marker for behavior.ts/senses.ts to read, never a second copy of where
// those eggs physically are. Corpses (Phase 3c) follow the identical
// pattern: Ant.undertaking is just "which corpse am I assigned to," and
// Corpse.carriedBy/location are the source of truth for where a hauled body
// actually is — so any Action that moves an ant also has to sync every
// corpse with carriedBy === ant.id, the same way goto already synced
// carried eggs.
//
// crossExit lives here now, not in foraging.ts — it's shared by two
// callers this phase: a forager crossing with food (or none) and an
// undertaker crossing with a corpse. Its egg-carrying counterpart never
// needed this split — eggs never leave the nest.
import type { Ant, AntLocation, Job } from "./ant";
import type { Action } from "./behavior";
import { wander, moveToward } from "./movement";
import { chamberAt, exitMouth, nearestChamberField } from "../world/nest";
import type { ColonyState } from "../state";
import type { Brood } from "../colony/brood";
import type { Surface } from "../world/surface";
import type { Corpse } from "../corpses";
import { eatFromStore } from "../world/resources";
import { pickUpFood, depositFood, surfaceStep, surfaceWander } from "./foraging";
import { moveToNestPoint, pickUpCorpse, dropCorpse, clearUndertaking } from "./undertaking";
import { MAX_ENERGY, NURSE_AGE_THRESHOLD_TICKS, NURSERY_TILE_CAPACITY } from "../params";

export type ActResult = {
    ant: Ant;
    brood: Brood[];
    foodStore: { amount: number; capacity: number };
    surface: Surface;
    corpses: Corpse[];
    rngSeed: number;
};

function syncCarriedCorpse(corpses: Corpse[], antId: string, newLocation: AntLocation): Corpse[] {
    if (!corpses.some((corpse) => corpse.carriedBy === antId)) {
        return corpses;
    }
    return corpses.map((corpse) => (corpse.carriedBy === antId ? { ...corpse, location: newLocation } : corpse));
}

// Count of uncarried brood physically sitting on `pos` — the per-tile
// nursery cap is checked against this.
function broodOnTile(state: ColonyState, pos: { x: number; y: number }): number {
    let n = 0;
    for (const entry of state.brood) {
        if (entry.carriedBy === undefined && entry.position.x === pos.x && entry.position.y === pos.y) {
            n += 1;
        }
    }
    return n;
}

export function act(state: ColonyState, ant: Ant, action: Action): ActResult {
    switch (action.type) {
        case "goto": {
            // Defensive: `goto` is nest-only (chambers don't exist on the
            // surface). decide()'s rule 0 keeps a surface ant from ever
            // emitting this, but if some future path does, no-op rather than
            // run nest-grid movement on surface coordinates — that flips the
            // ant to where:"nest" at an out-of-bounds position and freezes it.
            if (ant.location.where !== "nest") {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
            }

            // Route to the nearest instance of the role. Tile-precise brood
            // targeting (rules 1 & 4 -> moveToNestPoint) does the fine
            // approach and the capacity check; `goto` is just "get to the
            // right kind of room".
            const distanceField = nearestChamberField(state.nest, action.role, ant.location.pos);

            if (!distanceField) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
            }

            const result = moveToward(state.grid, distanceField, ant.location.pos, state.rngSeed);
            const location: AntLocation = { where: "nest", pos: result.position };

            const brood =
                ant.carrying.length > 0
                    ? state.brood.map((entry) =>
                          ant.carrying.includes(entry.id) ? { ...entry, position: result.position } : entry
                      )
                    : state.brood;

            return {
                ant: { ...ant, location },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                corpses: syncCarriedCorpse(state.corpses, ant.id, location),
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
                corpses: state.corpses,
                rngSeed: result.seed,
            };
        }

        case "pickUpEgg": {
            // The nurse walked onto the egg's tile (behavior.ts rule 4) —
            // pick up an egg that's actually there, not one anywhere in the
            // chamber.
            const here = ant.location.pos;
            const egg = state.brood.find(
                (entry) =>
                    entry.stage === "EGG" &&
                    entry.carriedBy === undefined &&
                    entry.position.x === here.x &&
                    entry.position.y === here.y &&
                    chamberAt(state.nest, entry.position) === "QUEEN"
            );

            if (!egg) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === egg.id ? { ...entry, carriedBy: ant.id } : entry
            );

            return {
                ant: { ...ant, carrying: [...ant.carrying, egg.id] },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                corpses: state.corpses,
                rngSeed: state.rngSeed,
            };
        }

        case "placeEgg": {
            if (ant.carrying.length === 0) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
            }

            const eggId = ant.carrying[0];
            const here = ant.location.pos;

            // The nurse walked onto a specific free nursery tile
            // (behavior.ts rule 1 -> perception.nurseryPlacementPos). Set the
            // egg down here only if this really is a NURSERY tile with room.
            if (chamberAt(state.nest, here) !== "NURSERY" || broodOnTile(state, here) >= NURSERY_TILE_CAPACITY) {
                return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
            }

            const brood = state.brood.map((entry) =>
                entry.id === eggId ? { ...entry, position: { x: here.x, y: here.y }, carriedBy: undefined } : entry
            );

            return {
                ant: { ...ant, carrying: ant.carrying.filter((id) => id !== eggId) },
                brood,
                foodStore: state.foodStore,
                surface: state.surface,
                corpses: state.corpses,
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
                corpses: state.corpses,
                rngSeed: state.rngSeed,
            };
        }

        case "crossExit": {
            const location: AntLocation =
                ant.location.where === "nest"
                    ? { where: "surface", pos: state.surface.holePos }
                    : { where: "nest", pos: exitMouth(state.nest) };

            return {
                ant: { ...ant, location },
                brood: state.brood,
                foodStore: state.foodStore,
                surface: state.surface,
                corpses: syncCarriedCorpse(state.corpses, ant.id, location),
                rngSeed: state.rngSeed,
            };
        }

        case "pickUpFood":
            return pickUpFood(state, ant);

        case "depositFood":
            return depositFood(state, ant);

        case "surfaceStep":
            return surfaceStep(state, ant, action.target);

        case "surfaceWander":
            return surfaceWander(state, ant);

        case "moveToNestPoint":
            return moveToNestPoint(state, ant, action.target);

        case "pickUpCorpse":
            return pickUpCorpse(state, ant);

        case "dropCorpse":
            return dropCorpse(state, ant);

        case "clearUndertaking":
            return clearUndertaking(state, ant);
    }
}

export function assignJob(ant: Ant): Job {
    return ant.ageTicks < NURSE_AGE_THRESHOLD_TICKS ? "NURSE" : "FORAGER";
}