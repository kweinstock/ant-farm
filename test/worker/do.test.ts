import { describe, it, expect } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { PROTOCOL_VERSION, TICK_MS, ALARM_MS, IDLE_ALARM_MS, MAX_CATCHUP_TICKS, MAX_RUN_TICKS, SAVE_EVERY_TICKS } from "../../src/shared/constants";
import type { Hello, Snapshot, Batch } from "../../src/shared/protocol";

async function debugSnapshot(stub: DurableObjectStub) {
    const res = await stub.fetch("https://example.com/ant-farm/api/debug/snapshot");
    return res.json<{ simTime: number }>();
}

// lastTickMs is private on ColonyDO; tests reach in to simulate elapsed time
// without actually waiting for it.
async function rewindClock(stub: DurableObjectStub, ms: number) {
    await runInDurableObject(stub, (instance) => {
        (instance as unknown as { lastTickMs: number }).lastTickMs -= ms;
    });
}

// Milliseconds until the pending alarm fires.
async function alarmInMs(stub: DurableObjectStub): Promise<number> {
    const at = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    return (at ?? 0) - Date.now();
}

async function forceSave(stub: DurableObjectStub) {
    await runInDurableObject(stub, (instance) => (instance as unknown as { save(): Promise<void> }).save());
}

// ctx.abort() kills the live instance like an eviction; the next request builds
// a new one from storage. The in-flight call rejects on purpose, and the old
// stub is left broken (it rethrows the abort error), so this returns a fresh
// stub for the same object — use that one afterwards.
async function evict(stub: DurableObjectStub): Promise<DurableObjectStub> {
    try {
        await runInDurableObject(stub, (_i, state) => state.abort("test: simulated eviction"));
    } catch {
        // expected
    }
    return env.COLONY.get(stub.id);
}

async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 20; i++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("waitFor timed out");
}

// Opens a stream socket; next() yields its messages in order.
async function connect(stub: DurableObjectStub) {
    const res = await stub.fetch("https://example.com/ant-farm/api/stream", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    if (!ws) throw new Error("Expected a WebSocket in the 101 response");
    ws.accept();
    const inbox: unknown[] = [];
    const waiting: ((message: unknown) => void)[] = [];
    ws.addEventListener("message", (event: MessageEvent) => {
        const message = JSON.parse(event.data as string);
        const waiter = waiting.shift();
        if (waiter) waiter(message);
        else inbox.push(message);
    });
    const next = () =>
        new Promise<unknown>((resolve) => {
            if (inbox.length > 0) resolve(inbox.shift());
            else waiting.push(resolve);
        });
    return { ws, next };
}

describe("ColonyDO", () => {
    it("advances simTime on alarm and reschedules itself", async () => {
        const id = env.COLONY.idFromName(`test-alarm-${crypto.randomUUID()}`);
        const stub = env.COLONY.get(id);

        const before = await debugSnapshot(stub);
        const ran = await runDurableObjectAlarm(stub);
        expect(ran).toBe(true);
        const after = await debugSnapshot(stub);

        expect(after.simTime).toBeGreaterThan(before.simTime);
    });

    it("sends Hello then Snapshot then a Batch of Diffs to a connecting socket", async () => {
        const id = env.COLONY.idFromName(`test-stream-${crypto.randomUUID()}`);
        const stub = env.COLONY.get(id);

        const res = await stub.fetch("https://example.com/ant-farm/api/stream", {
            headers: { Upgrade: "websocket" },
        });
        expect(res.status).toBe(101);

        const client = res.webSocket;
        if (!client) throw new Error("Expected a WebSocket in the 101 response");
        client.accept();

        const nextMessage = () =>
            new Promise<unknown>((resolve) => {
                client.addEventListener("message", (event: MessageEvent) => resolve(JSON.parse(event.data as string)), { once: true });
            });

        const hello = (await nextMessage()) as Hello;
        expect(hello.kind).toBe("hello");
        expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);

        const snapshot = (await nextMessage()) as Snapshot;
        expect(snapshot.kind).toBe("snapshot");

        const diffPromise = nextMessage();
        await runDurableObjectAlarm(stub);
        const batch = (await diffPromise) as Batch;
        expect(batch.kind).toBe("batch");
        expect(batch.frames.length).toBeGreaterThanOrEqual(1);
        expect(batch.frames[0].kind).toBe("diff");
        expect(batch.frames[0].baseSeq).toBe(snapshot.data.seq);
        for (let i = 1; i < batch.frames.length; i++) {
            expect(batch.frames[i].baseSeq).toBe(batch.frames[i - 1].seq);
        }

        client.close();
    });

    it("runs every elapsed tick in a single alarm", async () => {
        const id = env.COLONY.idFromName(`test-batch-${crypto.randomUUID()}`);
        const stub = env.COLONY.get(id);

        const before = await debugSnapshot(stub);
        // Pretend a full alarm interval has passed since the last tick.
        await rewindClock(stub, ALARM_MS);
        await runDurableObjectAlarm(stub);
        const after = await debugSnapshot(stub);

        expect(after.simTime - before.simTime).toBeGreaterThanOrEqual(ALARM_MS / TICK_MS - 1);
    });

    it("idle: runs the whole gap (up to MAX_RUN_TICKS) and schedules the next alarm far out", async () => {
        const id = env.COLONY.idFromName(`test-cap-${crypto.randomUUID()}`);
        const stub = env.COLONY.get(id);

        const before = await debugSnapshot(stub);
        await rewindClock(stub, 60 * 60 * 1000); // an hour behind
        await runDurableObjectAlarm(stub);
        const after = await debugSnapshot(stub);

        expect(after.simTime - before.simTime).toBe(MAX_RUN_TICKS);
        expect(await alarmInMs(stub)).toBeGreaterThan(IDLE_ALARM_MS - 5000);
    });

    it("watched: stays on the 5 s cadence and caps a batch at MAX_CATCHUP_TICKS", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-watched-${crypto.randomUUID()}`));
        const { ws } = await connect(stub);

        const before = await debugSnapshot(stub);
        await rewindClock(stub, 60 * 60 * 1000);
        await runDurableObjectAlarm(stub);

        expect((await debugSnapshot(stub)).simTime - before.simTime).toBe(MAX_CATCHUP_TICKS);
        expect(await alarmInMs(stub)).toBeLessThan(ALARM_MS + 2000);
        ws.close();
    });

    it("the first viewer after an idle gap is snapped to the present", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-snap-${crypto.randomUUID()}`));
        await rewindClock(stub, 10 * 60 * 1000); // 3000 ticks behind

        const { ws, next } = await connect(stub);
        await next(); // hello
        const snapshot = (await next()) as Snapshot;

        expect(snapshot.data.simTime).toBeGreaterThanOrEqual((10 * 60 * 1000) / TICK_MS - 1);
        expect(await alarmInMs(stub)).toBeLessThan(ALARM_MS + 2000);
        ws.close();
    });

    it("a second viewer does not advance the colony", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-second-${crypto.randomUUID()}`));
        const first = await connect(stub);
        await rewindClock(stub, 3000);

        const before = await debugSnapshot(stub);
        const second = await connect(stub);

        expect((await debugSnapshot(stub)).simTime).toBe(before.simTime);
        first.ws.close();
        second.ws.close();
    });

    it("the last viewer leaving moves the alarm back to the idle gap", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-leave-${crypto.randomUUID()}`));
        const { ws } = await connect(stub);
        expect(await alarmInMs(stub)).toBeLessThan(ALARM_MS + 2000);

        ws.close();

        await waitFor(async () => (await alarmInMs(stub)) > IDLE_ALARM_MS - 5000);
    });

    it("resumes from storage after eviction instead of restarting at tick 0", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-evict-${crypto.randomUUID()}`));
        await rewindClock(stub, ALARM_MS);
        await runDurableObjectAlarm(stub); // idle alarm: runs ~25 ticks and saves
        const before = await debugSnapshot(stub);
        expect(before.simTime).toBeGreaterThan(0);

        const revived = await evict(stub);

        expect((await debugSnapshot(revived)).simTime).toBe(before.simTime);
    });

    it("replays the time that passed while it was gone", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-replay-${crypto.randomUUID()}`));
        await forceSave(stub);
        await runInDurableObject(stub, async (_i, state) => {
            const saved = await state.storage.get<number>("lastTickMs");
            await state.storage.put("lastTickMs", saved! - 10_000); // saved 10 s ago
        });
        const revived = await evict(stub);

        const before = await debugSnapshot(revived);
        await runDurableObjectAlarm(revived);

        expect((await debugSnapshot(revived)).simTime - before.simTime).toBeGreaterThanOrEqual(10_000 / TICK_MS);
    });

    it("starts fresh instead of crashing when the save is from another schema version", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-schema-${crypto.randomUUID()}`));
        await rewindClock(stub, ALARM_MS);
        await runDurableObjectAlarm(stub);
        await runInDurableObject(stub, (_i, state) => state.storage.put("schemaVersion", -1));

        const revived = await evict(stub);

        expect((await debugSnapshot(revived)).simTime).toBe(0);
    });

    it("while watched, saves on its own every SAVE_EVERY_TICKS ticks", async () => {
        const stub = env.COLONY.get(env.COLONY.idFromName(`test-autosave-${crypto.randomUUID()}`));
        const { ws } = await connect(stub); // connecting saves once
        const savedSeq = () => runInDurableObject(stub, (_i, state) => state.storage.get<number>("seq"));
        const start = (await savedSeq())!;

        for (let i = 0; i < SAVE_EVERY_TICKS / MAX_CATCHUP_TICKS; i++) {
            await rewindClock(stub, MAX_CATCHUP_TICKS * TICK_MS);
            await runDurableObjectAlarm(stub);
        }

        expect((await savedSeq())!).toBeGreaterThanOrEqual(start + SAVE_EVERY_TICKS);
        ws.close();
    });
});