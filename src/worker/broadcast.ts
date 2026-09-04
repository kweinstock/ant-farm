// Turns tick output into per-connection network payloads:
//   - first frame after join: full Snapshot
//   - subsequent: Diff against that connection's last acked snapshot
//   - optional viewport filtering from the Subscribe hint (connections.ts)
//   - throttle to a sane render rate (coalesce multiple ticks into one frame)
//   - drop / mark slow consumers rather than buffering unbounded
// Uses ctx.getWebSockets() from the Hibernation API.
