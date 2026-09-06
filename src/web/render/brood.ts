// Phase 3a: brood no longer all sits on the queen's one tile — eggs get laid
// in QUEEN, carried through tunnels, and placed in NURSERY, so entry.position
// now varies meaningfully. This groups brood by their actual tile and spirals
// each group independently within that tile, instead of one global spiral
// anchored on the queen.
//
// Entries currently being carried (carriedBy !== undefined) are skipped here
// entirely — render/ants.ts draws a small indicator on the carrying nurse
// instead. This avoids assuming a carried Brood's position field is kept
// live-synced with the ant carrying it tick-by-tick; if that assumption
// turns out to be wrong (position IS kept in sync), this filter should come
// out and carried eggs can render at their real in-transit position too.
import type { Brood } from "../../sim/colony/brood";
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE } from "../config";

const STAGE_COLOR: Record<string, string> = {
    EGG: "#fbf1d0",
    LARVA: "#f2d98c",
    PUPA: "#c99a52",
};

const DOT_RADIUS = CELL_SIZE * 0.07;

export function renderBrood(ctx: CanvasRenderingContext2D, state: ColonyState): void {
    ctx.strokeStyle = "#8a6f3a";
    ctx.lineWidth = 1;

    const groups = new Map<string, Brood[]>();
    for (const entry of state.brood) {
        if (entry.carriedBy !== undefined) {
            continue;
        }
        const key = `${entry.position.x},${entry.position.y}`;
        const group = groups.get(key);
        if (group) {
            group.push(entry);
        } else {
            groups.set(key, [entry]);
        }
    }

    for (const group of groups.values()) {
        const tileX = group[0].position.x;
        const tileY = group[0].position.y;
        const centerX = tileX * CELL_SIZE + CELL_SIZE / 2;
        const centerY = tileY * CELL_SIZE + CELL_SIZE / 2;

        group.forEach((entry, i) => {
            const angle = i * 2.399963;
            const spread = i === 0 ? 0 : DOT_RADIUS + Math.sqrt(i) * DOT_RADIUS * 1.4;
            const cx = centerX + Math.cos(angle) * spread;
            const cy = centerY + Math.sin(angle) * spread;

            ctx.fillStyle = STAGE_COLOR[entry.stage] ?? "#fbf1d0";
            ctx.beginPath();
            ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    }
}