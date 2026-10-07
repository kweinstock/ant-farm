import { describe, it, expect } from "vitest";
import { ticksToRun, replayStartMs } from "../../src/worker/loop";
import { TICK_MS, MAX_CATCHUP_TICKS, MAX_RUN_TICKS, ALARM_MS } from "../../src/shared/constants";

describe("ticksToRun", () => {
    it("is zero when no time has passed or the clock went backwards", () => {
        expect(ticksToRun(1000, 1000)).toBe(0);
        expect(ticksToRun(1000, 5000)).toBe(0);
    });

    it("counts only whole elapsed ticks", () => {
        expect(ticksToRun(TICK_MS - 1, 0)).toBe(0);
        expect(ticksToRun(TICK_MS, 0)).toBe(1);
        expect(ticksToRun(TICK_MS * 3 + TICK_MS / 2, 0)).toBe(3);
    });

    it("runs a full alarm interval's worth of ticks", () => {
        expect(ticksToRun(ALARM_MS, 0)).toBe(ALARM_MS / TICK_MS);
    });

    it("caps a huge gap at MAX_CATCHUP_TICKS", () => {
        expect(ticksToRun(10 * 60 * 60 * 1000, 0)).toBe(MAX_CATCHUP_TICKS);
    });

    it("honours a custom cap (the idle / connect catch-up cap)", () => {
        expect(ticksToRun(10 * 60 * 60 * 1000, 0, MAX_RUN_TICKS)).toBe(MAX_RUN_TICKS);
    });
});

describe("replayStartMs", () => {
    it("resumes exactly where the save left off for a short gap", () => {
        expect(replayStartMs(100_000, 130_000)).toBe(100_000);
    });

    it("never replays further back than one invocation can run", () => {
        const now = 10 * 60 * 60 * 1000;
        expect(replayStartMs(0, now)).toBe(now - MAX_RUN_TICKS * TICK_MS);
    });
});
