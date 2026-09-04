// DO storage read/write (SQLite-backed Durable Object).
//   loadSnapshot() -> { bytes, seq, lastTickMs } | null
//   saveSnapshot(state, nowMs)   serialize.ts -> storage.put, plus seq + timestamp
//   write cadence: every N ticks and once more on webSocket hibernation / shutdown
// This snapshot is the crash/eviction recovery source of truth; losing it just
// means the colony rewinds to the last save, not data corruption.
