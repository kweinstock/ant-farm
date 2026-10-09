// PHASE 16: a visitor's pinned ants. Pure client state — a list of ant ids in
// localStorage ("antfarm.pins"); nothing here reaches the sim or the server.
//
// Ants die, so a pin follows its ant's heir (state.heirs, see succession.ts):
// every update, each pinned id is resolved to the living ant that now carries
// its name. A pinned ant that is dead with no heir yet is kept for a grace
// period (the heir appears at the next hatch), then dropped; and on the very
// first look at the colony (page load) it is dropped straight away, because an
// heir that was going to exist already does — if it isn't in the map, the chain
// was lost. Dropped quietly, no error.
import type { ColonyState } from "../../sim/state";
import type { AntId } from "../../sim/ants/ant";
import { resolveAnt } from "./succession";

export const PINS_KEY = "antfarm.pins";
export const MAX_PINS = 30;
// Sim ticks a dead pinned ant may wait for its heir (~15 minutes of real time).
export const PIN_GRACE_TICKS = 4500;

export type PinSet = {
    ids: AntId[];
    // deadId -> sim tick at which we first saw it dead with no heir. In memory only.
    pendingSince: Record<AntId, number>;
};

// What localStorage hands back is untrusted: keep only short non-empty strings,
// once each, up to MAX_PINS.
export function parsePins(raw: string | null | undefined): AntId[] {
    if (!raw) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    const out: AntId[] = [];
    for (const item of parsed) {
        if (typeof item === "string" && item.length > 0 && item.length <= 64 && !out.includes(item)) {
            out.push(item);
            if (out.length >= MAX_PINS) {
                break;
            }
        }
    }
    return out;
}

// Move every pin to the living ant that now holds its name, drop the ones whose
// line was lost. `changed` is true when the list of ids is different afterwards.
export function updatePins(
    state: ColonyState,
    pins: PinSet,
    firstLook: boolean,
): { pins: PinSet; changed: boolean } {
    const ids: AntId[] = [];
    const pendingSince: Record<AntId, number> = {};

    for (const id of pins.ids) {
        const resolved = resolveAnt(state, id);
        if (resolved.ant) {
            if (!ids.includes(resolved.id)) {
                ids.push(resolved.id);
            }
            continue;
        }
        // Dead, no heir (yet).
        if (firstLook) {
            continue;
        }
        const since = pins.pendingSince[resolved.id] ?? state.simTime;
        if (state.simTime - since > PIN_GRACE_TICKS) {
            continue;
        }
        pendingSince[resolved.id] = since;
        if (!ids.includes(resolved.id)) {
            ids.push(resolved.id);
        }
    }

    const changed = ids.length !== pins.ids.length || ids.some((id, i) => id !== pins.ids[i]);
    return { pins: { ids, pendingSince }, changed };
}

export type PinStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

function browserStorage(): PinStorage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        // Access itself can throw (private browsing, blocked storage).
        return undefined;
    }
}

export type PinStore = {
    ids: () => readonly AntId[];
    has: (id: AntId) => boolean;
    // Pin if not pinned (up to MAX_PINS), unpin if pinned. Returns whether it is pinned afterwards.
    toggle: (id: AntId) => boolean;
    remove: (id: AntId) => void;
    // Call with each new colony state. Returns true if the pinned ids changed.
    update: (state: ColonyState) => boolean;
    subscribe: (listener: () => void) => void;
};

export function createPinStore(storage: PinStorage | undefined = browserStorage()): PinStore {
    function read(): string | null {
        try {
            return storage?.getItem(PINS_KEY) ?? null;
        } catch {
            return null;
        }
    }

    let set: PinSet = { ids: parsePins(read()), pendingSince: {} };
    let firstLook = true;
    const listeners: (() => void)[] = [];

    function commit(next: PinSet): void {
        set = next;
        try {
            storage?.setItem(PINS_KEY, JSON.stringify(set.ids));
        } catch {
            // Losing a persisted pin list isn't worth surfacing.
        }
        for (const listener of listeners) {
            listener();
        }
    }

    return {
        ids: () => set.ids,
        has: (id) => set.ids.includes(id),
        toggle: (id) => {
            if (set.ids.includes(id)) {
                commit({ ids: set.ids.filter((pinned) => pinned !== id), pendingSince: set.pendingSince });
                return false;
            }
            if (set.ids.length >= MAX_PINS) {
                return false;
            }
            commit({ ids: [...set.ids, id], pendingSince: set.pendingSince });
            return true;
        },
        remove: (id) => {
            if (set.ids.includes(id)) {
                commit({ ids: set.ids.filter((pinned) => pinned !== id), pendingSince: set.pendingSince });
            }
        },
        update: (state) => {
            const result = updatePins(state, set, firstLook);
            firstLook = false;
            if (result.changed) {
                commit(result.pins);
                return true;
            }
            set = result.pins;
            return false;
        },
        subscribe: (listener) => {
            listeners.push(listener);
        },
    };
}
