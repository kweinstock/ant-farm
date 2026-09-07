// Client config: API base ("/ant-farm/api"), WS URL, reconnect backoff schedule,
// target FPS, interpolation window, max ants drawn before switching to a
// density/heatmap fallback.
// "local": main.ts calls step() itself on a setInterval — no server involved.
// "stream": Phase 6 — state instead arrives as Snapshot/Diff over net/socket.ts.
// `as const` (not just `string`) so main.ts's `if (SOURCE === "local")` narrows
// properly and TypeScript can tell the unimplemented "stream" branch apart.
export const SOURCE = "local" as const;

// Pixels per NEST grid cell (render/nest-view.ts). The surface uses its own
// SURFACE_CELL_SIZE below. Keep each the one shared source instead of
// hard-coding the number across render modules.
export const CELL_SIZE = 40;

// How often (ms) local mode calls step() — deliberately NOT tied to
// requestAnimationFrame's ~60fps. rAF drives drawing only (render/engine.ts);
// this drives the simulation clock. Mirrors the split main.ts is following:
// sim tick rate and render frame rate are two different clocks, same as
// TICK_MS vs the DO's alarm cadence will be in Phase 6+.
export const TICK_INTERVALS_MS = 100;

// The surface (40x28) at CELL_SIZE would render nearly twice as wide as the
// nest (24x16) — a separate, smaller cell size keeps the two views a
// comparable on-screen size instead of the surface dwarfing the nest.
export const SURFACE_CELL_SIZE = 20;

// Which pane(s) ui/view-switch.ts shows a fresh visitor with no stored
// preference yet. "split" for both side-by-side/stacked; "nest"/"surface"
// to start pinned to just one. Once the visitor uses the toggle themselves,
// their choice overrides this via localStorage.
export const VIEW_LAYOUT: "split" | "nest" | "surface" = "split";