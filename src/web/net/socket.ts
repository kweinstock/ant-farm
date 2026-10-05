// WebSocket client for /ant-farm/api/stream.
//   - connect, validate Hello.protocolVersion against shared/constants.ts
//   - maintain a running SnapshotDTO: replace wholesale on Snapshot, apply
//     keyed upsert/remove lists on top of it on each Diff
//   - PHASE 13 does NOT reconnect on close/error, and does NOT send Subscribe
//     (no viewport filtering exists server-side yet — see broadcast.ts).
//     Both are real gaps, not oversights: auto-reconnect + resync-on-gap is
//     naturally Phase 14 work, since it overlaps with what persistence and
//     hibernation-replay change about what a "gap" even means.
import { isServerMessage, type Hello, type SnapshotDTO, type Diff } from "../../shared/protocol";
import { PROTOCOL_VERSION } from "../../shared/constants";

export interface ColonyStreamCallbacks {
    onHello?: (hello: Hello) => void;
    onUpdate?: (snapshot: SnapshotDTO) => void;
    onProtocolMismatch?: (serverVersion: number) => void;
    onClose?: (event: CloseEvent) => void;
}

export function applyDiff(prev: SnapshotDTO, diff: Diff): SnapshotDTO {
    const ants = new Map(prev.ants.map((a) => [a.id, a]));
    for (const a of diff.antsUpserted) ants.set(a.id, a);
    for (const id of diff.antsRemoved) ants.delete(id);

    const brood = new Map(prev.brood.map((b) => [b.id, b]));
    for (const b of diff.broodUpserted) brood.set(b.id, b);
    for (const id of diff.broodRemoved) brood.delete(id);

    const corpses = new Map(prev.corpses.map((c) => [c.id, c]));
    for (const c of diff.corpsesUpserted) corpses.set(c.id, c);
    for (const id of diff.corpsesRemoved) corpses.delete(id);

    const foodPiles = new Map(prev.foodPiles.map((p) => [p.id, p]));
    for (const p of diff.foodPilesUpserted) foodPiles.set(p.id, p);
    for (const id of diff.foodPilesRemoved) foodPiles.delete(id);

    return {
        seq: diff.seq,
        simTime: diff.simTime,
        queenId: prev.queenId,
        ants: [...ants.values()],
        brood: [...brood.values()],
        corpses: [...corpses.values()],
        foodPiles: [...foodPiles.values()],
        foodStore: diff.foodStore ?? prev.foodStore,
        env: diff.env ?? prev.env,
    };
}

export function colonyStreamUrl(): string {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/ant-farm/api/stream`;
}

export class ColonyStreamClient {
    private ws: WebSocket | null = null;
    private current: SnapshotDTO | null = null;

    constructor(private readonly url: string, private readonly callbacks: ColonyStreamCallbacks = {}) {}

    connect(): void {
        const ws = new WebSocket(this.url);
        ws.addEventListener("message", (event) => this.handleMessage(event.data));
        ws.addEventListener("close", (event) => this.callbacks.onClose?.(event));
        this.ws = ws;
    }

    getSnapshot(): SnapshotDTO | null {
        return this.current;
    }

    close(): void {
        this.ws?.close();
        this.ws = null;
    }

    private handleMessage(raw: unknown): void {
        if (typeof raw !== "string") return;
        let message: unknown;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }
        if (!isServerMessage(message)) return;

        if (message.kind === "hello") {
            if (message.protocolVersion !== PROTOCOL_VERSION) {
                this.callbacks.onProtocolMismatch?.(message.protocolVersion);
                this.close();
                return;
            }
            this.callbacks.onHello?.(message);
            return;
        }

        if (message.kind === "snapshot") {
            this.current = message.data;
            this.callbacks.onUpdate?.(this.current);
            return;
        }

        if (!this.current) return;
        // A diff is only valid on top of the exact snapshot it was computed
        // from. A mismatch means frames were missed or the server restarted
        // (in-memory colony resets to seq 0 on eviction this phase) —
        // applying it would silently corrupt the view, and there's no
        // resync request yet (Phase 14), so drop the connection instead.
        if (message.baseSeq !== this.current.seq) {
            console.warn(`[ant-farm] stream out of sync (have seq ${this.current.seq}, diff base ${message.baseSeq}) — closing`);
            this.close();
            return;
        }
        this.current = applyDiff(this.current, message);
        this.callbacks.onUpdate?.(this.current);
    }
}