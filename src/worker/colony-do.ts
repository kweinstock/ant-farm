// ColonyDO — the single authoritative Durable Object. One instance, name
// "global-colony" (see worker/index.ts — that's the only place that name
// is chosen). Holds the whole ColonyState in memory and owns the tick loop.
//
// PHASE 13: in-memory only. No persistence.ts calls (that's Phase 14), so a
// cold start / eviction always begins from createInitialState() with a fixed
// seed — the colony rewinds to tick 0 rather than resuming.
//
// Ticking is batched: the sim still advances one tick per TICK_MS (200 ms) of
// wall-clock time, but the object only wakes every ALARM_MS (5 s) — ~25 alarms
// per minute-ish instead of 300 — to keep requests inside the free-tier
// budget. Each alarm runs every tick that has elapsed (worker/loop.ts's
// ticksToRun) and sends them to viewers as one Batch of per-tick Diffs, which
// the client plays back at TICK_MS spacing. Replay after hibernation/eviction
// (loading persisted state first) is still Phase 14.
import { DurableObject } from "cloudflare:workers";
import { createInitialState, step, toSnapshot, type ColonyState } from "../sim";
import { TICK_MS, ALARM_MS, PROTOCOL_VERSION } from "../shared/constants";
import type { Hello, Snapshot, Diff } from "../shared/protocol";
import { registerConnection, unregisterConnection } from "./connections";
import { broadcastBatch, computeDiff } from "./broadcast";
import { ticksToRun } from "./loop";

const COLONY_SEED = 12345;

export class ColonyDO extends DurableObject<Env> {
    private colony: ColonyState;
    // Wall-clock time the sim has been advanced up to. Only ever moves forward
    // by whole ticks (never set to "now"), so rounding error can't build up.
    private lastTickMs: number;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.colony = createInitialState(COLONY_SEED);
        this.lastTickMs = Date.now();

        ctx.blockConcurrencyWhile(async () => {
            const existing = await ctx.storage.getAlarm();
            if (existing === null) {
                await ctx.storage.setAlarm(Date.now() + ALARM_MS);
            }
        });
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/ant-farm/api/stream") {
            if (request.headers.get("Upgrade") !== "websocket") {
                return new Response("Expected a WebSocket upgrade", { status: 426 });
            }
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            this.ctx.acceptWebSocket(server);
            this.sendHelloAndSnapshot(server);
            registerConnection(server, {lastAckedSeq: this.colony.seq});

            return new Response(null, {status: 101, webSocket: client});
        }

        // Test-only observability endpoint: lets test/worker/do.test.ts read
        // simTime without a WebSocket round trip. Not part of the phase's
        // real protocol surface (see shared/protocol.ts) — actions/REST
        // endpoints are Phase 15+.
        if (url.pathname === "/ant-farm/api/debug/snapshot") {
            return Response.json({ simTime: this.colony.simTime });
        }

        return new Response("Not found", { status: 404 });
    }

    private sendHelloAndSnapshot(ws: WebSocket): void {
        const hello: Hello = {
            kind: "hello",
            protocolVersion: PROTOCOL_VERSION,
            colonyId: "global-colony",
            simTime: this.colony.simTime,
            tickMs: TICK_MS,
        };
        ws.send(JSON.stringify(hello));

        const snapshot: Snapshot = {kind: "snapshot", data: toSnapshot(this.colony)};
        ws.send(JSON.stringify(snapshot));
    }

    async alarm(): Promise<void> {
        // try/finally: the alarm is the ONLY thing that drives the tick loop,
        // so if step() or the broadcast ever throws, skipping the reschedule
        // would stop the colony permanently until something else happened to
        // re-arm it. Reschedule no matter what; the error still propagates
        // to the runtime's logs.
        try {
            // At least one tick, so an early or immediate alarm (the tests fire
            // one right after construction) still advances the sim.
            const ticks = Math.max(1, ticksToRun(Date.now(), this.lastTickMs));
            this.lastTickMs += ticks * TICK_MS;

            const frames: Diff[] = [];
            let prev = toSnapshot(this.colony);
            for (let i = 0; i < ticks; i++) {
                this.colony = step(this.colony, 1).state;
                const next = toSnapshot(this.colony);
                frames.push(computeDiff(prev, next));
                prev = next;
            }

            broadcastBatch(this.ctx, frames);
        } finally {
            await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
        }
    }
    
    webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
        // No client -> server messages exist yet (Subscribe/actions are
        // Phase 16). Anything received here this phase is unexpected input;
        // silently ignoring it is deliberate rather than an oversight.
    }

    webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
        unregisterConnection(ws);
    }

    webSocketError(ws: WebSocket, _error: unknown): void {
        unregisterConnection(ws);
    }
}