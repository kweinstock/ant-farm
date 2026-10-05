// ============================================================================
// config.ts — front-end constants for the web client: where the sim state
// comes from, how fast the UI ticks it, and how big things are drawn.
//
// None of these are simulation balance (see src/sim/params.ts for that) —
// changing a value here changes how the colony is driven and displayed, not
// how it behaves. Flat named exports, same reasoning as params.ts: call
// sites are unchanged even if this file's own layout changes.
// ============================================================================

// ---- Simulation source & timing ----
// "stream" (default): renders the Durable Object's colony (net/socket.ts ->
// net/remote-state.ts -> the same renderer). Needs the Worker running —
// `npm run build && npm run dev:worker` locally, or the deployed site.
// Plain `npm run dev` (vite only) has no /ant-farm/api/stream endpoint, so
// switch this to "local" to run step() in the browser while using it.
export const SOURCE: "local" | "stream" = "stream"; // where ColonyState comes from: "stream" = Durable Object over WebSocket, "local" = step() in-browser
export const TICK_INTERVALS_MS = 200; // wall-clock ms between ticks when SOURCE is "local" (TICK_INTERVALS_MS = 100, DAY_LENGTH_TICKS=1000 ticks -> a ~100s day)

// ---- Rendering ----
export const CELL_SIZE = 14; // pixels per nest grid tile
export const SURFACE_CELL_SIZE = 11; // pixels per surface grid tile (drawn smaller than the nest — the surface grid is larger)
