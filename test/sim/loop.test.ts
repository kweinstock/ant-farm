import { describe, it, expect } from "vitest";
import { ticksToRun } from "../../src/worker/loop";
import { TICK_MS, MAX_CATCHUP_TICKS, ALARM_MS } from "../../src/shared/constants";

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
});
