// Tick orchestration, pure-ish helper for colony-do.ts:
//   ticksToRun(nowMs, lastTickMs) -> integer, clamped to [0, MAX_CATCHUP_TICKS]
//   a CPU-budget guard so a huge catch-up after a long eviction bails early and
//   finishes on the next alarm instead of blowing the Worker CPU limit.
// Keeps the "replay elapsed real time" logic in one testable place.
import { TICK_MS, MAX_CATCHUP_TICKS } from "../shared/constants";

export function ticksToRun(nowMs: number, lastTickMs: number): number {
    const elapsed = nowMs - lastTickMs;
    if (elapsed <= 0) return 0;
    return Math.min(Math.floor(elapsed / TICK_MS), MAX_CATCHUP_TICKS);
}