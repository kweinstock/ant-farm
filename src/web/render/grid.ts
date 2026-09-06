// Phase 3a: draws every tile by its real type instead of one flat board.
// SOIL is dark (undug earth), TUNNEL/CHAMBER are light (walkable), EXIT is
// visually distinct (the surface opening), and CHAMBER tiles get an extra
// tint layer keyed by chamberAt's role so QUEEN/NURSERY/FOOD_STORAGE/COMMONS
// read as different rooms at a glance instead of one undifferentiated "dug
// out" color. WALL exists in TILE but nothing in createStarterNest emits it
// yet, so WALL's color below is unreachable in practice — kept only so this
// switch stays exhaustive if that changes.
import { tileAt, TILE, type Grid } from "../../sim/world/grid";
import { chamberAt, type ChamberRole, type Nest } from "../../sim/world/nest";
import { CELL_SIZE } from "../config";

const TILE_COLOR: Record<number, string> = {
    [TILE.SOIL]: "#3b2a1a",
    [TILE.TUNNEL]: "#c9b896",
    [TILE.CHAMBER]: "#e8d8b8",
    [TILE.WALL]: "#1a1208",
    [TILE.EXIT]: "#7fb3d5",
};

// Only chambers with a distinct visual identity get an entry here; COMMONS
// falls through to plain TILE_COLOR[TILE.CHAMBER] — it's the "nothing
// special" room, so it should look like undifferentiated dug space, not
// compete for a fourth color.
const ROLE_TINT: Partial<Record<ChamberRole, string>> = {
    QUEEN: "#c98a9e",
    NURSERY: "#f2d98c",
    FOOD_STORAGE: "#8bb36a",
};

export function renderGrid(ctx: CanvasRenderingContext2D, grid: Grid, nest: Nest): void {
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const tile = tileAt(grid, x, y);
            let color = TILE_COLOR[tile] ?? TILE_COLOR[TILE.SOIL];

            if (tile === TILE.CHAMBER) {
                const role = chamberAt(nest, {x, y});
                if (role !== undefined && ROLE_TINT[role] !== undefined) {
                    color = ROLE_TINT[role] as string;
                }
            }

            ctx.fillStyle = color;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    // Faint grid lines on top, same as before — helps read tile boundaries
    // without fighting the now-meaningful fill colors underneath.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= grid.width; x++) {
        const pixelX = x * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(pixelX, 0);
        ctx.lineTo(pixelX, grid.height * CELL_SIZE);
        ctx.stroke();
    }

    for (let y = 0; y <= grid.height; y++) {
        const pixelY = y * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(0, pixelY);
        ctx.lineTo(grid.width * CELL_SIZE, pixelY);
        ctx.stroke();
    }
}