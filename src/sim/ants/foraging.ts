// The forager-specific decide logic and act handlers. behavior.ts's rule 4
// just delegates here for any FORAGER — this file owns the whole round
// trip so behavior.ts's own rule list doesn't have to grow five nest/
// surface-specific branches.
//
// decideForager reads `ant.carryingFood` straight off the Ant rather than
// through Perception, same as decide() already does with ant.job — no
// reason to duplicate a field Perception doesn't otherwise need.
import type { Ant } from "./ant";
import type { AntLocation } from "./ant";
import type { Perception } from "./senses";
import type { Action } from "./behavior";
import { HUNGER_THRESHOLD } from "./ant";
import { wander, stepToward } from "./movement";
import { exitMouth } from "../world/nest";
import { takeFromPile } from "../world/surface";
import { depositToStore } from "../world/resources";
import { FORAGER_LOAD } from "../state";
import type { ColonyState } from "../state";
import type { Position } from "../world/grid";
import type { ActResult } from "./jobs";

export function decideForager(ant: Ant, perception: Perception): Action {
    if (perception.where === "nest") {
        // Note: a *hungry* nest forager never reaches here — behavior.ts's
        // rule 2 (hunger, nest-only) catches it before rule 4 delegates to
        // this function. So the nest branch only handles "deliver a load" or
        // "head back out to forage."
        if (ant.carryingFood > 0) {
            return perception.currentChamber === "FOOD_STORAGE" ? { type: "depositFood" } : { type: "goto", role: "FOOD_STORAGE" };
        }
        return perception.atExitMouth ? { type: "crossExit" } : { type: "goto", role: "EXIT" };
    }

    // Surface. Head home if carrying a load OR hungry — there's no food store
    // out here, so a hungry forager has to cross back in to eat (behavior.ts's
    // rule 2 then routes it to FOOD_STORAGE once it's in the nest). Both cases
    // walk to the hole and cross; the `atHole -> crossExit` step is the part
    // the earlier draft was missing for the hungry case, which left starving
    // foragers milling on the hole tile forever.
    const goHome = ant.carryingFood > 0 || perception.hungerRatio < HUNGER_THRESHOLD;
    if (goHome) {
        return perception.atHole ? { type: "crossExit" } : { type: "surfaceStep", target: perception.holePos };
    }

    if (perception.onFoodPileId !== undefined) {
        return { type: "pickUpFood" };
    }

    if (perception.nearestFoodPilePos !== undefined) {
        return { type: "surfaceStep", target: perception.nearestFoodPilePos };
    }

    return { type: "surfaceWander" };
}

export function pickUpFood(state: ColonyState, ant: Ant): ActResult {
    const pos = ant.location.pos;
    const pile = state.surface.foodPiles.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);

    if (!pile) {
        return {ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, rngSeed: state.rngSeed};
    }

    const {surface, taken} = takeFromPile(state.surface, pile.id, FORAGER_LOAD);

    return {
        ant: {...ant, carryingFood: taken},
        brood: state.brood,
        foodStore: state.foodStore,
        surface,
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
        rngSeed: state.rngSeed,
    };
}

export function crossExit(state: ColonyState, ant: Ant): ActResult {
    const location: AntLocation =
        ant.location.where === "nest"
            ? { where: "surface", pos: state.surface.holePos }
            : { where: "nest", pos: exitMouth(state.nest) };

    return {
        ant: { ...ant, location },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        rngSeed: state.rngSeed,
    };
}

export function surfaceStep(state: ColonyState, ant: Ant, target: Position): ActResult {
    const result = stepToward(state.surface.grid, ant.location.pos, target, state.rngSeed);

    return {
        ant: { ...ant, location: { where: "surface", pos: result.position } },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        rngSeed: result.seed,
    };
}

export function surfaceWander(state: ColonyState, ant: Ant): ActResult {
    const result = wander(state.surface.grid, ant.location.pos, state.rngSeed);

    return {
        ant: { ...ant, location: { where: "surface", pos: result.position } },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        rngSeed: result.seed,
    };
}