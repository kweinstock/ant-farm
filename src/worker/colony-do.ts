// ColonyDO — the single authoritative Durable Object. One instance, name
// "global-colony" (see worker/index.ts — that's the only place that name
// is chosen). Holds the whole ColonyState in memory and owns the tick loop.
//
// PHASE 13: in-memory only. No persistence.ts calls (that's Phase 14), so a
// cold start / eviction always begins from createInitialState() with a fixed
// seed — the colony rewinds to tick 0 rather than resuming. alarm() also
// does NOT use worker/loop.ts's wall-clock catch-up logic (that file is
// explicitly untouched this phase): with nothing persisted, there's nothing
// meaningful to catch up from, so alarm() just advances exactly one sim tick
// per firing and reschedules itself. Wall-clock replay after hibernation
// becomes meaningful once Phase 14 adds real persistence.
import { DurableObject } from "cloudflare:workers";
import { createInitialState, step, toSnapshot, type ColonyState } from "../sim";
import { TICK_MS, PROTOCOL_VERSION } from "../shared/constants";
import type { Hello, Snapshot } from "../shared/protocol";
import { registerConnection, unregisterConnection } from "./connections";
import { broadcastDiff } from "./broadcast";

const COLONY_SEED = 12345;

export class ColonyDO extends DurableObject<Env> {
    private colony: ColonyState;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.colony = createInitialState(COLONY_SEED);

        ctx.blockConcurrencyWhile(async () => {
            const existing = await ctx.storage.getAlarm();
            if (existing === null) {
                await ctx.storage.setAlarm(Date.now() + TICK_MS);
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
            const prevSnapshot = toSnapshot(this.colony);

            const result = step(this.colony, 1);
            this.colony = result.state;

            broadcastDiff(this.ctx, prevSnapshot, this.colony);
        } finally {
            await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
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