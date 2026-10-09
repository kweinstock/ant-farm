// WebSocket client for /ant-farm/api/stream.
//   - connect, validate Hello.protocolVersion against shared/constants.ts
//   - maintain a running SnapshotDTO: replace wholesale on Snapshot, apply
//     keyed upsert/remove lists on top of it on each Diff
//   - frames arrive in Batches (one per server alarm) and are played back one
//     per TICK_MS, so movement looks like the live sim
//   - reconnects with backoff (1 s doubling to 30 s) if the socket drops or a
//     frame doesn't chain onto what we have (e.g. the server restored an older
//     save); a protocol-version mismatch is NOT retried — reload the page
//   - does NOT send Subscribe (no viewport filtering exists server-side yet —
//     see broadcast.ts); that's a real gap, not an oversight.
import { isServerMessage, type Hello, type SnapshotDTO, type Diff } from "../../shared/protocol";
import { PROTOCOL_VERSION, TICK_MS } from "../../shared/constants";
import type { SimEvent } from "../../sim";
import type { Tally } from "../../shared/tally";
import { HEIRS_CAP } from "../../sim/names/generator";

// A Batch delivers ~25 ticks at once and they play back one per TICK_MS. If
// frames pile up (background tabs throttle timers to ~1/s), fast-forward
// instead of falling further behind real time.
const MAX_BACKLOG = 50;
const RETRY_MS = 1000; // first reconnect delay; doubles per failed attempt
const MAX_RETRY_MS = 30_000;

export interface ColonyStreamCallbacks {
    onHello?: (hello: Hello) => void;
    // `events`: everything countable that happened in the frames applied since the
    // last call (including frames fast-forwarded past without a render).
    // `tally`: set only when this update came from a Snapshot (connect / resync) —
    // the colony's lifetime totals at that moment, to start the counters from.
    onUpdate?: (snapshot: SnapshotDTO, events: SimEvent[], tally?: Tally) => void;
    // Fires once per connection, when the first live frame (a Batch's first Diff)
    // has been applied. A Snapshot alone is a still picture: until frames follow,
    // the ants would sit frozen, so this is the point where the colony is "running".
    onLive?: () => void;
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

    // Merge new entries after the old ones (the server's insertion order), then
    // re-apply the same oldest-first cap the server uses, so both ends agree
    // without the server ever sending a removal.
    let heirs = diff.heirs ? { ...prev.heirs, ...diff.heirs } : prev.heirs;
    const heirKeys = Object.keys(heirs);
    if (heirKeys.length > HEIRS_CAP) {
        heirs = { ...heirs };
        for (let i = 0; i < heirKeys.length - HEIRS_CAP; i++) delete heirs[heirKeys[i]];
    }

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
        graveyard: diff.graveyard ?? prev.graveyard,
        heirs,
        // Carried forward by reference until a frame replaces them, which is what lets
        // remote-state.ts cache the decoded nest / pheromone layers by identity.
        pheromones: diff.pheromones ?? prev.pheromones,
        nest: diff.nest ?? prev.nest,
    };
}

export function colonyStreamUrl(): string {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/ant-farm/api/stream`;
}

export class ColonyStreamClient {
    private ws: WebSocket | null = null;
    private current: SnapshotDTO | null = null;
    private queue: Diff[] = [];
    private pendingEvents: SimEvent[] = [];
    private playTimer: ReturnType<typeof setInterval> | null = null;
    private wantOpen = false; // false after close()
    private retryMs = RETRY_MS;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private live = false; // true once a frame has been applied on top of this connection's snapshot

    constructor(private readonly url: string, private readonly callbacks: ColonyStreamCallbacks = {}) {}

    connect(): void {
        this.wantOpen = true;
        const ws = new WebSocket(this.url);
        ws.addEventListener("message", (event) => this.handleMessage(event.data));
        ws.addEventListener("close", (event) => {
            this.callbacks.onClose?.(event);
            if (this.ws === ws) {
                this.ws = null;
                this.scheduleReconnect();
            }
        });
        this.ws = ws;
    }

    getSnapshot(): SnapshotDTO | null {
        return this.current;
    }

    close(): void {
        this.wantOpen = false;
        if (this.retryTimer !== null) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.stopPlayback();
        this.ws?.close();
        this.ws = null;
    }

    private drop(): void {
        const ws = this.ws;
        this.ws = null;
        ws?.close();
        this.scheduleReconnect();
    }

    private stopPlayback(): void {
        if (this.playTimer !== null) clearInterval(this.playTimer);
        this.playTimer = null;
        this.queue = [];
        this.pendingEvents = [];
    }

    private scheduleReconnect(): void {
        if (!this.wantOpen || this.retryTimer !== null) return;
        this.stopPlayback();
        const delay = this.retryMs;
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect()
        }, delay);
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
            this.retryMs = RETRY_MS; // connected fine: reset the backoff
            return;
        }

        if (message.kind === "snapshot") {
            this.current = message.data;
            this.live = false;
            this.queue = [];
            this.pendingEvents = [];
            this.callbacks.onUpdate?.(this.current, [], message.tally);
            return;
        }

        if (!this.current) return;
        this.queue.push(...message.frames);
        if (this.playTimer === null) {
            this.playTimer = setInterval(() => this.playNext(), TICK_MS);
        }
    }

    private playNext(): void {
        // Over the backlog limit: apply the oldest frames silently to catch up.
        while (this.queue.length > MAX_BACKLOG) this.applyFrame(this.queue.shift()!, false);
        const frame = this.queue.shift();
        if (frame) this.applyFrame(frame, true); // empty queue: hold the last frame
    }

    private applyFrame(frame: Diff, notify: boolean): void {
        if (!this.current) return;
        // A diff is only valid on top of the exact snapshot it was computed
        // from. A mismatch means frames were missed or the server restored an
        // older save — applying it would corrupt the view, so drop the
        // connection and reconnect for a fresh snapshot.
        if (frame.baseSeq !== this.current.seq) {
            console.warn(`[ant-farm] stream out of sync (have seq ${this.current.seq}, diff base ${frame.baseSeq}) — closing`);
            this.drop();
            return;
        }
        this.current = applyDiff(this.current, frame);
        if (frame.events) this.pendingEvents.push(...frame.events);
        if (notify) {
            const events = this.pendingEvents;
            this.pendingEvents = [];
            this.callbacks.onUpdate?.(this.current, events);
            if (!this.live) {
                this.live = true;
                this.callbacks.onLive?.();
            }
        }
    }
}