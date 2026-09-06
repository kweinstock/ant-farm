// Food store: a single amount/capacity pair, replacing Phase 3's scattered
// FoodPile[] entirely — no positions, no per-pile lookups, just one number
// the whole colony draws from and slowly refills.

// PHASE 3a: generous on purpose. Each ant burns ~1 energy/tick and tops up
// ~50 at a time from the store, so the colony draws roughly `population`
// food/tick. This trickle needs to comfortably exceed that for a healthy
// colony so food never becomes the 3a bottleneck (the nurse ferry is meant
// to be). 3b deletes this entirely — foragers stock the store for real then.
export const FOOD_STORE_REGEN = 50;

const EAT_AMOUNT = 50;

export type FoodStore = { amount: number; capacity: number };

export function eatFromStore(store: FoodStore): { store: FoodStore; consumed: number } {
    const consumed = Math.min(EAT_AMOUNT, store.amount);

    return {
        store: { ...store, amount: store.amount - consumed },
        consumed,
    };
}

// PHASE 3a PLACEHOLDER — a flat passive trickle standing in for a real
// economy. In 3b, foragers physically carry surface food into this chamber,
// and this function should be DELETED at that point, not tuned down to
// zero and left as dead code nobody calls anymore.
export function regenFoodStore(store: FoodStore): FoodStore {
    return {
        ...store,
        amount: Math.min(store.amount + FOOD_STORE_REGEN, store.capacity),
    };
}