import { describe, it, expect } from "vitest";
import { createInitialState, toSnapshot } from "../../src/sim/state";
import { step } from "../../src/sim";
import { encodeState, decodeState, SCHEMA_VERSION } from "../../src/sim/serialize";

const run = (s: ReturnType<typeof createInitialState>, ticks: number) => {
    for (let i = 0; i < ticks; i++) s = step(s, 1).state;
    return s;
};
// structuredClone is what Durable Object storage does to what it stores.
const roundTrip = (s: ReturnType<typeof createInitialState>) =>
    decodeState(structuredClone(encodeState(s)), SCHEMA_VERSION);

describe("serialize", () => {
    it("a restored colony equals the original", () => {
        const state = run(createInitialState(12345), 2000);
        expect(roundTrip(state)).toEqual(state);
    });

    it("a restored colony keeps evolving identically", () => {
        const state = run(createInitialState(12345), 2000);
        let a = state;
        let b = roundTrip(state);
        for (let i = 0; i < 1500; i++) {
            a = step(a, 1).state;
            b = step(b, 1).state;
            if (i % 100 === 0) expect(toSnapshot(b)).toEqual(toSnapshot(a));
        }
        expect(b).toEqual(a);
    });

    it("rejects a save from a different schema version", () => {
        expect(() => decodeState(encodeState(createInitialState(1)), SCHEMA_VERSION + 1)).toThrow(/schema/);
    });

    it("does not store derived nest data (it is rebuilt on load)", () => {
        const encoded = encodeState(createInitialState(1));
        expect(Object.keys(encoded.nest)).toEqual(["chambers"]);
    });

    // Tripwire: fails when ColonyState gains or loses a top-level field, as a
    // reminder to bump SCHEMA_VERSION and update this list.
    it("encoded colony has the expected top-level fields", () => {
        const keys = Object.keys(encodeState(createInitialState(1))).sort();
        expect(keys).toEqual(
            ["ants", "brood", "climateOverride", "corpses", "env", "foodStore", "grid", "nest", "nextAntId",
             "nextBroodId", "nextCorpseId", "queenId", "rngSeed", "seq", "simTime", "surface"].sort());
    });
});
