// The undertaker-specific decide logic and act handlers — mirrors
// foraging.ts's structure exactly (a decideX function behavior.ts's rule
// delegates to, plus the act handlers jobs.ts dispatches to). Owning both
// halves here keeps behavior.ts's rule list and jobs.ts's switch from
// growing undertaker-specific branches inline, same reasoning foraging.ts
// already established for the forager round trip.
import type { Ant, AntLocation } from "./ant";
import type { Perception } from "./senses";
import type { Action } from "./behavior";
import { moveToward } from "./movement";
import { fieldToTile } from "../world/nest";
import type { ColonyState } from "../state";
import type { Position } from "../world/grid";
import type { ActResult } from "./jobs";

// Unlike decideForager, this reads everything it needs from Perception
// (carryingCorpse, assignedCorpse, atGraveyardSlot, ...) — no `ant` param.
export function decideUndertaker(perception: Perception): Action {
    if (perception.assignedCorpse === undefined) {
        return { type: "clearUndertaking" };
    }

    // Someone else already handled my corpse while I was en route — it's
    // buried, or it's in a space I can't reach it from (and I'm not the one
    // carrying it). Give up; assignUndertakers hands me a fresh one next tick
    // if any are still waiting.
    if (!perception.carryingCorpse && (perception.assignedCorpseBuried || perception.assignedCorpse.where !== perception.where)) {
        return { type: "clearUndertaking" };
    }

    if (perception.carryingCorpse) {
        if (perception.where === "nest") {
            return perception.atExitMouth ? { type: "crossExit" } : { type: "goto", role: "EXIT" };
        }

        if (perception.inGraveyard) {
            return perception.atGraveyardSlot
                ? { type: "dropCorpse" }
                : { type: "surfaceStep", target: perception.graveyardPos };
        }
        return { type: "surfaceRoute", target: perception.graveyardCentre };
    }

    if (perception.onAssignedCorpse) {
        return { type: "pickUpCorpse" };
    }

    // Walking OUT to a loose corpse: greedy step, not a routed field. The
    // corpse's tile is an arbitrary death spot (a new cached BFS per distinct
    // position), and assignment is proximity-weighted so the undertaker is
    // usually close already — the odd obstacle in the way is handled by
    // stepToward's sidestep. The two paths that actually cross the map with
    // obstacles in them — hauling a body to the graveyard, and a laden
    // forager going home — use surfaceRoute with a FIXED target, so their
    // fields are computed once and reused.
    return perception.where === "nest"
        ? { type: "moveToNestPoint", target: perception.assignedCorpse.pos }
        : { type: "surfaceStep", target: perception.assignedCorpse.pos };
}

export function pickUpCorpse(state: ColonyState, ant: Ant): ActResult {
    const corpseId = ant.undertaking?.corpseId;
    const corpse = corpseId !== undefined ? state.corpses.find((entry) => entry.id === corpseId) : undefined;

    if (!corpse || corpse.carriedBy !== undefined) {
        return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses: state.corpses, rngSeed: state.rngSeed };
    }

    const corpses = state.corpses.map((entry) =>
        entry.id === corpse.id ? { ...entry, carriedBy: ant.id } : entry
    );

    return { ant, brood: state.brood, foodStore: state.foodStore, surface: state.surface, corpses, rngSeed: state.rngSeed };
}

export function dropCorpse(state: ColonyState, ant: Ant): ActResult {
    const corpseId = ant.undertaking?.corpseId;
    // The ant walked all the way onto its assigned slot (decideUndertaker
    // only emits dropCorpse when atGraveyardSlot), so set the body down right
    // where the carrier is standing — no teleport.
    const target = ant.location.pos;

    const corpses = state.corpses.map((corpse) =>
        corpse.id === corpseId
            ? { ...corpse, location: { where: "surface" as const, pos: target }, carriedBy: undefined }
            : corpse
    );

    return {
        ant: { ...ant, undertaking: undefined },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses,
        rngSeed: state.rngSeed,
    };
}

export function clearUndertaking(state: ColonyState, ant: Ant): ActResult {
    return {
        ant: { ...ant, undertaking: undefined },
        brood: state.brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses: state.corpses,
        rngSeed: state.rngSeed,
    };
}

// Tile-precise nest walk toward an arbitrary target tile via an ad-hoc
// single-source distance field. Used by undertakers heading to a corpse and
// (Phase 6) by nurses walking to a specific egg / nursery tile — so it syncs
// any cargo the mover is carrying, the same way jobs.ts's `goto` does:
// carried eggs follow the nurse's position, a carried corpse follows too.
export function moveToNestPoint(state: ColonyState, ant: Ant, target: Position): ActResult {
    const field = fieldToTile(state.grid, target);
    const result = moveToward(state.grid, field, ant.location.pos, state.rngSeed);
    const location: AntLocation = { where: "nest", pos: result.position };

    const brood =
        ant.carrying.length > 0
            ? state.brood.map((entry) =>
                  ant.carrying.includes(entry.id) ? { ...entry, position: result.position } : entry
              )
            : state.brood;

    const corpses = state.corpses.some((corpse) => corpse.carriedBy === ant.id)
        ? state.corpses.map((corpse) => (corpse.carriedBy === ant.id ? { ...corpse, location } : corpse))
        : state.corpses;

    return {
        ant: { ...ant, location },
        brood,
        foodStore: state.foodStore,
        surface: state.surface,
        corpses,
        rngSeed: result.seed,
    };
}