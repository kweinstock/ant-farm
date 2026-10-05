// Reconstructs a renderer-compatible ColonyState from a network SnapshotDTO.
//
// Why this exists: engine.ts / ant-props.ts / brood-props.ts / corpse-props.ts
// / food-props.ts / ambient-light.ts all take a real ColonyState (or EnvState)
// and read specific fields off it. Rather than changing every one of those
// files to accept a second, DTO-shaped type, this reconstructs real Ant /
// Brood / Corpse / FoodPile / EnvState objects from the DTOs — so "stream"
// mode can hand the exact same ColonyState shape to the exact same render
// code "local" mode already uses, with zero changes to any render/*.ts file.
//
// What's fabricated vs real, explicitly:
//   - ants/brood/corpses/foodPiles/foodStore/env/seq/simTime/queenId: REAL,
//     taken directly from the snapshot every call.
//   - grid/nest/surface.grid/surface.holePos/surface.graveyard/surface.patches:
//     NOT real network data — carried over unchanged from `base`, a ColonyState
//     built once locally with createInitialState(). This is safe ONLY because
//     createStarterNest()/createSurface() take no seed and are purely a
//     function of GRID_WIDTH/HEIGHT/SURFACE_WIDTH/HEIGHT — the same fixed
//     dimensions on client and server — so this geometry is identical to the
//     server's regardless of which "base" built it.
//   - env.predator, weather ticksRemaining/forecast: REAL (added to the wire
//     in protocol v2 because the surface view and dashboard read them).
//   - env.graveyardThreat, and anything digging-related
//     (state.nest's chambers growing over time): STALE. Nest/grid were
//     deliberately left out of the wire protocol as routing-internal (see
//     state.ts's toSnapshot header), so a colony that digs new chambers while
//     you're connected in stream mode will not visually grow here. That's a
//     real, known limitation, not an oversight — closing it means putting
//     nest/grid changes on the wire, which is its own, larger decision.
//   - Ant fields never read by the renderer (lifespanTicks, wakeAt,
//     ticksAwake, sleepPhase, spookedUntil, memory) are filled with inert
//     placeholders (0 / emptyMemory()). Verified by grep against every
//     render/*.ts file that none of these are read in the render path. If a
//     future feature (a tooltip, an inspector panel) starts reading one of
//     these off state.ants in stream mode, it will silently get a wrong
//     placeholder instead of an error — that's the real cost of this
//     approach, worth remembering before building on top of it.
import type { ColonyState } from "../../sim/state";
import type { Ant, AntId } from "../../sim/ants/ant";
import { emptyMemory } from "../../sim/ants/memory";
import type { Brood, BroodId } from "../../sim/colony/brood";
import type { Corpse } from "../../sim/corpses";
import type { FoodPile } from "../../sim/world/surface";
import type { Predator } from "../../sim/environment/hazards";
import type { SnapshotDTO, PredatorDTO } from "../../shared/protocol";

// Only pos/huntingAntId are read by the renderer (surface-view.ts,
// dashboard-stats.ts); the AI-internal fields are inert placeholders.
function predatorFromDTO(dto: PredatorDTO, fallback: Predator | null): Predator {
    const pos = { x: dto.x, y: dto.y };
    return {
        pos,
        entryEdge: fallback?.entryEdge ?? "N",
        roamTargetPos: pos,
        huntingAntId: dto.huntingAntId,
        huntStreak: 0,
        huntCooldownTicks: 0,
    };
}

export function colonyStateFromSnapshot(base: ColonyState, snapshot: SnapshotDTO): ColonyState {
    const ants = new Map<AntId, Ant>();
    for (const dto of snapshot.ants) {
        ants.set(dto.id, {
            id: dto.id,
            name: dto.name,
            caste: dto.caste,
            job: dto.job,
            // Only .length is ever read off `carrying` in the render path
            // (ant-props.ts: "ant.carrying.length > 0") — contents don't
            // matter, so a sparse array of the right length is sufficient.
            carrying: new Array<BroodId>(dto.carryingBroodCount),
            carryingFood: dto.carryingFood,
            memory: emptyMemory(),
            location: { where: dto.where, pos: { x: dto.x, y: dto.y } },
            energy: dto.energy,
            ageTicks: dto.ageTicks,
            lifespanTicks: 0,
            asleep: dto.asleep,
            wakeAt: 0,
            ticksAwake: 0,
            sleepPhase: 0,
            spookedUntil: 0,
        });
    }

    const brood: Brood[] = snapshot.brood.map((b) => ({
        id: b.id,
        stage: b.stage,
        progressTicks: 0,
        position: { x: b.x, y: b.y },
        carriedBy: b.carriedBy,
        lastTendedTick: 0,
    }));

    const corpses: Corpse[] = snapshot.corpses.map((c) => ({
        id: c.id,
        location: { where: c.where, pos: { x: c.x, y: c.y } },
        carriedBy: c.carriedBy,
        ageTicks: 0,
    }));

    const foodPiles: FoodPile[] = snapshot.foodPiles.map((p) => ({
        id: p.id,
        pos: { x: p.x, y: p.y },
        amount: p.amount,
        capacity: p.capacity,
        ageTicks: 0,
    }));

    return {
        ...base,
        seq: snapshot.seq,
        simTime: snapshot.simTime,
        queenId: snapshot.queenId,
        ants,
        brood,
        corpses,
        foodStore: { amount: snapshot.foodStore.amount, capacity: snapshot.foodStore.capacity },
        env: {
            ...base.env, // keeps predator/graveyardThreat at their stale initial values — see header note
            season: snapshot.env.season,
            timeOfDay: snapshot.env.timeOfDay,
            phase: snapshot.env.phase,
            ambientTemp: snapshot.env.ambientTemp,
            dayOfYear: snapshot.env.dayOfYear,
            weather: {
                kind: snapshot.env.weather,
                ticksRemaining: snapshot.env.weatherTicksRemaining,
                forecast: snapshot.env.weatherForecast,
            },
            predator: snapshot.env.predator ? predatorFromDTO(snapshot.env.predator, base.env.predator) : null,
        },
        surface: { ...base.surface, foodPiles },
    };
}