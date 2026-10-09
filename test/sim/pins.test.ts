import { describe, it, expect } from "vitest";
import { createInitialState, type ColonyState } from "../../src/sim/state";
import { updatePins, parsePins, createPinStore, MAX_PINS, PIN_GRACE_TICKS, PINS_KEY, type PinSet } from "../../src/web/state/pins";
import { resolveAnt } from "../../src/web/state/succession";

// A colony where the given ants are gone and `heirs` says who took over.
function colony(dead: string[], heirs: Record<string, string> = {}, simTime = 0): ColonyState {
    const base = createInitialState(12345);
    const ants = new Map(base.ants);
    for (const id of dead) ants.delete(id);
    return { ...base, ants, heirs, simTime };
}

const set = (...ids: string[]): PinSet => ({ ids, pendingSince: {} });
const [A, B, C, D] = ["ant-2", "ant-3", "ant-4", "ant-5"];

describe("pins: following an ant's heir", () => {
    it("a pin on a living ant stays put", () => {
        const result = updatePins(colony([]), set(A, B), false);
        expect(result.pins.ids).toEqual([A, B]);
        expect(result.changed).toBe(false);
    });

    it("moves to the heir when the ant dies", () => {
        const result = updatePins(colony([A], { [A]: B }), set(A), false);
        expect(result.pins.ids).toEqual([B]);
        expect(result.changed).toBe(true);
    });

    it("follows a chain across several deaths", () => {
        // A died, B took the name and died, C took it and died, D is alive.
        const result = updatePins(colony([A, B, C], { [A]: B, [B]: C, [C]: D }), set(A), false);
        expect(result.pins.ids).toEqual([D]);
        expect(resolveAnt(colony([A, B, C], { [A]: B, [B]: C, [C]: D }), A).id).toBe(D);
    });

    it("two pins that land on the same heir collapse into one", () => {
        const result = updatePins(colony([A, B], { [A]: C, [B]: C }), set(A, B), false);
        expect(result.pins.ids).toEqual([C]);
    });
});

describe("pins: a chain that was lost", () => {
    it("is dropped straight away on the first look at the colony (page load)", () => {
        const result = updatePins(colony([A]), set(A, B), true);
        expect(result.pins.ids).toEqual([B]);
        expect(result.changed).toBe(true);
    });

    it("is kept while an heir may still hatch, then dropped after the grace period", () => {
        const waiting = updatePins(colony([A], {}, 1000), set(A), false);
        expect(waiting.pins.ids).toEqual([A]);
        expect(waiting.changed).toBe(false);
        expect(waiting.pins.pendingSince[A]).toBe(1000);

        const stillWaiting = updatePins(colony([A], {}, 1000 + PIN_GRACE_TICKS), waiting.pins, false);
        expect(stillWaiting.pins.ids).toEqual([A]);

        const gone = updatePins(colony([A], {}, 1000 + PIN_GRACE_TICKS + 1), stillWaiting.pins, false);
        expect(gone.pins.ids).toEqual([]);
        expect(gone.changed).toBe(true);
    });

    it("moves on to the heir if one hatches during the grace period", () => {
        const waiting = updatePins(colony([A], {}, 1000), set(A), false);
        const heired = updatePins(colony([A], { [A]: B }, 2000), waiting.pins, false);
        expect(heired.pins.ids).toEqual([B]);
        expect(heired.pins.pendingSince).toEqual({});
    });
});

describe("pins: saved list", () => {
    it("parses only what is safe", () => {
        expect(parsePins(null)).toEqual([]);
        expect(parsePins("not json")).toEqual([]);
        expect(parsePins('{"a":1}')).toEqual([]);
        expect(parsePins('["ant-2", 7, "", "ant-2", "ant-9", null]')).toEqual(["ant-2", "ant-9"]);
        expect(parsePins(JSON.stringify(Array.from({ length: MAX_PINS + 10 }, (_, i) => `ant-${i}`)))).toHaveLength(MAX_PINS);
        expect(parsePins(JSON.stringify(["x".repeat(65)]))).toEqual([]);
    });

    it("the store saves toggles and reloads them", () => {
        const data = new Map<string, string>();
        const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };

        const store = createPinStore(storage);
        expect(store.toggle(A)).toBe(true);
        expect(store.toggle(B)).toBe(true);
        expect(store.toggle(A)).toBe(false);
        expect(JSON.parse(data.get(PINS_KEY)!)).toEqual([B]);

        expect(createPinStore(storage).ids()).toEqual([B]);
    });

    it("the store moves a pin to the heir, saves it, and tells listeners", () => {
        const data = new Map<string, string>([[PINS_KEY, JSON.stringify([A])]]);
        const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
        const store = createPinStore(storage);
        let heard = 0;
        store.subscribe(() => heard++);

        expect(store.update(colony([], {}))).toBe(false); // first look: A is alive, nothing to do
        expect(store.update(colony([A], { [A]: B }))).toBe(true);
        expect(store.ids()).toEqual([B]);
        expect(JSON.parse(data.get(PINS_KEY)!)).toEqual([B]);
        expect(heard).toBe(1);
    });

    it("the store caps the number of pins and survives missing storage", () => {
        const store = createPinStore(undefined);
        for (let i = 0; i < MAX_PINS; i++) expect(store.toggle(`ant-${i}`)).toBe(true);
        expect(store.toggle("one-too-many")).toBe(false);
        expect(store.ids()).toHaveLength(MAX_PINS);
    });
});
