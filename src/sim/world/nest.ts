// The nest: a fixed dug-out structure inside the grid cross-section (see
// world/grid.ts — SOIL / TUNNEL / CHAMBER / WALL / EXIT). Built in Phase 3a.
//
// A chamber = a group of CHAMBER tiles tagged with a ChamberRole:
//   QUEEN       — the queen sits here and lays; eggs appear here inert
//   NURSERY     — eggs only progress once carried here (3 per tile max)
//   FOOD_STORE  — foragers deposit returned food; hungry ants come here to eat
//   COMMONS     — crossroads / "room to move around in"; ants idle + pass through
//   EXIT        — the shaft up to the surface (the seam with world/surface.ts)
//
// (The graveyard / midden is NOT a chamber — it's a surface zone outside the
// hole. See world/surface.ts.)
//
// Provides:
//   createStarterNest()            -> dug tiles + tagged chambers, one fixed layout
//   chamberAt(pos)                 -> ChamberRole | undefined
//   tilesOf(role)                  -> Position[]
//   nearestTileOf(role, pos)       -> Position
//   distanceField(role)            -> memoized BFS field over passable tiles,
//                                     consumed by ants/movement.ts for goal-directed
//                                     movement (nest is static for now, so cache
//                                     forever; invalidate here if digging is added)
//   adjacency graph (chamber <-> chamber) for higher-level routing
//
// No behavior — builders extending the nest is a later phase; this file only
// builds the starter layout and answers queries about it.
