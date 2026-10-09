import type { AntId, Caste, Job, BroodStage, WeatherKind, Season, TimeOfDay } from "./enums";
import type { BroodId } from "../sim/colony/brood";
import type { CorpseId } from "../sim/corpses";
import type { SimEvent } from "../sim";
import type { Tally } from "./tally";
import type { Chamber } from "../sim/world/nest";

export interface Hello {
    kind: "hello";
    protocolVersion: number;
    colonyId: string;
    simTime: number;
    tickMs: number;
}

// Flat, JSON-safe projection of ColonyState — see src/sim/state.ts's toSnapshot().
// No Maps, no typed arrays, no chamber/grid routing internals.
export interface AntDTO {
    id: AntId;
    name: string;
    caste: Caste;
    job: Job;
    where: "nest" | "surface";
    x: number;
    y: number;
    carryingFood: number;
    carryingBroodCount: number;
    energy: number;
    ageTicks: number;
    asleep: boolean;
    lifespanTicks: number;
    undertaking?: CorpseId;
}

export interface BroodDTO {
    id: BroodId;
    stage: BroodStage;
    x: number;
    y: number;
    carriedBy?: AntId;
}

export interface CorpseDTO {
    id: CorpseId;
    where: "nest" | "surface";
    x: number;
    y: number;
    carriedBy?: AntId;
}

// Only the fields the renderer/dashboard read (surface-view.ts, dashboard-stats.ts).
export interface PredatorDTO {
    x: number;
    y: number;
    huntingAntId?: AntId;
}

export interface SnapshotEnvDTO {
    season: Season;
    weather: WeatherKind;
    timeOfDay: TimeOfDay;
    ambientTemp: number;
    dayOfYear: number;
    phase: number;
    weatherTicksRemaining: number;
    weatherForecast: WeatherKind[];
    predator: PredatorDTO | null;
}

export interface RectDTO {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

// A pheromone layer as its non-zero cells only: `i` are cell indices
// (y * width + x), `v` the strengths. evaporate() floors every cell below
// MIN_TRAIL to exactly 0, so a layer is a few hundred entries, not 7,200.
// Values are float32-exact (see shared/wire-world.ts), so the dashboard's
// "cells above floor / mass" matches the server to the digit.
export interface SparseFieldDTO {
    i: number[];
    v: number[];
}

export interface PheromonesDTO {
    trail: SparseFieldDTO;
    alarm: SparseFieldDTO;
}

// The nest layout: dug-out tiles (one digit per cell, the TILE enum value,
// row-major) and the chamber list. Distance fields and the tile -> chamber
// lookup are NOT sent; the client rebuilds them with nestFromChambers.
export interface NestDTO {
    tiles: string;
    chambers: Chamber[];
}

export interface FoodPileDTO {
    id: string;
    x: number;
    y: number;
    amount: number;
    capacity: number;
}

export interface SnapshotDTO {
    seq: number;
    simTime: number;
    queenId: AntId;
    ants: AntDTO[];
    brood: BroodDTO[];
    corpses: CorpseDTO[];
    foodPiles: FoodPileDTO[];
    foodStore: { amount: number; capacity: number };
    env: SnapshotEnvDTO;
    graveyard: RectDTO;
    heirs: Record<AntId, AntId>;
    pheromones?: PheromonesDTO;
    nest?: NestDTO;
}

export interface Snapshot {
    kind: "snapshot";
    data: SnapshotDTO;
    // Lifetime totals as of this snapshot (see shared/tally.ts). Later frames'
    // `events` keep them current. Optional so an older server's snapshots parse.
    tally?: Tally;
}

// Keyed upsert/remove lists per entity kind — not a generic deep-diff
// engine. Computed by comparing two SnapshotDTOs (src/worker/broadcast.ts).
export interface Diff {
    kind: "diff";
    baseSeq: number;
    seq: number;
    simTime: number;
    antsUpserted: AntDTO[];
    antsRemoved: AntId[];
    broodUpserted: BroodDTO[];
    broodRemoved: BroodId[];
    corpsesUpserted: CorpseDTO[];
    foodPilesUpserted: FoodPileDTO[];
    foodPilesRemoved: string[];
    corpsesRemoved: CorpseId[];
    foodStore?: { amount: number; capacity: number };
    env?: SnapshotEnvDTO;
    graveyard?: RectDTO;
    // Only the entries added or changed this tick (a hatch adds one), not the
    // whole map. applyDiff merges them in and re-applies the cap.
    heirs?: Record<AntId, AntId>;
    pheromones?: PheromonesDTO;
    nest?: NestDTO;
    events?: SimEvent[];
}

// Every tick that ran in one alarm, in order. Each frame is a normal Diff and
// chains off the previous one (frames[i].seq === frames[i+1].baseSeq).
export interface Batch {
    kind: "batch";
    frames: Diff[];
}

export type ServerMessage = Hello | Snapshot | Batch;

export function isServerMessage(value: unknown): value is ServerMessage {
    if (typeof value !== "object" || value === null || !("kind" in value)) return false;
    const kind = (value as { kind: unknown }).kind;
    return kind === "hello" || kind === "snapshot" || kind === "batch";
}

// ---- Not yet defined ----
// ActionAck   {actionId, accepted, reason?}   (Phase 16, visitor actions)
// Error       {code, message}
// Subscribe   {viewport?}   (client -> server)