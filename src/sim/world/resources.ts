// Food piles and water pools: position, amount, type. Rules for decay (food
// spoils), evaporation (water shrinks, faster in HEAT), and pickup by ants.
// Colony-internal food stores in the GRANARY are tracked here too and feed the
// queen's laying rate + nurse feeding.
import type { Position } from "../world/grid";

export const REGROW_RATE = 2;

export type FoodPile = {
    position: Position;
    amount: number;
    capacity: number;
}

export function findFoodAt(piles: FoodPile[], position: Position): number | undefined {
    const index = piles.findIndex((pile) => pile.position.x === position.x && pile.position.y === position.y);
    return index === -1 ? undefined : index;
}

export function eatFromPile(piles: FoodPile[], index: number, amount: number): {piles: FoodPile[]; consumed: number} {
    const pile = piles[index];
    const consumed = Math.min(amount, pile.amount);

    const updatedPiles = piles.map((p, i) => i === index ? {...p, amount: p.amount - consumed} : p);

    return {
        piles: updatedPiles,
        consumed,
    };
}

export function regrowFoodPiles(piles: FoodPile[]): FoodPile[] {
    return piles.map((pile) => ({
        ...pile,
        amount: Math.min(pile.amount + REGROW_RATE, pile.capacity),
    }));
}