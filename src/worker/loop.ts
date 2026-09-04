// Tick orchestration, pure-ish helper for colony-do.ts:
//   ticksToRun(nowMs, lastTickMs) -> integer, clamped to [0, MAX_CATCHUP_TICKS]
//   a CPU-budget guard so a huge catch-up after a long eviction bails early and
//   finishes on the next alarm instead of blowing the Worker CPU limit.
// Keeps the "replay elapsed real time" logic in one testable place.
