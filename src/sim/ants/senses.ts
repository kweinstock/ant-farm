// Builds one ant's Perception for this tick — a pure read of state, no
// decisions made here (behavior.ts/foraging.ts own those). PHASE 3b: an ant
// can now be in one of two coordinate spaces, so several fields are only
// meaningful on one side. Each is gated on `ant.location.where` explicitly —
// not left to whatever a coincidental position match across the two
// unrelated grids would produce.

import type { Ant } from "./ant";
import { chamberAt, chamberIdAt, exitMouth, type ChamberId, type ChamberRole } from "../world/nest";
import { nearestPile, inGraveyard as surfaceInGraveyard, graveyardSlot, type FoodPileId } from "../world/surface";
import { hasLineOfSight, manhattanDistance, type Position } from "../world/grid";
import type { ColonyState } from "../state";
import type { BroodId } from "../colony/brood";
import { corpseById } from "../corpses";
import { strongestPassableNeighbor, trailAt } from "../pheromones";
import { bestRememberedSite, patchKnownEmpty } from "./memory";
import { MAX_ENERGY, NURSERY_TILE_CAPACITY, SIGHT_RADIUS, QUEEN_HUNGER_RATIO, TEND_INTERVAL_TICKS, TEND_STALL_TICKS, PREDATOR_VISION_RADIUS, PATCH_EXPLORE_RADIUS } from "../params";


export type Perception = {
    where: "nest" | "surface";
    currentChamber: ChamberRole | undefined;
    currentChamberId: ChamberId | undefined;
    diggingTarget: Position | undefined;
    queenEggPos: Position | undefined;
    nurseryPlacementPos: Position | undefined;
    broodNeedingTendPos: Position | undefined;
    broodUrgentTendPos: Position | undefined;
    eggsWaitingCount: number;
    queenHungry: boolean;
    queenPos: Position;
    predatorVisible: boolean;
    predatorPos: Position | undefined;
    beingChased: boolean;
    alarmLevel: number;
    isSpooked: boolean;
    atExitMouth: boolean;
    atHole: boolean;
    holePos: Position;
    onFoodPileId: FoodPileId | undefined;
    nearestFoodPilePos: Position | undefined;
    trailNeighbor: Position | undefined;
    rememberedFoodPos: Position | undefined;
    nearestPatchTarget: Position | undefined;
    barrenPatchIndex: number | undefined;
    inGraveyard: boolean;
    graveyardCentre: Position;
    carrying: BroodId[];
    hungerRatio: number;
    foodStoreAmount: number;
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

    const diggingTarget =
        ant.digging !== undefined && state.pendingDigPlan?.id === ant.digging.planId
            ? state.pendingDigPlan.claims[ant.id]
            : undefined;

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

    // Placed brood that wants tending. `broodNeedingTendPos` is the nearest
    // one merely due (past TEND_INTERVAL) — a nurse handles it once idle.
    // `broodUrgentTendPos` is the nearest one genuinely close to dying (past
    // TEND_STALL, so it's stopped developing and TEND_DEATH is approaching) —
    // decideNurse tends that one even mid-ferry, so a ferry backlog can't
    // wipe the nursery.
    let broodNeedingTendPos: Position | undefined;
    let broodUrgentTendPos: Position | undefined;
    if (where === "nest") {
        let best = Infinity;
        let bestUrgent = Infinity;
        for (const brood of state.brood) {
            if (brood.carriedBy !== undefined) continue;
            if (chamberAt(state.nest, brood.position) !== "NURSERY") continue;
            const overdueBy = state.simTime - brood.lastTendedTick;
            if (overdueBy < TEND_INTERVAL_TICKS) continue;
            const d = manhattanDistance(brood.position, pos);
            if (d < best) {
                best = d;
                broodNeedingTendPos = brood.position;
            }
            if (overdueBy >= TEND_STALL_TICKS && d < bestUrgent) {
                bestUrgent = d;
                broodUrgentTendPos = brood.position;
            }
        }
    }

    const queen = state.ants.get(state.queenId);
    const queenHungry = queen !== undefined && queen.energy / MAX_ENERGY < QUEEN_HUNGER_RATIO;
    const queenPos: Position = queen !== undefined ? queen.location.pos : pos;

    const predator = state.env.predator ?? undefined;
    const predatorVisible = 
        where === "surface" &&
        predator !== undefined &&
        manhattanDistance(predator.pos, pos) <= PREDATOR_VISION_RADIUS &&
        hasLineOfSight(state.surface.grid, pos, predator.pos);
    const predatorPos = predatorVisible ? predator!.pos : undefined;
    const beingChased = where === "surface" && predator !== undefined && predator.huntingAntId === ant.id;
    const alarmLevel = where === "surface" ? trailAt(state.surface.alarm, pos.x, pos.y) : 0;
    const isSpooked = ant.spookedUntil > state.simTime;

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
    const pileAt = (p: Position): boolean =>
        state.surface.foodPiles.some((pile) => pile.amount > 0 && pile.pos.x === p.x && pile.pos.y === p.y);
    const rememberedFoodPos = where === "surface"
        ? bestRememberedSite(ant.memory, state.simTime, pileAt)
        : undefined;

    // Patch routing. `barrenPatchIndex` is set when the ant is standing in a
    // patch that has no pile anywhere in it right now — decideForager turns
    // that into "record this patch empty and move on". `nearestPatchTarget`
    // is the patch to explore next: the nearest one this ant doesn't already
    // remember as empty (so foragers fan out across the ring instead of all
    // re-checking the same dry patch), skipping the one it's standing in.
    let nearestPatchTarget: Position | undefined;
    let barrenPatchIndex: number | undefined;
    if (where === "surface") {
        const patches = state.surface.patches;
        const centroidOf = (p: { x0: number; y0: number; x1: number; y1: number }): Position => ({
            x: Math.floor((p.x0 + p.x1) / 2),
            y: Math.floor((p.y0 + p.y1) / 2),
        });
        const patchHasPile = (p: { x0: number; y0: number; x1: number; y1: number }): boolean =>
            state.surface.foodPiles.some(
                (pile) =>
                    pile.amount > 0 &&
                    pile.pos.x >= p.x0 && pile.pos.x <= p.x1 &&
                    pile.pos.y >= p.y0 && pile.pos.y <= p.y1,
            );

        let currentPatchIndex = -1;
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            if (pos.x >= p.x0 && pos.x <= p.x1 && pos.y >= p.y0 && pos.y <= p.y1) {
                currentPatchIndex = i;
                break;
            }
        }

        // Standing anywhere in the patch's 8x8 footprint used to be treated
        // as "explored it" — an ant one tile past the boundary, having seen
        // nothing of the interior, would call the whole patch barren and
        // immediately leave (bug found in review: "they don't go up the
        // tile, they just enter a food section [and bail]"). Now it has to
        // actually walk toward the middle first.
        let exploringCurrentPatch = false;
        if (currentPatchIndex >= 0) {
            const centroid = centroidOf(patches[currentPatchIndex]);
            if (manhattanDistance(pos, centroid) > PATCH_EXPLORE_RADIUS) {
                // Just crossed the edge — head for the middle before judging
                // it. Skip the next-patch search below entirely this tick.
                nearestPatchTarget = centroid;
                exploringCurrentPatch = true;
            } else if (!patchHasPile(patches[currentPatchIndex])) {
                // Actually reached the interior and it's still dry — now
                // it's a real observation.
                barrenPatchIndex = currentPatchIndex;
            }
        }

        if (!exploringCurrentPatch) {
            // Explore the nearest patch this ant hasn't just written off as
            // empty, skipping the one it's standing in. `fallback` (plain
            // nearest) covers the case where every other patch is
            // remembered-empty — better to re-check a stale one than freeze.
            let bestDist = Infinity;
            let fallbackDist = Infinity;
            let fallback: Position | undefined;
            for (let i = 0; i < patches.length; i++) {
                if (i === currentPatchIndex) continue;
                const centroid = centroidOf(patches[i]);
                const d = manhattanDistance(pos, centroid);

                if (d < fallbackDist) {
                    fallbackDist = d;
                    fallback = centroid;
                }
                if (patchKnownEmpty(ant.memory, i, state.simTime)) continue;
                if (d < bestDist) {
                    bestDist = d;
                    nearestPatchTarget = centroid;
                }
            }
            if (nearestPatchTarget === undefined) nearestPatchTarget = fallback;
        }
    }

    // "Available" means: still an EGG, physically still sitting in the
    // QUEEN chamber, and not already claimed by a nurse. Nest-only in
    // practice (a forager never reads this) but computed unconditionally,
    // same as before this phase — cheap enough that gating it behind
    // `where` would just be an extra branch for no real savings.
    let eggsWaitingCount = 0;
    for (const brood of state.brood) {
        if (
            brood.stage === "EGG" &&
            brood.carriedBy === undefined &&
            chamberAt(state.nest, brood.position) === "QUEEN"
        ) {
            eggsWaitingCount += 1;
        }
    }
    const eggsAvailableInQueenChamber = eggsWaitingCount > 0;

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
        diggingTarget,
        queenEggPos,
        nurseryPlacementPos,
        broodNeedingTendPos,
        broodUrgentTendPos,
        eggsWaitingCount,
        queenHungry,
        queenPos,
        predatorVisible,
        predatorPos,
        beingChased,
        alarmLevel,
        isSpooked,
        atExitMouth,
        atHole,
        holePos,
        onFoodPileId,
        nearestFoodPilePos,
        trailNeighbor,
        rememberedFoodPos,
        nearestPatchTarget,
        barrenPatchIndex,
        carrying: ant.carrying,
        hungerRatio: ant.energy / MAX_ENERGY,
        foodStoreAmount: state.foodStore.amount,
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