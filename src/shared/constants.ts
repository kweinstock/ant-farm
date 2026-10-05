// Tunable simulation + protocol constants shared by client and server.
//
// Anything a designer wants to tweak for BALANCE lives in src/sim's params file,
// not here. This file is only for values both sides must agree on byte-for-byte.

export const TICK_MS = 200; // wall-clock ms per sim tick
export const ALARM_MS = 5000; // how often the Durable Object wakes; each wake runs every tick that has elapsed (~25) and sends them as one Batch. Keep a multiple of TICK_MS.
export const MAX_CATCHUP_TICKS = 100; // cap on ticks per alarm: 4x the normal 25, slack for a late alarm
export const PROTOCOL_VERSION = 3; // bumped whenever protocol.ts message shapes change; client reconnects on mismatch

// ---- Not yet consumed — later phases ----
// SNAPSHOT_FULL_EVERY  send a full Snapshot instead of a Diff every N
//                      broadcasts, as a resync safety net — Phase 14+
// VISITOR_FOOD_PER_DAY / VISITOR_WATER_PER_DAY / MAX_PIN_PER_VISITOR
//                      per-visitor allowances enforced in src/worker/inputs.ts — Phase 16
//
// GRID_W/GRID_H and LIFESPAN_TICKS are deliberately NOT duplicated here — they
// already exist in src/sim/params.ts, and nothing outside src/sim needs a
// protocol-level copy of them yet.