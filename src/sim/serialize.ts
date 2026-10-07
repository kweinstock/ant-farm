// ColonyState <-> Durable Object storage. The output is a plain
// structured-clone-able object, not bytes: DO storage clones Map / Uint8Array
// / Float32Array natively, so nothing here needs manual packing. The only
// thing dropped is fully derived state (nest distance fields + tile lookup),
// which decodeState rebuilds, so saves stay small and can't go stale.
//
// Bump SCHEMA_VERSION whenever ColonyState (or anything inside it) changes
// shape. decodeState rejects a mismatch; the worker then starts a fresh colony
// instead of loading something the sim no longer understands.
//
// Used by src/worker/persistence.ts. Snapshots for the client use protocol.ts
// shapes instead — do not confuse the two.
import type { ColonyState } from "./state";
import type { Chamber } from "./world/nest";
import { nestFromChambers } from "./world/nest";

export const SCHEMA_VERSION = 1;

export type EncodedState = Omit<ColonyState, "nest"> & {nest: {chambers: Chamber[]}};

export function encodeState(state: ColonyState): EncodedState {
    const {nest, ...rest} = state;
    return {...rest, nest: {chambers: nest.chambers}};
}

export function decodeState(encoded: EncodedState, schemaVersion: number): ColonyState {
    if (schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`saved colony has schema v${schemaVersion}, this build expects v${SCHEMA_VERSION}`);
    }
    const {nest, ...rest} = encoded;
    return {...rest, nest: nestFromChambers(rest.grid, nest.chambers)};
}