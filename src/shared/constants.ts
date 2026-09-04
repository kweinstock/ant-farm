// Tunable simulation + protocol constants shared by client and server.
//
// Anything a designer wants to tweak for BALANCE lives in src/sim's params file,
// not here. This file is only for values both sides must agree on byte-for-byte:
//
//   TICK_MS              wall-clock milliseconds per sim tick (drives request budget — see docs/cloudflare-setup.md)
//   MAX_CATCHUP_TICKS    cap on replayed ticks after the Durable Object wakes from hibernation
//   GRID_W, GRID_H       world dimensions in tiles
//   SNAPSHOT_FULL_EVERY  send a full snapshot instead of a diff every N broadcasts (resync safety)
//   LIFESPAN_TICKS       { QUEEN:[min,max], WORKER:[min,max], SOLDIER:[...], DRONE:[...] }
//   VISITOR_FOOD_PER_DAY / VISITOR_WATER_PER_DAY   per-visitor daily allowance (enforced in src/worker/inputs.ts)
//   MAX_PIN_PER_VISITOR
//   PROTOCOL_VERSION     bumped whenever protocol.ts message shapes change; client reconnects on mismatch
