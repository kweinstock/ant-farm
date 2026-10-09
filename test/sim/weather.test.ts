import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";
import type { WeatherKind } from "../../src/sim/environment/weather";

// environment/weather.ts is a seeded Markov chain threaded through
// state.rngSeed like every other RNG consumer, so the sequence of
// transitions has to be byte-identical between two runs of the same seed and
// between one big step() and many small ones. The matrix rows in params.ts
// are also gated by season (SNOW never in summer, HEAT never in winter) —
// checked here by pinning the season with a climateOverride and watching the
// kind never stray out of its allowed set.

function transitionLog(seed: number, ticks: number): { from: WeatherKind; to: WeatherKind; at: number }[] {
    let state = createInitialState(seed);
    const log: { from: WeatherKind; to: WeatherKind; at: number }[] = [];
    for (let t = 0; t < ticks; t++) {
        const { state: next, events } = step(state, 1);
        state = next;
        for (const event of events) {
            if (event.kind === "weatherChanged") {
                log.push({ from: event.from, to: event.to, at: state.simTime });
            }
        }
    }
    return log;
}

describe("weather", () => {
    it("transition sequence is identical across two runs of the same seed", () => {
        const a = transitionLog(20260907, 4000);
        const b = transitionLog(20260907, 4000);
        expect(a).toEqual(b);
        // Guard against a frozen chain making the equality vacuous.
        expect(a.length).toBeGreaterThan(3);
    });

    it("transition sequence is identical one big step vs many small steps", () => {
        const seed = 55555;
        const ticks = 3000;

        let small = createInitialState(seed);
        const smallLog: string[] = [];
        for (let t = 0; t < ticks; t++) {
            const r = step(small, 1);
            small = r.state;
            for (const e of r.events) {
                if (e.kind === "weatherChanged") smallLog.push(`${small.simTime}:${e.from}->${e.to}`);
            }
        }

        const big = step(createInitialState(seed), ticks);
        const bigLog = big.events
            .filter((e): e is Extract<typeof e, { kind: "weatherChanged" }> => e.kind === "weatherChanged")
            .map((e) => `${e.from}->${e.to}`);

        // The big step doesn't carry per-event simTime, so compare the
        // from->to chain and the count.
        expect(bigLog).toEqual(smallLog.map((s) => s.split(":")[1]));
    });

    it("respects seasonal gating: no SNOW in a forced summer, no HEAT in a forced winter", () => {
        let summer = createInitialState(1, { season: "SUMMER" });
        for (let t = 0; t < 4000; t++) {
            summer = step(summer, 1).state;
            expect(summer.env.weather.kind).not.toBe("SNOW");
        }

        let winter = createInitialState(1, { season: "WINTER" });
        let sawSnow = false;
        for (let t = 0; t < 4000; t++) {
            winter = step(winter, 1).state;
            expect(winter.env.weather.kind).not.toBe("HEAT");
            if (winter.env.weather.kind === "SNOW") sawSnow = true;
        }
        // Winter should actually reach snow at some point — confirms the
        // gating check above isn't passing just because weather never moved.
        expect(sawSnow).toBe(true);
    });
});
