// Turns tick output into per-connection network payloads:
//   - compute a keyed Diff between the pre-tick and post-tick SnapshotDTO
//   - send it to every live socket (ctx.getWebSockets() — the Hibernation
//     API's own registry, not anything colony-do.ts tracks itself)
//   - update each socket's lastAckedSeq via connections.ts
// No viewport filtering or slow-consumer dropping yet — both are explicitly
// "optional"/future per the original stub; a flat broadcast-to-all is
// enough ant count for this phase.

import { type SnapshotDTO, type AntDTO, type BroodDTO, type CorpseDTO, type Diff, type FoodPileDTO } from "../shared/protocol";
import type { ColonyState } from "../sim";
import { toSnapshot } from "../sim";
import { getConnectionMeta, setConnectionMeta } from "./connections";

function keyedDiff<T extends { id: string }>(prev: T[], next: T[]): { upserted: T[]; removed: string[] } {
    const prevById = new Map(prev.map((row) => [row.id, row]));
    const nextById = new Map(next.map((row) => [row.id, row]));

    const upserted: T[] = [];
    for (const [id, row] of nextById) {
        const before = prevById.get(id);
        // New id, or an existing one whose row actually changed. Row-level
        // JSON comparison rather than hand-tracked per-field dirty flags —
        // cheap enough at this scale, and it can't drift from reality the
        // way a manually maintained dirty-bit set could.
        if (!before || JSON.stringify(before) !== JSON.stringify(row)) {
            upserted.push(row);
        }
    }

    const removed: string[] = [];
    for (const id of prevById.keys()) {
        if (!nextById.has(id)) removed.push(id);
    }

    return { upserted, removed };
}

export function computeDiff(prev: SnapshotDTO, next: SnapshotDTO): Diff {
    const ants = keyedDiff<AntDTO>(prev.ants, next.ants);
    const brood = keyedDiff<BroodDTO>(prev.brood, next.brood);
    const corpses = keyedDiff<CorpseDTO>(prev.corpses, next.corpses);
    const foodPiles = keyedDiff<FoodPileDTO>(prev.foodPiles, next.foodPiles);

    const foodChanged =
        prev.foodStore.amount !== next.foodStore.amount || prev.foodStore.capacity !== next.foodStore.capacity;
    const envChanged = JSON.stringify(prev.env) !== JSON.stringify(next.env);

    return {
        kind: "diff",
        baseSeq: prev.seq,
        seq: next.seq,
        simTime: next.simTime,
        antsUpserted: ants.upserted,
        antsRemoved: ants.removed,
        broodUpserted: brood.upserted,
        broodRemoved: brood.removed,
        corpsesUpserted: corpses.upserted,
        corpsesRemoved: corpses.removed,
        foodPilesUpserted: foodPiles.upserted,
        foodPilesRemoved: foodPiles.removed,
        foodStore: foodChanged ? next.foodStore : undefined,
        env: envChanged ? next.env : undefined,
    };
}

export function broadcastDiff(ctx: DurableObjectState, prevSnapshot: SnapshotDTO, colony: ColonyState): void {
    const nextSnapshot = toSnapshot(colony);
    const diff = computeDiff(prevSnapshot, nextSnapshot);
    const payload = JSON.stringify(diff);

    for (const ws of ctx.getWebSockets()) {
        try {
            ws.send(payload);
            const meta = getConnectionMeta(ws) ?? { lastAckedSeq: prevSnapshot.seq };
            setConnectionMeta(ws, { ...meta, lastAckedSeq: nextSnapshot.seq });
        } catch {
            // A broken/closing socket throwing here isn't ours to handle —
            // the Hibernation API drops it from getWebSockets() on its own;
            // webSocketClose/webSocketError (colony-do.ts) run separately.
        }
    }
}