import { describe, it, expect } from "vitest";
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { PROTOCOL_VERSION } from "../../src/shared/constants";
import type { Hello, Snapshot, Diff } from "../../src/shared/protocol";

async function debugSnapshot(stub: DurableObjectStub) {
    const res = await stub.fetch("https://example.com/ant-farm/api/debug/snapshot");
    return res.json<{ simTime: number }>();
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

    it("sends Hello then Snapshot then a Diff to a connecting socket", async () => {
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
        const diff = (await diffPromise) as Diff;
        expect(diff.kind).toBe("diff");
        expect(diff.baseSeq).toBe(snapshot.data.seq);

        client.close();
    });
});