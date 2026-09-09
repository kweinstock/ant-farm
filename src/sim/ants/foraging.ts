// The forager-specific decide logic and act handlers. behavior.ts's rule 4
// just delegates here for any FORAGER — this file owns the whole round
// trip so behavior.ts's own rule list doesn't have to grow five nest/
// surface-specific branches.
//
// decideForager reads `ant.carryingFood` straight off the Ant rather than
// through Perception, same as decide() already does with ant.job — no
// reason to duplicate a field Perception doesn't otherwise need.
//
// PHASE 3c: crossExit moved out to jobs.ts — it's now shared with the
// undertaker round trip (see jobs.ts's header comment), so this file no
// longer needs `exitMouth`. surfaceStep picked up a corpse-sync step this
// phase instead: it's the one action an undertaker uses while hauling a
// corpse across the surface (nest-side hauling goes through jobs.ts's
// goto/crossExit). That sync logic is duplicated here rather than imported
// from jobs.ts's copy of it — jobs.ts already imports this file at runtime
// (pickUpFood etc.), so importing anything back at runtime would be a real
// cycle. Two duplicated lines is cheaper than restructuring around that.
//
// PHASE 4: decideForager's surface-outbound branch gained two fallbacks
// (trail, then memory) between "no visible pile" and giving up to wander —
// decision 6's priority order. pickUpFood now also writes to ant.memory on
// a successful pickup, and surfaceStep now also deposits a trail crumb
// while hauling food home. Both new writes ride the same ActResult fields
// (`ant`, `surface`) every handler here already returns — no new field on
// ActResult was needed for this phase.
import type { Ant, AntLocation } from "./ant";
import type { Perception } from "./senses";
import type { Action } from "./behavior";
import { wander, stepToward, surfaceRouteStep } from "./movement";
import { takeFromPile } from "../world/surface";
import { depositToStore } from "../world/resources";
import { deposit } from "../pheromones";
import { rememberFoodSite } from "./memory";
import { HUNGER_THRESHOLD, DEPOSIT_AMOUNT, FORAGER_LOAD, EAT_AMOUNT, MAX_ENERGY } from "../params";
import type { ColonyState } from "../state";
import type { Position } from "../world/grid";
import type { ActResult } from "./jobs";

export function decideForager(ant: Ant, perception: Perception): Action {
    if (perception.where === "nest") {
        if (ant.carryingFood > 0) {
            return perception.currentChamber === "FOOD_STORAGE" ? { type: "depositFood" } : { type: "goto", role: "FOOD_STORAGE" };
        }
        return perception.atExitMouth ? { type: "crossExit" } : { type: "goto", role: "EXIT" };
    }

    const hungry = perception.hungerRatio < HUNGER_THRESHOLD;

    // Hungry and carrying nothing: feed at the surface, not at the nest
    // store. A big surface means a long walk home, and if the store has
    // bottomed out in a food crunch that walk kills the forager before it
    // can refuel — the colony then can't claw back out of a crash. Eating
    // at the pile (or heading to a visible one) keeps foragers alive in the
    // field so deliveries resume once the boom's die-off passes.
    if (hungry && ant.carryingFood === 0) {
        if (perception.onFoodPileId !== undefined) {
            return { type: "eatFromPile" };
        }
        if (perception.nearestFoodPilePos !== undefined) {
            return { type: "surfaceStep", target: perception.nearestFoodPilePos };
        }
    }

    const goHome = ant.carryingFood > 0 || hungry;
    if (goHome) {
        // Routed, not greedy. A laden forager leaves a patch (obstacles
        // clustered right there) and crosses the map to the hole — greedy
        // stepToward stalls against those clusters, and the trail crumbs it
        // drops on the way (applySurfaceMove) come out as a clean line home
        // only if the path is a clean line. holePos is fixed, so the field is
        // BFS'd once and reused for every forager forever.
        return perception.atHole ? { type: "crossExit" } : { type: "surfaceRoute", target: perception.holePos };
    }

    if (perception.onFoodPileId !== undefined) {
        return { type: "pickUpFood" };
    }

    if (perception.nearestFoodPilePos !== undefined) {
        return { type: "surfaceStep", target: perception.nearestFoodPilePos };
    }

    if (perception.trailNeighbor !== undefined) {
        return { type: "surfaceStep", target: perception.trailNeighbor };
    }

    if (perception.rememberedFoodPos !== undefined) {
        return { type: "surfaceStep", target: perception.rememberedFoodPos };
    }

    if (perception.nearestPatchTarget !== undefined) {
        return {type: "surfaceRoute", target: perception.nearestPatchTarget};
    }

    return { type: "surfaceWander" };
}

export function pickUpFood(state: ColonyState, ant: Ant): ActResult {
    const pos = ant.location.pos;
    const pile = state.surface.foodPiles.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);

    if (!pile) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const { surface, taken } = takeFromPile(state.surface, pile.id, FORAGER_LOAD);

    const memory = rememberFoodSite(ant.memory, pile.pos, state.simTime);

    return {
        ant: { ...ant, carryingFood: taken, memory },
        brood: state.brood,
        foodStore: state.foodStore,
        surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

export function depositFood(state: ColonyState, ant: Ant): ActResult {
    const foodStore = depositToStore(state.foodStore, ant.carryingFood);

    return {
        ant: { ...ant, carryingFood: 0 },
        brood: state.brood,
        foodStore,
        surface: state.surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

export function eatFromPile(state: ColonyState, ant: Ant): ActResult {
    const pos = ant.location.pos;
    const pile = state.surface.foodPiles.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);

    if (!pile) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const { surface, taken } = takeFromPile(state.surface, pile.id, EAT_AMOUNT);
    const memory = rememberFoodSite(ant.memory, pile.pos, state.simTime);

    return {
        ant: { ...ant, energy: Math.min(ant.energy + taken, MAX_ENERGY), memory },
        brood: state.brood,
        foodStore: state.foodStore,
        surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

function applySurfaceMove(state: ColonyState, ant: Ant, result: { position: Position; seed: number }): ActResult {
    const location: AntLocation = { where: "surface", pos: result.position };

    const corpses = state.corpses.some((corpse) => corpse.carriedBy === ant.id)
        ? state.corpses.map((corpse) => (corpse.carriedBy === ant.id ? { ...corpse, location } : corpse))
        : state.corpses;

    const surface = ant.carryingFood > 0 && ant.location.where === "surface"
        ? { ...state.surface, trail: deposit(state.surface.trail, ant.location.pos.x, ant.location.pos.y, DEPOSIT_AMOUNT) }
        : state.surface;

    return {
        ant: { ...ant, location },
        brood: state.brood,
        foodStore: state.foodStore,
        surface,
        corpses,
        rngSeed: result.seed,
    };
}

export function surfaceStep(state: ColonyState, ant: Ant, target: Position): ActResult {
    const result = stepToward(state.surface.grid, ant.location.pos, target, state.rngSeed);
    return applySurfaceMove(state, ant, result);
}

export function surfaceRoute(state: ColonyState, ant: Ant, target: Position): ActResult {
    const result = surfaceRouteStep(state.surface.grid, ant.location.pos, target, state.rngSeed);
    return applySurfaceMove(state, ant, result);
}

export function surfaceWander(state: ColonyState, ant: Ant): ActResult {
    const result = wander(state.surface.grid, ant.location.pos, state.rngSeed);

    return {
        ant: { ...ant, location: { where: "surface", pos: result.position } },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses: state.corpses,
        rngSeed: result.seed,
    };
}