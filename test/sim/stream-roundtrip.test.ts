import { describe, it, expect } from "vitest";
import { createInitialState, toSnapshot } from "../../src/sim/state";
import { step } from "../../src/sim";
import { computeDiff } from "../../src/worker/broadcast";
import { applyDiff } from "../../src/web/net/socket";

// The wire contract: server computes Diff(prev, next) from two toSnapshot()
// outputs, client applies it on top of its own copy. After every tick the
// client's reconstruction must equal the server's real snapshot exactly —
// otherwise stream mode silently drifts from the colony it claims to show.
// Entity order inside the arrays isn't part of the contract (the client
// rebuilds them from a Map), so compare by id.
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
const normalize = (s: ReturnType<typeof toSnapshot>) => ({
    ...s,
    ants: byId(s.ants),
    brood: byId(s.brood),
    corpses: byId(s.corpses),
    foodPiles: byId(s.foodPiles),
});

describe("stream protocol round trip", () => {
    it("applyDiff(prev, computeDiff(prev, next)) reproduces next for every tick", () => {
        let state = createInitialState(12345);
        let client = toSnapshot(state);

        for (let tick = 0; tick < 1500; tick++) {
            const prev = toSnapshot(state);
            state = step(state, 1).state;
            const next = toSnapshot(state);

            client = applyDiff(client, computeDiff(prev, next));
            expect(normalize(client)).toEqual(normalize(next));
        }
    });

    it("survives JSON transport (undefined fields drop out, nothing else changes)", () => {
        let state = createInitialState(12345);
        let client = JSON.parse(JSON.stringify(toSnapshot(state)));

        for (let tick = 0; tick < 300; tick++) {
            const prev = toSnapshot(state);
            state = step(state, 1).state;
            const next = toSnapshot(state);

            const wireDiff = JSON.parse(JSON.stringify(computeDiff(prev, next)));
            client = applyDiff(client, wireDiff);
            expect(normalize(client)).toEqual(normalize(JSON.parse(JSON.stringify(next))));
        }
    });

    it("a batch of consecutive frames applied in order reproduces the final snapshot", () => {
        let state = createInitialState(12345);
        let client = toSnapshot(state);
        let prev = client;
        const frames = [];
        for (let i = 0; i < 25; i++) {
            state = step(state, 1).state;
            const next = toSnapshot(state);
            frames.push(computeDiff(prev, next));
            prev = next;
        }

        // Frames chain: each one starts where the previous one ended.
        for (let i = 1; i < frames.length; i++) {
            expect(frames[i].baseSeq).toBe(frames[i - 1].seq);
        }

        // Through JSON, as a real Batch travels.
        const wire = JSON.parse(JSON.stringify({ kind: "batch", frames })) as { frames: typeof frames };
        for (const frame of wire.frames) client = applyDiff(client, frame);
        expect(normalize(client)).toEqual(normalize(JSON.parse(JSON.stringify(prev))));
    });
});
