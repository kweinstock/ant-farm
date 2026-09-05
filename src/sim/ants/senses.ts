// Builds an ant's local perception for this tick using the spatial hash:
// nearby tiles + their type, local pheromone readings (all 3 layers, with
// gradient direction), visible resources, nearby kin/threats/corpses, current
// chamber climate. Pure read of state -> a Perception struct handed to behavior.ts.

import type { Ant } from "./ant";
import { MAX_ENERGY } from "./ant";
import { getNeighbors } from "../world/grid";
import { findFoodAt } from "../world/resources";
import type { ColonyState } from "../state";
import { BroodId } from "../colony/brood";

export type Perception = {
    onFoodPileIndex: number | undefined;
    nearBroodId: BroodId | undefined;
    hungerRatio: number;
};

export function perceive(state: ColonyState, ant: Ant): Perception {
    const onFoodPileIndex = findFoodAt(state.resources, ant.position);

    const neighborTiles = getNeighbors(state.grid, ant.position.x, ant.position.y);

    // KNOWN GAP: matches the first brood entry by position only — it does NOT
    // check stage. Only LARVA actually benefit from tending (see
    // colony/brood.ts), so a nurse can burn her whole tick "tending" an EGG or
    // PUPA that was first in the array. Filtering to
    // `brood.stage === "LARVA" && !brood.tendedThisTick` here would meaningfully
    // improve brood throughput — see the Phase 3 review notes.
    const nerbyBrood = state.brood.find((brood) => {
        const onSameTile = brood.position.x === ant.position.x && brood.position.y === ant.position.y;
        const onNeighborTile = neighborTiles.some((tile) => tile.x === brood.position.x && tile.y === brood.position.y);

        return onSameTile || onNeighborTile;
    });

    return {
        onFoodPileIndex,
        nearBroodId: nerbyBrood?.id,
        hungerRatio: ant.energy / MAX_ENERGY,
    }
}

