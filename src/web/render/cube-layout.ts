// Shared tile-coordinate <-> cube-local-space math. The cube (render/engine.ts)
// is never rotated, only translated — its local space and world space differ
// by a fixed offset, so "local" here is close enough to "world" for anything
// that's a child of the cube mesh (trees) or reads back a world-space point
// via Object3D.worldToLocal (ant picking). Both render/props.ts (placing
// trees on the surface face) and render/engine.ts (converting a click's hit
// point back to a tile, to find the ant nearest it) need the same "tile <->
// point on the cube" math, so it lives here once instead of drifting apart
// as two independent copies.
import type { Grid } from "../../sim/world/grid";

export type CubeDims = {
    width: number;
    height: number;
    depth: number;
    // World units per tile, shared by both faces — the nest cross-section
    // grid (80x60) has fewer columns than the surface grid (100x72) it sits
    // under, so this is NOT dims.width/nestGrid.width (that stretched nest
    // tiles ~25% wider than surface tiles, so the two faces' grids didn't
    // line up as "one tile" across the seam even though they share the same
    // x axis). Always equal to dims.width/surfaceGrid.width in practice —
    // render/engine.ts is the only place that constructs a CubeDims, and it
    // sets both from the same WORLD_SCALE.
    tileWorldSize: number;
    // How many tiles' worth of solid dirt sit between the seam (the top
    // edge of the front face, where it meets the surface face) and nest row
    // 0 — the EXIT shaft used to open flush against the seam, which read as
    // the tunnel touching open air rather than a hole dug down from the
    // surface. render/engine.ts grows the box's own height by this much
    // beyond nestGrid.height * tileWorldSize to make room for it.
    nestTopMarginTiles: number;
};

export type LocalPoint = { x: number; y: number; z: number };

// Surface (top face, +y): tile (0,0) is the near-top-left corner of
// state.surface.grid, same as surface-view.ts's top-down draw. x maps to
// the box's x axis, y (row) maps to the box's z axis; local y is pinned to
// the top face itself.
export function surfaceTileToLocal(tx: number, ty: number, surfaceGrid: Grid, dims: CubeDims): LocalPoint {
    return {
        x: (tx / surfaceGrid.width - 0.5) * dims.width,
        y: dims.height / 2,
        z: (ty / surfaceGrid.height - 0.5) * dims.depth,
    };
}

export function localToSurfaceTile(point: LocalPoint, surfaceGrid: Grid, dims: CubeDims): { x: number; y: number } {
    return {
        x: (point.x / dims.width + 0.5) * surfaceGrid.width,
        y: (point.z / dims.depth + 0.5) * surfaceGrid.height,
    };
}

export function surfaceWorldPerTile(dims: CubeDims, surfaceGrid: Grid): number {
    return dims.width / surfaceGrid.width;
}

// Nest (front face, +z): tile (0,0) is the top-left of state.grid, same as
// nest-view.ts's cross-section draw — row 0 (the surface seam) at the top
// edge of the face, deeper rows further down. x maps to the box's x axis
// (same axis as the surface face, so the two faces' seam lines up); local y
// descends from the top face (row 0) toward the bottom face as the row
// number grows.
//
// Flush with the box's own front face — two earlier passes here tried
// actually recessing tunnels/chambers in 3D (first the whole plane behind
// a dirt frame, then a per-tile soil mask with a separately-recessed
// plane behind it); neither read right in practice, so the "carved into
// solid dirt" look is now a 2D shading trick instead (nest-view.ts's
// renderIndentShading — a dark inset gradient along any dug tile's edge
// that borders undug soil), not real depth. Flat is simpler and cheaper,
// and every prop module that positions something against the nest wall
// (ant-props.ts, brood-props.ts, corpse-props.ts, food-props.ts) reads
// this plane's z through nestTileToLocal rather than duplicating it.
//
// Scaled by dims.tileWorldSize (not dims.width/nestGrid.width) and centered
// on the x axis rather than stretched edge-to-edge — the nest grid (80
// tiles wide) has fewer columns than the surface grid (100 tiles wide)
// sharing this same axis, and stretching it to fill dims.width the way the
// surface face does made a nest tile visibly bigger than a surface tile
// despite sitting on the same seam. render/engine.ts pads the nest texture
// with its own soil-fleck border to match — see its nestCanvas comment.
export function nestTileToLocal(tx: number, ty: number, nestGrid: Grid, dims: CubeDims): LocalPoint {
    return {
        x: (tx - nestGrid.width / 2) * dims.tileWorldSize,
        y: dims.height / 2 - (ty + dims.nestTopMarginTiles) * dims.tileWorldSize,
        z: dims.depth / 2,
    };
}

export function localToNestTile(point: LocalPoint, nestGrid: Grid, dims: CubeDims): { x: number; y: number } {
    return {
        x: point.x / dims.tileWorldSize + nestGrid.width / 2,
        y: (dims.height / 2 - point.y) / dims.tileWorldSize - dims.nestTopMarginTiles,
    };
}

export function nestWorldPerTile(dims: CubeDims, _nestGrid: Grid): number {
    return dims.tileWorldSize;
}
