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
export const SOURCE = "local" as const; // where ColonyState comes from: "local" runs step() in-browser; a future "remote" would poll a Durable Object
export const TICK_INTERVALS_MS = 200; // wall-clock ms between ticks when SOURCE is "local" (TICK_INTERVALS_MS = 100, DAY_LENGTH_TICKS=1000 ticks -> a ~100s day)

// ---- Rendering ----
export const CELL_SIZE = 14; // pixels per nest grid tile
export const SURFACE_CELL_SIZE = 11; // pixels per surface grid tile (drawn smaller than the nest — the surface grid is larger)
export const VIEW_LAYOUT: "split" | "nest" | "surface" = "split"; // default view mode on first load, before any stored preference in localStorage
