import type { AntId, Caste, Job, BroodStage, WeatherKind, Season, TimeOfDay } from "./enums";
import type { BroodId } from "../sim/colony/brood";
import type { CorpseId } from "../sim/corpses";

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
}

export interface BroodDTO {
    id: BroodId;
    stage: BroodStage;
    x: number;
    y: number;
    // Read by render/brood-props.ts: a carried egg follows its nurse instead
    // of sitting at its own (stale) tile.
    carriedBy?: AntId;
}

export interface CorpseDTO {
    id: CorpseId;
    where: "nest" | "surface";
    x: number;
    y: number;
    // Read by render/corpse-props.ts and ant-props.ts (undertaker carrying).
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
}

export interface Snapshot {
    kind: "snapshot";
    data: SnapshotDTO;
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
}

export type ServerMessage = Hello | Snapshot | Diff;

export function isServerMessage(value: unknown): value is ServerMessage {
    if (typeof value !== "object" || value === null || !("kind" in value)) return false;
    const kind = (value as { kind: unknown }).kind;
    return kind === "hello" || kind === "snapshot" || kind === "diff";
}

// ---- Not yet defined this phase ----
// ActionAck   {actionId, accepted, reason?}
// Error       {code, message}
// Subscribe   {viewport?}   (client -> server)
// AntSummary / AntDetail / LineageNode / PinList / Stats   REST DTOs — Phase 16/17