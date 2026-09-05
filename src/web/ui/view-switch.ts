// Lays out the two views and lets the visitor move between them. Introduced in
// Phase 3b (see docs/roadmap.md).
//
// The sim now has two coordinate spaces (docs/simulation-model.md):
//   - the NEST     — a vertical cross-section, rendered by render/nest-view.ts
//                    as an "ant farm between glass"
//   - the SURFACE  — top-down, rendered by render/surface-view.ts (foraging
//                    ground, spawned food piles, graveyard)
//
// Default layout: both visible at once (side-by-side on wide screens, stacked on
// tall ones) so a visitor can watch a forager leave the nest through the exit
// hole and reappear on the surface. On narrow screens fall back to one-at-a-time
// with a toggle.
//
// Responsibilities:
//   - own the two <canvas> elements and their sizes; hand them to render/engine.ts
//   - track which view(s) are shown (persist the choice in localStorage)
//   - render the toggle control when in single-view mode
//
// config.ts holds the default (e.g. VIEW_LAYOUT = "split" | "nest" | "surface").
