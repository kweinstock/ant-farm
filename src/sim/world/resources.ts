// Food store: a single amount/capacity pair for the nest chamber's stock.
// PHASE 3b: regenFoodStore/FOOD_STORE_REGEN — 3a's passive-trickle
// placeholder — are gone entirely, not tuned to zero and left as dead code.
// Foragers physically hauling surface food home via jobs.ts's depositFood
// case (which calls depositToStore below) are now the only inflow. Surface
// pile mechanics (spawn/decay/takeFromPile) live in world/surface.ts — this
// file is just the nest store's two operations, eat and deposit.
import { EAT_AMOUNT } from "../params";

export type FoodStore = { amount: number; capacity: number };

export function eatFromStore(store: FoodStore): { store: FoodStore; consumed: number } {
    const consumed = Math.min(EAT_AMOUNT, store.amount);

    return {
        store: { ...store, amount: store.amount - consumed },
        consumed,
    };
}

// Clamped to capacity, same as eatFromStore clamps to what's actually
// there — a forager depositing more than the store can hold doesn't
// overflow it, the excess is just lost. jobs.ts's depositFood case doesn't
// check the return value for "how much actually landed" (unlike
// takeFromPile's {surface, taken} shape) and always zeroes ant.carryingFood
// unconditionally after calling this — so a forager arriving at an already-
// full store loses whatever it was carrying with no feedback. Worth
// watching during the economy probe: if the store is chronically near
// capacity, that's silent waste that'd look like foragers "not helping"
// without this being the reason.
export function depositToStore(store: FoodStore, amount: number): FoodStore {
    return {
        ...store,
        amount: Math.min(store.amount + amount, store.capacity),
    };
}