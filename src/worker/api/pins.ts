// Visitor favorites — pure cross-visitor state in D1, never touches the sim.
//   GET    /ant-farm/api/pins            pins for X-Visitor-Id
//   POST   /ant-farm/api/pins {antId}    add (capped at MAX_PIN_PER_VISITOR)
//   DELETE /ant-farm/api/pins/:antId     remove
// A pinned ant that later dies stays in the list but renders as deceased (links
// to its lineage). Aggregate pin counts feed the KV leaderboard.
