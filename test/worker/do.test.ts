import { describe, it, expect } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { PROTOCOL_VERSION, TICK_MS, ALARM_MS, MAX_CATCHUP_TICKS } from "../../src/shared/constants";
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

    it("caps catch-up at MAX_CATCHUP_TICKS after a long gap", async () => {
        const id = env.COLONY.idFromName(`test-cap-${crypto.randomUUID()}`);
        const stub = env.COLONY.get(id);

        const before = await debugSnapshot(stub);
        await rewindClock(stub, 60 * 60 * 1000); // an hour behind
        await runDurableObjectAlarm(stub);
        const after = await debugSnapshot(stub);

        expect(after.simTime - before.simTime).toBe(MAX_CATCHUP_TICKS);
    });
});