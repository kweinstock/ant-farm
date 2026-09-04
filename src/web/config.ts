// Client config: API base ("/ant-farm/api"), WS URL, reconnect backoff schedule,
// target FPS, interpolation window, max ants drawn before switching to a
// density/heatmap fallback.
// "local": main.ts calls step() itself on a setInterval — no server involved.
// "stream": Phase 6 — state instead arrives as Snapshot/Diff over net/socket.ts.
// `as const` (not just `string`) so main.ts's `if (SOURCE === "local")` narrows
// properly and TypeScript can tell the unimplemented "stream" branch apart.
export const SOURCE = "local" as const;

// Pixels per grid cell. Both render/grid.ts and render/ants.ts convert a
// state (x, y) into canvas pixels by multiplying by this — keep it the one
// shared source instead of hard-coding 40 in more than one place.
export const CELL_SIZE = 40;

// How often (ms) local mode calls step() — deliberately NOT tied to
// requestAnimationFrame's ~60fps. rAF drives drawing only (render/engine.ts);
// this drives the simulation clock. Mirrors the split main.ts is following:
// sim tick rate and render frame rate are two different clocks, same as
// TICK_MS vs the DO's alarm cadence will be in Phase 6+.
export const TICK_INTERVALS_MS = 100;