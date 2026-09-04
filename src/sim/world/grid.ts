// The 2D tile world as flat typed arrays (Uint8 tileType, plus per-tile scalars
// like humidity/temperature offsets). Flat arrays keep "thousands of ants"
// cheap and serialize compactly.
//
// Helpers: index(x,y), inBounds, tileAt, setTile, neighbors4/8, isDiggable,
// isWalkable. No behavior — dig/build logic lives in ants/jobs.ts.
