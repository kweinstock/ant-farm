// ColonyDO — the single authoritative Durable Object. One instance, name
// "global-colony" (see worker/index.ts — that's the only place that name
// is chosen). Holds the whole ColonyState in memory and owns the tick loop.
//
// PHASE 14: the colony is saved (worker/persistence.ts) and reloaded in the
// constructor, so an eviction or redeploy resumes it instead of resetting to
// tick 0. Missed wall-clock time is replayed (worker/loop.ts), capped at one
// invocation's worth (MAX_RUN_TICKS).
//
// The sim advances one tick per TICK_MS (200 ms) of wall-clock time, but the
// object wakes at two speeds to stay inside the free-tier request budget:
//   watched (>=1 socket)  every ALARM_MS (5 s): run the elapsed ticks (capped
//                         at MAX_CATCHUP_TICKS) and send one Batch of Diffs
//   idle (no sockets)     every IDLE_ALARM_MS (~20 min): run the whole gap in
//                         one go (<= MAX_RUN_TICKS), no snapshots/diffs, save,
//                         then sleep (the object is evicted until the next alarm)
// The first viewer after an idle stretch is snapped to the present: the
// backlog is run BEFORE their snapshot is built. Later viewers get the current
// snapshot with no catch-up (see fetch()).
import { DurableObject } from "cloudflare:workers";
import { createInitialState, step, toSnapshot, type ColonyState } from "../sim";
import { TICK_MS, ALARM_MS, IDLE_ALARM_MS, MAX_CATCHUP_TICKS, MAX_RUN_TICKS, SAVE_EVERY_TICKS, PROTOCOL_VERSION } from "../shared/constants";
import type { Hello, Snapshot, Diff } from "../shared/protocol";
import { registerConnection, unregisterConnection } from "./connections";
import { broadcastBatch, computeDiff } from "./broadcast";
import { ticksToRun, replayStartMs } from "./loop";
import { loadSnapshot, saveSnapshot } from "./persistence";
import { emptyTally, addTick, statEvents, type Tally } from "../shared/tally";
import { encodePheromones, encodeNest } from "../shared/wire-world";

const COLONY_SEED = 12345;

export class ColonyDO extends DurableObject<Env> {
    // Both assigned inside blockConcurrencyWhile (they need an async storage
    // read) before any other request can run.
    private colony!: ColonyState;
    // Wall-clock time the sim has been advanced up to. Only ever moves forward
    // by whole ticks (never set to "now"), so rounding error can't build up.
    private lastTickMs!: number;
    private ticksSinceSave = 0;
    // Lifetime counters (births, deaths by cause, trips, strikes, food delivered).
    // Advanced on every tick we run, including idle and replayed ones, and saved
    // with the colony so the totals survive an eviction.
    private tally: Tally = emptyTally();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        ctx.blockConcurrencyWhile(async () => {
            const saved = await loadSnapshot(ctx.storage);
            if (saved) {
                this.colony = saved.state;
                this.tally = saved.tally;
                this.lastTickMs = replayStartMs(saved.lastTickMs, Date.now());
            } else {
                this.colony = createInitialState(COLONY_SEED);
                this.lastTickMs = Date.now();
            }
            // Hibernated sockets can outlive an eviction but now disagree with
            // the restored state: re-send Hello + Snapshot so each viewer
            // resyncs without reconnecting. Per-socket try/catch: a throw here
            // would fail the constructor itself, and every later cold start
            // would fail the same way, so one dead socket must not be able to
            // take the whole object down.
            for (const ws of ctx.getWebSockets()) {
                try {
                    this.sendHelloAndSnapshot(ws);
                } catch (error) {
                    console.error("[ColonyDO] couldn't resync a restored socket:", error);
                }
            }

            const existing = await ctx.storage.getAlarm();
            if (existing === null) {
                await ctx.storage.setAlarm(Date.now() + (this.hasViewers() ? ALARM_MS : IDLE_ALARM_MS));
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

            // First viewer after an idle stretch: nobody else is mid-stream, so
            // run the whole backlog now and hand this viewer the colony as of
            // "now". With other viewers connected we must NOT advance here:
            // they'd never receive those ticks as frames, their frame chain
            // would break, and they'd drop and reconnect.
            if (!this.hasViewers()) {
                this.advance(ticksToRun(Date.now(), this.lastTickMs, MAX_RUN_TICKS), false);
                try {
                    await this.save();
                } catch (error) {
                    // A failed save must not lock the viewer out: the colony is
                    // already caught up in memory, and the next save retries
                    // (ticksSinceSave is only reset after a successful one).
                    console.error("[ColonyDO] save on connect failed:", error);
                }
                await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
            }

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

        // Pheromones and the nest layout aren't part of toSnapshot (see protocol.ts), so a
        // new viewer gets them here, once; after that they arrive on frames.
        const data = { ...toSnapshot(this.colony), pheromones: encodePheromones(this.colony), nest: encodeNest(this.colony) };
        const snapshot: Snapshot = {kind: "snapshot", data, tally: this.tally};
        ws.send(JSON.stringify(snapshot));
    }

    async alarm(): Promise<void> {
        // try/finally: the alarm is the ONLY thing that drives the tick loop,
        // so if step() or the broadcast ever throws, skipping the reschedule
        // would stop the colony permanently until something else happened to
        // re-arm it. Reschedule no matter what; the error still propagates
        // to the runtime's logs.
        try {
            const watched = this.hasViewers();
            // Watched: one batch, capped at MAX_CATCHUP_TICKS. Idle: run the
            // whole gap since the last alarm in one go, with no snapshots,
            // diffs or JSON since nobody receives them.
            const cap = watched ? MAX_CATCHUP_TICKS : MAX_RUN_TICKS;
            // At least one tick, so an early or immediate alarm (the tests fire
            // one right after construction) still advances the sim.
            const ticks = Math.max(1, ticksToRun(Date.now(), this.lastTickMs, cap));
            const frames = this.advance(ticks, watched);

            if (watched) {
                broadcastBatch(this.ctx, frames);
                if (this.ticksSinceSave >= SAVE_EVERY_TICKS) await this.save();
            } else {
                await this.save(); // about to be evicted: persist every idle alarm
            }        
        } finally {
            await this.ctx.storage.setAlarm(Date.now() + (this.hasViewers() ? ALARM_MS : IDLE_ALARM_MS));
        }
    }

    // `excluding`: a socket that's mid-close can still appear in getWebSockets().
    private hasViewers(excluding?: WebSocket): boolean {
        return this.ctx.getWebSockets().some((ws) => ws !== excluding && ws.readyState === WebSocket.OPEN);
    }

    // Runs `ticks` ticks; builds per-tick Diffs only when someone will receive them.
    private advance(ticks: number, collectFrames: boolean): Diff[] {
        const frames: Diff[] = [];
        let prev = collectFrames ? toSnapshot(this.colony) : null;
        for (let i = 0; i < ticks; i++) {
            const foodBefore = this.colony.foodStore.amount;
            const nestBefore = this.colony.nest;
            const result = step(this.colony, 1);
            this.colony = result.state;
            addTick(this.tally, result.events, foodBefore, this.colony.foodStore.amount);
            if (prev) {
                const next = toSnapshot(this.colony);
                const frame = computeDiff(prev, next);
                const events = statEvents(result.events);
                if (events.length > 0) frame.events = events;
                // digTile builds a new nest object, so a changed reference means the
                // layout changed this tick (a new chamber tile was finished).
                if (this.colony.nest !== nestBefore) frame.nest = encodeNest(this.colony);
                frames.push(frame);
                prev = next;
            }
        }
        // Pheromones change every tick, but an overlay and a dashboard count only need
        // a refresh per batch: attach the end-of-batch state to the last frame.
        if (frames.length > 0) frames[frames.length - 1].pheromones = encodePheromones(this.colony);
        this.lastTickMs += ticks * TICK_MS;
        this.ticksSinceSave += ticks;
        return frames;
    }

    private async save(): Promise<void> {
        await saveSnapshot(this.ctx.storage, this.colony, this.lastTickMs, this.tally);
        this.ticksSinceSave = 0;
    }
    
    webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
        // No client -> server messages exist yet (Subscribe/actions are
        // Phase 16). Anything received here this phase is unexpected input;
        // silently ignoring it is deliberate rather than an oversight.
    }

    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
        unregisterConnection(ws);
        await this.goIdleIfEmpty(ws);
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        unregisterConnection(ws);
        await this.goIdleIfEmpty(ws);
    }

    // Last viewer gone: drop the 5 s cadence, push the next alarm out to the idle gap.
    private async goIdleIfEmpty(leaving: WebSocket): Promise<void> {
        if (this.hasViewers(leaving)) return;
        await this.ctx.storage.setAlarm(Date.now() + IDLE_ALARM_MS);
    }

}