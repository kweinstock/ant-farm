// Builds one ant's Perception for this tick — a pure read of state, no
// decisions made here (behavior.ts/foraging.ts own those). PHASE 3b: an ant
// can now be in one of two coordinate spaces, so several fields are only
// meaningful on one side. Each is gated on `ant.location.where` explicitly —
// not left to whatever a coincidental position match across the two
// unrelated grids would produce.

import type { Ant } from "./ant";
import { chamberAt, chamberIdAt, exitMouth, type ChamberId, type ChamberRole } from "../world/nest";
import { nearestPile, inGraveyard as surfaceInGraveyard, graveyardSlot, type FoodPileId } from "../world/surface";
import { manhattanDistance, type Position } from "../world/grid";
import type { ColonyState } from "../state";
import type { BroodId } from "../colony/brood";
import { corpseById } from "../corpses";
import { strongestPassableNeighbor } from "../pheromones";
import { bestRememberedSite } from "./memory";
import { MAX_ENERGY, NURSERY_TILE_CAPACITY, SIGHT_RADIUS } from "../params";

export type Perception = {
    where: "nest" | "surface";
    currentChamber: ChamberRole | undefined;
    currentChamberId: ChamberId | undefined;
    queenEggPos: Position | undefined;
    nurseryPlacementPos: Position | undefined;
    atExitMouth: boolean;
    atHole: boolean;
    holePos: Position;
    onFoodPileId: FoodPileId | undefined;
    nearestFoodPilePos: Position | undefined;
    trailNeighbor: Position | undefined;
    rememberedFoodPos: Position | undefined;
    nearestPatchTarget: Position | undefined;
    inGraveyard: boolean;
    graveyardCentre: Position;
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
    const currentChamberId = where === "nest" ? chamberIdAt(state.nest, pos) : undefined;

    // Nearest uncarried egg still in a QUEEN chamber — the tile a fetching
    // nurse walks onto before pickUpEgg fires. (In practice every egg sits on
    // the queen's own tile, since she doesn't move yet.)
    let queenEggPos: Position | undefined;
    if (where === "nest") {
        let best = Infinity;
        for (const brood of state.brood) {
            if (brood.stage !== "EGG" || brood.carriedBy !== undefined) continue;
            if (chamberAt(state.nest, brood.position) !== "QUEEN") continue;
            const d = manhattanDistance(brood.position, pos);
            if (d < best) {
                best = d;
                queenEggPos = brood.position;
            }
        }
    }

    // The NURSERY tile a carrying nurse walks onto before placeEgg fires.
    // Brood spreads out before it stacks: pick the tile with the FEWEST
    // occupants (nearest one, to break ties), so every tile gets one egg
    // before any gets two, and so on up to NURSERY_TILE_CAPACITY. Counts
    // every uncarried brood entry per tile — larvae/pupae hold a tile until
    // they eclose — matching jobs.ts's placeEgg check.
    let nurseryPlacementPos: Position | undefined;
    if (where === "nest" && ant.carrying.length > 0) {
        const occupancy = new Map<string, number>();
        for (const brood of state.brood) {
            if (brood.carriedBy !== undefined) continue;
            if (chamberAt(state.nest, brood.position) !== "NURSERY") continue;
            const key = `${brood.position.x},${brood.position.y}`;
            occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
        }
        let bestFill = NURSERY_TILE_CAPACITY;
        let bestDist = Infinity;
        for (const chamber of state.nest.chambers) {
            if (chamber.role !== "NURSERY") continue;
            for (const tile of chamber.tiles) {
                const fill = occupancy.get(`${tile.x},${tile.y}`) ?? 0;
                if (fill >= NURSERY_TILE_CAPACITY) continue;
                const d = manhattanDistance(tile, pos);
                if (fill < bestFill || (fill === bestFill && d < bestDist)) {
                    bestFill = fill;
                    bestDist = d;
                    nurseryPlacementPos = tile;
                }
            }
        }
    }

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

    let nearestPatchTarget: Position | undefined;
    if (where === "surface") {
        const patches = state.surface.patches;
        const centroidOf = (p: { x0: number; y0: number; x1: number; y1: number }): Position => ({
            x: Math.floor((p.x0 + p.x1) / 2),
            y: Math.floor((p.y0 + p.y1) / 2),
        });

        let currentPatchIndex = -1;
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            if (pos.x >= p.x0 && pos.x <= p.x1 && pos.y >= p.y0 && pos.y <= p.y1) {
                currentPatchIndex = i;
                break;
            }
        }

        if (currentPatchIndex >= 0) {
            // Standing in a patch, and decideForager only consults this after
            // the visible-pile / trail / memory checks have all missed — so
            // this patch is barren right now. Don't mill here waiting for a
            // spawn that may never come; move on to the next patch around the
            // ring. A fixed successor (i+1), not "nearest other patch":
            // nearest-other deterministically ping-pongs between two adjacent
            // patches forever, whereas a one-way ring sweeps all of them and
            // eventually finds the piles.
            nearestPatchTarget = centroidOf(patches[(currentPatchIndex + 1) % patches.length]);
        } else {
            let bestDist = Infinity;
            for (const p of patches) {
                const centroid = centroidOf(p);
                const d = manhattanDistance(pos, centroid);
                if (d < bestDist) {
                    bestDist = d;
                    nearestPatchTarget = centroid;
                }
            }
        }
    }

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
        surfaceInGraveyard(state.surface, assignedCorpseEntry.location.pos);

    const carryingCorpse = state.corpses.some((corpse) => corpse.carriedBy === ant.id);
    const onAssignedCorpse = assignedCorpse !== undefined && assignedCorpse.where === where && assignedCorpse.pos.x === pos.x && assignedCorpse.pos.y === pos.y;
    // Only meaningful for a carrying undertaker, but cheap enough (24-ish
    // tiles) to compute unconditionally, like holePos.
    const graveyardPos = graveyardSlot(state.surface, state.corpses, pos);
    const atGraveyardSlot = where === "surface" && pos.x === graveyardPos.x && pos.y === graveyardPos.y;
    const inGraveyard = where === "surface" && surfaceInGraveyard(state.surface, pos);

    const graveyardCentre: Position = {
        x: Math.floor((state.surface.graveyard.x0 + state.surface.graveyard.x1) / 2),
        y: Math.floor((state.surface.graveyard.y0 + state.surface.graveyard.y1) / 2),
    };

    return {
        where,
        currentChamber,
        currentChamberId,
        queenEggPos,
        nurseryPlacementPos,
        atExitMouth,
        atHole,
        holePos,
        onFoodPileId,
        nearestFoodPilePos,
        trailNeighbor,
        rememberedFoodPos,
        nearestPatchTarget,
        carrying: ant.carrying,
        hungerRatio: ant.energy / MAX_ENERGY,
        eggsAvailableInQueenChamber,
        assignedCorpse,
        assignedCorpseBuried,
        carryingCorpse,
        onAssignedCorpse,
        graveyardPos,
        atGraveyardSlot,
        inGraveyard,
        graveyardCentre,
    };
}