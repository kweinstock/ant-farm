// The nurse-specific decide logic and act handlers — mirrors foraging.ts /
// undertaking.ts: a decideX function behavior.ts delegates to, plus the act
// handlers jobs.ts dispatches. Owning both halves here keeps behavior.ts's
// rule list and jobs.ts's switch from carrying nurse-specific branches.
//
// A nurse's job is a two-part loop:
//   ferry  — carry eggs from the queen chamber to nursery tiles, filling up
//            to NURSE_EGG_CAPACITY each trip instead of one-at-a-time
//   tend   — visit placed brood that's overdue (advanceBrood stalls, then
//            kills, brood that isn't tended within TEND_STALL / TEND_DEATH)
// Ferrying comes first — an egg still in the queen chamber is safe there,
// whereas an unattended placed egg dies — except for the one case where a
// placed entry is genuinely about to die (broodUrgentTendPos), which
// preempts, so a ferry backlog can't wipe the nursery.
import type { Ant } from "./ant";
import type { Perception } from "./senses";
import type { Action } from "./behavior";
import { chamberAt } from "../world/nest";
import { NURSE_EGG_CAPACITY, NURSERY_TILE_CAPACITY } from "../params";
import type { ColonyState } from "../state";
import type { ActResult } from "./jobs";

function samePos(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return a.x === b.x && a.y === b.y;
}

export function decideNurse(ant: Ant, perception: Perception): Action {
    // Stranded on the surface (just finished a corpse haul — decideUndertaker
    // clears `undertaking` while still surface-side). Head home.
    if (perception.where === "surface") {
        return perception.atHole
            ? { type: "crossExit" }
            : { type: "surfaceRoute", target: perception.holePos };
    }

    // A placed entry is about to die — tend it now, even mid-ferry.
    if (perception.broodUrgentTendPos !== undefined) {
        return samePos(ant.location.pos, perception.broodUrgentTendPos)
            ? { type: "tendBrood" }
            : { type: "moveToNestPoint", target: perception.broodUrgentTendPos };
    }

    // Once a nurse has placed at least one egg from the current load,
    // ant.deliveringBrood latches true (set in placeEgg below, cleared when
    // the load is fully placed) — it commits to finishing the delivery
    // before fetching again. Without this latch, placing one egg freed up a
    // carry slot and immediately flipped canFetchMore back on (capacity +
    // eggs still available), sending the nurse straight back to the queen
    // instead of delivering the rest of what it was already carrying — the
    // "places one egg then goes back for more" bug.
    const canFetchMore =
        perception.carrying.length < NURSE_EGG_CAPACITY &&
        perception.eggsAvailableInQueenChamber &&
        !ant.deliveringBrood;

    // Carrying eggs and nothing left worth topping up with — deliver the load.
    if (perception.carrying.length > 0 && !canFetchMore) {
        const target = perception.nurseryPlacementPos;
        if (target === undefined) {
            // Every nursery tile is full — wait by one for a slot to free.
            return { type: "goto", role: "NURSERY" };
        }
        return samePos(ant.location.pos, target)
            ? { type: "placeEgg" }
            : { type: "moveToNestPoint", target };
    }

    // Room for more and eggs waiting — go grab another (fill the trip).
    if (canFetchMore) {
        const target = perception.queenEggPos;
        if (target === undefined) {
            return { type: "goto", role: "QUEEN" };
        }
        return samePos(ant.location.pos, target)
            ? { type: "pickUpEgg" }
            : { type: "moveToNestPoint", target };
    }

    // Empty-handed, nothing to ferry — tend the nearest brood that's due.
    if (perception.broodNeedingTendPos !== undefined) {
        return samePos(ant.location.pos, perception.broodNeedingTendPos)
            ? { type: "tendBrood" }
            : { type: "moveToNestPoint", target: perception.broodNeedingTendPos };
    }

    // Idle — mill in the commons.
    return perception.currentChamber === "COMMONS" ? { type: "mill" } : { type: "goto", role: "COMMONS" };
}

// ---- act handlers (dispatched from jobs.ts) ----

export function pickUpEgg(state: ColonyState, ant: Ant): ActResult {
    // The nurse walked onto the egg's tile (decideNurse) — pick up an egg
    // that's actually there, not one anywhere in the chamber.
    const here = ant.location.pos;
    const egg = state.brood.find(
        (entry) =>
            entry.stage === "EGG" &&
            entry.carriedBy === undefined &&
            entry.position.x === here.x &&
            entry.position.y === here.y &&
            chamberAt(state.nest, entry.position) === "QUEEN",
    );

    if (!egg) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const brood = state.brood.map((entry) => (entry.id === egg.id ? { ...entry, carriedBy: ant.id } : entry));

    return {
        ant: { ...ant, carrying: [...ant.carrying, egg.id] },
        brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

export function placeEgg(state: ColonyState, ant: Ant): ActResult {
    if (ant.carrying.length === 0) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const eggId = ant.carrying[0];
    const here = ant.location.pos;

    if (chamberAt(state.nest, here) !== "NURSERY" || broodOnTile(state, here) >= NURSERY_TILE_CAPACITY) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    // Reset the tend clock on placement: sitting uncarried in the queen
    // chamber and riding a nurse across the nest isn't neglect (advanceBrood
    // only meters *placed* brood), so a slow ferry shouldn't land an egg
    // already past TEND_STALL / TEND_DEATH.
    const brood = state.brood.map((entry) =>
        entry.id === eggId
            ? { ...entry, position: { x: here.x, y: here.y }, carriedBy: undefined, lastTendedTick: state.simTime }
            : entry,
    );

    const remaining = ant.carrying.filter((id) => id !== eggId);

    return {
        // deliveringBrood latches true while there's more of this load left
        // to place, and clears once the trip is done — see decideNurse.
        ant: { ...ant, carrying: remaining, deliveringBrood: remaining.length > 0 ? true : undefined },
        brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

export function tendBrood(state: ColonyState, ant: Ant): ActResult {
    const here = ant.location.pos;
    if (chamberAt(state.nest, here) !== "NURSERY") {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const brood = state.brood.map((entry) =>
        entry.carriedBy === undefined && entry.position.x === here.x && entry.position.y === here.y
            ? { ...entry, lastTendedTick: state.simTime }
            : entry,
    );

    return { ant, brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
}

// Count of uncarried brood physically sitting on `pos` — the per-tile nursery
// cap is checked against this.
function broodOnTile(state: ColonyState, pos: { x: number; y: number }): number {
    let n = 0;
    for (const entry of state.brood) {
        if (entry.carriedBy === undefined && entry.position.x === pos.x && entry.position.y === pos.y) {
            n += 1;
        }
    }
    return n;
}
