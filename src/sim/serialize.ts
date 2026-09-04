// Compact encode/decode of ColonyState for Durable Object storage.
//
//   encode(state) -> Uint8Array      (typed-array columns + varint ant records; keep it small)
//   decode(bytes) -> ColonyState
//   SCHEMA_VERSION                    bump on any layout change; decode() migrates or rejects
//
// Used by src/worker/persistence.ts. Snapshots for the client use protocol.ts
// shapes instead — do not confuse the two.
