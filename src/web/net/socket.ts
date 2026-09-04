// WebSocket client for /ant-farm/api/stream.
//   - connect, handle Hello (check PROTOCOL_VERSION), then stream of Snapshot/Diff
//   - auto-reconnect with backoff; on reconnect or detected seq gap, request a
//     full resync (server also sends periodic full Snapshots as a safety net)
//   - decode per shared/protocol.ts and dispatch into store.ts
//   - send Subscribe {viewport} when the camera moves, to trim diff volume
