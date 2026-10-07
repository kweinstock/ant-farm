// DO storage read/write (SQLite-backed Durable Object).
//   loadSnapshot(storage) -> { state, lastTickMs } | null
//   saveSnapshot(storage, state, lastTickMs)
// Write cadence is colony-do.ts's call (every SAVE_EVERY_TICKS while watched,
// every idle alarm). This snapshot is the crash/eviction recovery source of
// truth; losing it just means the colony rewinds to the last save, not data
// corruption.
import { encodeState, decodeState, SCHEMA_VERSION, type ColonyState } from "../sim";
import type { EncodedState } from "../sim/serialize";
import { parseTally, type Tally } from "../shared/tally";

export interface LoadedColony {
    state: ColonyState;
    lastTickMs: number;
    tally: Tally;
}

// One put() with all four keys: storage writes them atomically, so a crash
// can't leave a snapshot paired with another save's timestamp.
export async function saveSnapshot(storage: DurableObjectStorage, state: ColonyState, lastTickMs: number, tally: Tally): Promise<void> {
    await storage.put({
        snapshot: encodeState(state),
        seq: state.seq,
        lastTickMs,
        schemaVersion: SCHEMA_VERSION,
        tally,
    });
}

// null = nothing saved, or what's saved can't be used. Both mean "start a
// fresh colony": a bad save is logged, never thrown, so it can't brick the
// object on every cold start.
export async function loadSnapshot(storage: DurableObjectStorage): Promise<LoadedColony | null> {
    const saved = await storage.get(["snapshot", "lastTickMs", "schemaVersion", "tally"]);
    const snapshot = saved.get("snapshot") as EncodedState | undefined;
    const lastTickMs = saved.get("lastTickMs") as number | undefined;
    const schemaVersion = saved.get("schemaVersion") as number | undefined;
    if (snapshot === undefined || lastTickMs === undefined || schemaVersion === undefined) return null;

    try {
        return { state: decodeState(snapshot, schemaVersion), lastTickMs, tally: parseTally(saved.get("tally")) };
    } catch (error) {
        console.error("[ColonyDO] discarding unusable saved colony:", error);
        return null;
    }
}