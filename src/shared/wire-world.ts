// Encoding for the parts of the colony that aren't per-ant rows: pheromone
// layers and the nest layout. Server side (worker/colony-do.ts) encodes,
// client side (web/net/remote-state.ts) decodes; keeping both halves in one
// file is what stops them drifting apart.
import type { ColonyState } from "../sim/state";
import type { NestDTO, PheromonesDTO, SparseFieldDTO } from "./protocol";

// ---- sparse float fields (pheromones) ----

export function encodeSparse(cells: Float32Array): SparseFieldDTO {
    const i: number[] = [];
    const v: number[] = [];
    for (let index = 0; index < cells.length; index++) {
        const value = cells[index];
        if (value === 0) continue;
        i.push(index);
        // 9 significant digits round-trips any float32 exactly, so the client's
        // Float32Array ends up bit-identical to the server's.
        v.push(Number(value.toPrecision(9)));
    }
    return { i, v };
}

export function decodeSparse(field: SparseFieldDTO, size: number): Float32Array {
    const cells = new Float32Array(size);
    for (let k = 0; k < field.i.length; k++) {
        if (field.i[k] >= 0 && field.i[k] < size) cells[field.i[k]] = field.v[k];
    }
    return cells;
}

export function encodePheromones(state: ColonyState): PheromonesDTO {
    return {
        trail: encodeSparse(state.surface.trail.cells),
        alarm: encodeSparse(state.surface.alarm.cells),
    };
}

// ---- nest layout ----

// One character per cell. TILE values are 0..7 (world/grid.ts), so a digit is
// enough and the whole 80x60 grid is a 4,800-character string.
export function encodeNest(state: ColonyState): NestDTO {
    let tiles = "";
    for (const tile of state.grid.tiles) tiles += tile;
    return { tiles, chambers: state.nest.chambers };
}

export function decodeNestTiles(tiles: string): Uint8Array {
    const out = new Uint8Array(tiles.length);
    for (let index = 0; index < tiles.length; index++) out[index] = tiles.charCodeAt(index) - 48;
    return out;
}
