// Tick orchestration, pure-ish helper for colony-do.ts:
//   ticksToRun(nowMs, lastTickMs, maxTicks) -> integer, clamped to [0, maxTicks]
//     (default cap MAX_CATCHUP_TICKS, the watched-alarm batch; idle alarms and
//      the connect-time catch-up pass MAX_RUN_TICKS)
//   a CPU-budget guard so a huge catch-up after a long eviction bails early and
//   finishes on the next alarm instead of blowing the Worker CPU limit.
// Keeps the "replay elapsed real time" logic in one testable place.
import { TICK_MS, MAX_CATCHUP_TICKS, MAX_RUN_TICKS } from "../shared/constants";

export function ticksToRun(nowMs: number, lastTickMs: number, maxTicks: number = MAX_CATCHUP_TICKS): number {
    const elapsed = nowMs - lastTickMs;
    if (elapsed <= 0) return 0;
    return Math.min(Math.floor(elapsed / TICK_MS), maxTicks);
}

// Where replay starts after loading a save: where the save left off, but never
// further back than one invocation can run (MAX_RUN_TICKS). An outage longer
// than that costs the colony the excess time rather than blowing the CPU limit.
export function replayStartMs(savedTicksMs: number, nowMs: number): number {
    return Math.max(savedTicksMs, nowMs - MAX_RUN_TICKS * TICK_MS);
}