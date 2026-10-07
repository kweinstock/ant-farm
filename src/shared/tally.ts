// Lifetime counters for the whole colony: births, deaths by cause, forage trips,
// predator strikes, food delivered. The dashboard's cumulative numbers are built
// from SimEvents, and events only exist inside step() — so the Durable Object
// keeps these running totals (persisted with the colony, see worker/persistence.ts)
// and sends them with every Snapshot. A viewer who opens the page late then
// starts from the colony's real totals instead of zero, and each Diff's events
// keep them current from there.
import type { SimEvent, DeathEvent } from "../sim";

export type Tally = {
    births: number;
    deathsTotal: number;
    deathsByCause: Record<DeathEvent["cause"], number>;
    deathsByLocation: { nest: number; surface: number };
    forageDeparts: number;
    predatorStrikes: number;
    foodDelivered: number;
};

export function emptyTally(): Tally {
    return {
        births: 0,
        deathsTotal: 0,
        deathsByCause: { oldAge: 0, starvation: 0, predator: 0, cold: 0, exposure: 0 },
        deathsByLocation: { nest: 0, surface: 0 },
        forageDeparts: 0,
        predatorStrikes: 0,
        foodDelivered: 0,
    };
}

// The only event kinds anything counts or tracks. The rest (weather, predator
// appeared/left, brood lost) are left off the wire to keep each frame small.
export function statEvents(events: SimEvent[]): SimEvent[] {
    return events.filter(
        (e) => e.kind === "death" || e.kind === "birth" || e.kind === "forageDepart" || e.kind === "predatorStrike",
    );
}

// Mutates `tally` in place (one tick's worth at a time, on the hot path).
export function addTick(tally: Tally, events: SimEvent[], foodBefore: number, foodAfter: number): void {
    for (const event of events) {
        if (event.kind === "death") {
            tally.deathsTotal += 1;
            tally.deathsByCause[event.cause] += 1;
            tally.deathsByLocation[event.where] += 1;
        } else if (event.kind === "birth") {
            tally.births += 1;
        } else if (event.kind === "forageDepart") {
            tally.forageDeparts += 1;
        } else if (event.kind === "predatorStrike") {
            tally.predatorStrikes += 1;
        }
    }
    // Same rule the dashboard uses locally: any rise in the store is a delivery.
    if (foodAfter > foodBefore) tally.foodDelivered += foodAfter - foodBefore;
}

// Saves written before the tally existed have none; a partial or old-shaped
// one is treated the same way (start counting from zero) rather than trusted.
export function parseTally(value: unknown): Tally {
    const fresh = emptyTally();
    if (typeof value !== "object" || value === null) return fresh;
    const v = value as Partial<Tally>;
    if (typeof v.births !== "number" || typeof v.deathsTotal !== "number" || !v.deathsByCause || !v.deathsByLocation) return fresh;
    return { ...fresh, ...v, deathsByCause: { ...fresh.deathsByCause, ...v.deathsByCause }, deathsByLocation: { ...fresh.deathsByLocation, ...v.deathsByLocation } };
}
