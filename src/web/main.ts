// Browser entry for the Ant Farm view. Mounted from /index.html (which currently
// loads /src/main.ts — see note below).
//
// Boot sequence:
//   1. visitor-id.ts  -> get/create anonymous UUID in localStorage
//   2. store.ts       -> create empty client state
//   3. socket.ts      -> connect wss /ant-farm/api/stream; feed Snapshot/Diff into store
//   4. api.ts         -> initial GETs: pins, stats
//   5. render/engine.ts -> start the requestAnimationFrame loop
//   6. ui/*           -> mount toolbar, ant list, HUD, pinned tray
//
// NOTE: repo entry is /src/main.ts. Either point index.html at
// /src/web/main.ts, or keep /src/main.ts as a one-line re-export of this file.
