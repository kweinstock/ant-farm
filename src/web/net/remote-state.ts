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
// What's real vs a placeholder, explicitly:
//   - REAL, from the wire every frame: ants (incl. lifespan and the undertaking
//     flag), brood, corpses (incl. carriedBy), food piles and store, seq/simTime,
//     env (incl. predator, weather timing), and the surface graveyard rect.
//   - REAL, cached per DTO: the nest layout (tiles + chambers; the distance fields
//     and tile lookup are rebuilt locally) and the pheromone trail/alarm layers.
//     The nest arrives with the snapshot and again whenever a dig changes it; the
//     pheromones arrive with each batch's last frame, so the overlay refreshes
//     every few seconds, not every tick.
//   - STILL TAKEN FROM `base` (a ColonyState built once locally with
//     createInitialState()): surface.grid / holePos / patches, which never change
//     at runtime and are pure functions of the fixed grid dimensions, and
//     env.graveyardThreat, which nothing in the render path reads.
//   - Ant fields nothing in the render path reads (wakeAt, ticksAwake, sleepPhase,
//     spookedUntil, memory, digging) and brood/corpse internals (progressTicks,
//     lastTendedTick, ageTicks) are inert placeholders (0 / emptyMemory()).
//     test/sim/stream-parity.test.ts compares the dashboard built from a real
//     state with the same state after a trip through the wire, so a readout that
//     starts depending on one of these shows up as a failing test instead of a
//     silently wrong number.
import type { ColonyState } from "../../sim/state";
import type { Ant, AntId } from "../../sim/ants/ant";
import { emptyMemory } from "../../sim/ants/memory";
import type { Brood, BroodId } from "../../sim/colony/brood";
import type { Corpse } from "../../sim/corpses";
import type { FoodPile } from "../../sim/world/surface";
import type { Predator } from "../../sim/environment/hazards";
import type { SnapshotDTO, PredatorDTO, NestDTO, PheromonesDTO } from "../../shared/protocol";
import type { Grid } from "../../sim/world/grid";
import type { Nest } from "../../sim/world/nest";
import { nestFromChambers } from "../../sim/world/nest";
import type { TrailField } from "../../sim/pheromones";
import { decodeNestTiles, decodeSparse } from "../../shared/wire-world";

// The nest layout and the pheromone layers are decoded into fresh typed arrays /
// BFS fields, which is real work (a dozen flood fills for the nest). They only
// change when a new DTO arrives (applyDiff carries the same object forward
// otherwise), so decode once per DTO and hand back the same objects every frame.
// The renderer relies on that too: a stable `state.nest` means "layout unchanged".
const nestCache = new WeakMap<NestDTO, { grid: Grid; nest: Nest }>();
const pheromoneCache = new WeakMap<PheromonesDTO, { trail: TrailField; alarm: TrailField }>();

function nestFor(base: ColonyState, dto: NestDTO | undefined): { grid: Grid; nest: Nest } {
    if (!dto) return { grid: base.grid, nest: base.nest };
    let cached = nestCache.get(dto);
    if (!cached) {
        const grid: Grid = { ...base.grid, tiles: decodeNestTiles(dto.tiles) };
        cached = { grid, nest: nestFromChambers(grid, dto.chambers) };
        nestCache.set(dto, cached);
    }
    return cached;
}

function pheromonesFor(base: ColonyState, dto: PheromonesDTO | undefined): { trail: TrailField; alarm: TrailField } {
    if (!dto) return { trail: base.surface.trail, alarm: base.surface.alarm };
    let cached = pheromoneCache.get(dto);
    if (!cached) {
        const { trail, alarm } = base.surface;
        cached = {
            trail: { ...trail, cells: decodeSparse(dto.trail, trail.cells.length) },
            alarm: { ...alarm, cells: decodeSparse(dto.alarm, alarm.cells.length) },
        };
        pheromoneCache.set(dto, cached);
    }
    return cached;
}

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
            lifespanTicks: dto.lifespanTicks,
            undertaking: dto.undertaking ? { corpseId: dto.undertaking } : undefined,
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

    const { grid, nest } = nestFor(base, snapshot.nest);
    const { trail, alarm } = pheromonesFor(base, snapshot.pheromones);

    return {
        ...base,
        grid,
        nest,
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
        surface: { ...base.surface, foodPiles, graveyard: { ...snapshot.graveyard }, trail, alarm },
        heirs: snapshot.heirs,
    };
}