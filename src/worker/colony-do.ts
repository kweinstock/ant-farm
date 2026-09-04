// ColonyDO — the single authoritative Durable Object. One instance, name
// "global-colony". Holds the whole ColonyState in memory and owns the tick loop.
//
// constructor(state, env):
//   - load the last snapshot from DO storage via persistence.ts, or
//     createInitialState(seed) on first ever run
//   - remember lastTickWallClock
//   - ensure an alarm is scheduled
//
// fetch(request):
//   - WebSocket upgrade  -> accept with the Hibernation API, send Hello + full
//                           Snapshot, register via connections.ts
//   - POST action        -> inputs.ts validate/rate-limit/clamp, queue for next tick, return ActionAck
//   - GET snapshot       -> current toSnapshot() as JSON (debug / SSR fallback)
//
// alarm():
//   - compute elapsed wall-clock -> ticksToRun (loop.ts, capped by MAX_CATCHUP_TICKS)
//   - for each tick: applyInputs + sim.step(); accumulate events
//   - broadcast.ts sends Diffs (or periodic full Snapshot) to all sockets
//   - persistence.ts writes snapshot every N ticks
//   - lineage-sink.ts flushes Birth/Death/Extinct/name events to D1
//   - schedule the next alarm  => self-perpetuating loop, zero idle compute
//
// webSocketMessage / webSocketClose / webSocketError:
//   - Hibernation API handlers; parse Subscribe hints, clean up connections.ts
