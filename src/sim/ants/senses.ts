// Builds one ant's Perception for this tick — a pure read of state, no
// decisions made here (behavior.ts/foraging.ts own those). PHASE 3b: an ant
// can now be in one of two coordinate spaces, so several fields are only
// meaningful on one side. Each is gated on `ant.location.where` explicitly —
// not left to whatever a coincidental position match across the two
// unrelated grids would produce.

import type { Ant } from "./ant";
import { MAX_ENERGY } from "./ant";
import { chamberAt, exitMouth, type ChamberRole } from "../world/nest";
import { nearestPile, inGraveyard, graveyardSlot, type FoodPileId } from "../world/surface";
import { manhattanDistance, type Position } from "../world/grid";
import type { ColonyState } from "../state";
import type { BroodId } from "../colony/brood";
import { corpseById } from "../corpses";
import { strongestPassableNeighbor } from "../pheromones";
import { bestRememberedSite } from "./memory";

// How far (Manhattan tiles) a forager can "notice" a pile it hasn't already
// reached. Without this, nearestPile's result would be visible from
// anywhere on the surface the instant a pile spawns, and every hungry
// forager would beeline straight at it — fine once a pile IS known, wrong
// for how it gets discovered. Outside this radius of every pile,
// nearestFoodPilePos just isn't set, so decideForager (file 7) falls
// through to surfaceWander instead of stepToward. Untuned — 8 is "notices
// something roughly a fifth of the way across a 40-wide surface," not a
// derived value; revisit alongside the economy probe if foragers seem to
// wander forever or find piles too easily.
export const SIGHT_RADIUS = 8;

export type Perception = {
    where: "nest" | "surface";
    currentChamber: ChamberRole | undefined;
    atExitMouth: boolean;
    atHole: boolean;
    holePos: Position;
    onFoodPileId: FoodPileId | undefined;
    nearestFoodPilePos: Position | undefined;
    trailNeighbor: Position | undefined;
    rememberedFoodPos: Position | undefined;
    carrying: BroodId[];
    hungerRatio: number;
    eggsAvailableInQueenChamber: boolean;
    assignedCorpse: { pos: Position; where: "nest" | "surface" } | undefined;
    assignedCorpseBuried: boolean;
    carryingCorpse: boolean;
    onAssignedCorpse: boolean;
    graveyardPos: Position;
    atGraveyardSlot: boolean;
};

export function perceive(state: ColonyState, ant: Ant): Perception {
    const where = ant.location.where;
    const pos = ant.location.pos;

    const currentChamber = where === "nest" ? chamberAt(state.nest, pos) : undefined;

    const mouth = where === "nest" ? exitMouth(state.nest) : undefined;
    const atExitMouth = mouth !== undefined && pos.x === mouth.x && pos.y === mouth.y;

    // Surface-only, same reasoning in the other direction.
    const atHole = where === "surface" && pos.x === state.surface.holePos.x && pos.y === state.surface.holePos.y;
    const onFoodPileId = where === "surface"
        ? state.surface.foodPiles.find((pile) => pile.pos.x === pos.x && pile.pos.y === pos.y)?.id
        : undefined;
    
    const holePos = state.surface.holePos;

    // MAX_PILES ~= 10, so scanning every pile per forager per tick (inside
    // nearestPile) is cheap — same cost class as chamberAt's per-tile scan
    // on the nest side.
    let nearestFoodPilePos: Position | undefined = undefined;
    if (where === "surface") {
        const nearest = nearestPile(state.surface, pos);
        if (nearest !== undefined && manhattanDistance(nearest.pos, pos) <= SIGHT_RADIUS) {
            nearestFoodPilePos = nearest.pos;
        }
    }

    // trail-following and memory, both surface-only — a nest-side
    // ant has no surface.trail to read and never accumulates foodSites in
    // the first place (rememberFoodSite is only ever called from
    // foraging.ts's surface-side pickUpFood handler).
    // Follow the trail OUTBOUND only (away from the hole) — see
    // strongestPassableNeighbor's comment on why a plain gradient-follow
    // pulls foragers back toward the nest.
    const trailNeighbor = where === "surface"
        ? strongestPassableNeighbor(state.surface.trail, state.surface.grid, pos.x, pos.y, state.surface.holePos)
        : undefined;
    const rememberedFoodPos = where === "surface"
        ? bestRememberedSite(ant.memory, state.simTime)
        : undefined;

    // "Available" means: still an EGG, physically still sitting in the
    // QUEEN chamber, and not already claimed by a nurse. Nest-only in
    // practice (a forager never reads this) but computed unconditionally,
    // same as before this phase — cheap enough that gating it behind
    // `where` would just be an extra branch for no real savings.
    const eggsAvailableInQueenChamber = state.brood.some(
        (brood) =>
            brood.stage === "EGG" &&
            chamberAt(state.nest, brood.position) === "QUEEN" &&
            brood.carriedBy === undefined
    );

    const assignedCorpseEntry = ant.undertaking !== undefined ? corpseById(state, ant.undertaking.corpseId) : undefined;

    const assignedCorpse = assignedCorpseEntry
        ? { pos: assignedCorpseEntry.location.pos, where: assignedCorpseEntry.location.where }
        : undefined;

    // Assigned corpse is already at rest (someone else buried it while I was
    // en route) — decideUndertaker uses this to abort instead of walking to
    // the graveyard to "re-bury" it.
    const assignedCorpseBuried =
        assignedCorpseEntry !== undefined &&
        assignedCorpseEntry.location.where === "surface" &&
        inGraveyard(state.surface, assignedCorpseEntry.location.pos);

    const carryingCorpse = state.corpses.some((corpse) => corpse.carriedBy === ant.id);
    const onAssignedCorpse = assignedCorpse !== undefined && assignedCorpse.where === where && assignedCorpse.pos.x === pos.x && assignedCorpse.pos.y === pos.y;
    // Only meaningful for a carrying undertaker, but cheap enough (24-ish
    // tiles) to compute unconditionally, like holePos.
    const graveyardPos = graveyardSlot(state.surface, state.corpses, pos);
    const atGraveyardSlot = where === "surface" && pos.x === graveyardPos.x && pos.y === graveyardPos.y;

    return {
        where,
        currentChamber,
        atExitMouth,
        atHole,
        holePos,
        onFoodPileId,
        nearestFoodPilePos,
        trailNeighbor,
        rememberedFoodPos,
        carrying: ant.carrying,
        hungerRatio: ant.energy / MAX_ENERGY,
        eggsAvailableInQueenChamber,
        assignedCorpse,
        assignedCorpseBuried,
        carryingCorpse,
        onAssignedCorpse,
        graveyardPos,
        atGraveyardSlot,
    };
}