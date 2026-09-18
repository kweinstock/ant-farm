// Smooths ant motion between server ticks: given the state before and after
// the latest tick plus how far (0..1) we are into the wall-clock gap until
// the next one, produces a render-only position + facing per ant. The sim
// still ticks discretely (one tile per step) — this never touches ColonyState
// or step(), it just lerps between two already-computed snapshots for
// render/engine.ts to draw with instead of snapping to the current tile.
//
// Snaps (no interpolation) on anything that isn't "the same ant sliding one
// tile": a fresh ant this tick (birth, or first frame after page load), a
// location.where flip (nest <-> surface, i.e. crossing the hole), or a jump
// bigger than a single tile (shouldn't happen in normal play, but a snap is
// the safe fallback over lerping across the whole map).
import type { ColonyState } from "../../sim/state";
import type { AntId } from "../../sim/ants/ant";

export type RenderAnt = {
    id: AntId;
    where: "nest" | "surface";
    x: number;
    y: number;
    headingRad: number;
};

const SNAP_DISTANCE_TILES = 1.5; // a same-tick, same-view move should never exceed 1 tile; anything past this is a teleport, not a step

export function interpolateAnts(
    prev: ColonyState | undefined,
    curr: ColonyState,
    t: number,
    prevHeadings?: ReadonlyMap<AntId, number>,
): Map<AntId, RenderAnt> {
    const clampedT = Math.max(0, Math.min(1, t));
    const result = new Map<AntId, RenderAnt>();

    for (const [id, ant] of curr.ants) {
        const prevAnt = prev?.ants.get(id);
        const currPos = ant.location.pos;
        const currWhere = ant.location.where;
        const fallbackHeading = prevHeadings?.get(id) ?? 0;

        if (!prevAnt || prevAnt.location.where !== currWhere) {
            result.set(id, { id, where: currWhere, x: currPos.x, y: currPos.y, headingRad: fallbackHeading });
            continue;
        }

        const prevPos = prevAnt.location.pos;
        const dx = currPos.x - prevPos.x;
        const dy = currPos.y - prevPos.y;

        if (Math.abs(dx) > SNAP_DISTANCE_TILES || Math.abs(dy) > SNAP_DISTANCE_TILES) {
            result.set(id, { id, where: currWhere, x: currPos.x, y: currPos.y, headingRad: fallbackHeading });
            continue;
        }

        const x = prevPos.x + dx * clampedT;
        const y = prevPos.y + dy * clampedT;
        const headingRad = dx === 0 && dy === 0 ? fallbackHeading : Math.atan2(dy, dx);

        result.set(id, { id, where: currWhere, x, y, headingRad });
    }

    return result;
}
