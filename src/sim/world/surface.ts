// The surface: a separate top-down coordinate space (the nest is a side-on
// cross-section — see world/grid.ts / world/nest.ts). Built in Phase 3b.
//
// Contents:
//   exitPos        — the hole. An ant that reaches the EXIT tile in either space
//                    is moved to the matching tile in the other and its
//                    location.where flips (handled in src/sim/index.ts).
//   food piles     — spawn at RANDOM positions over time (rate later scaled by
//                    season/weather), decay if untouched, are carried off by
//                    foragers. Replaces Phase 3's fixed piles. (world/resources.ts
//                    owns the pile mechanics; this file owns where/when they spawn.)
//   graveyard zone — a patch just outside the hole where undertakers drop
//                    corpses (src/sim/corpses.ts). Grows into a visible pile.
//   visitor drops  — where "add food" / "add water" land (Phase 8+).
//
// Later: the exit's danger level (set by environment/hazards.ts — predator,
// weather) that foraging.ts rolls against.
//
// No behavior beyond spawn scheduling + zone queries.
