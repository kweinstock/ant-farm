// Underground structure: a list of chambers, each with a ChamberRole
// (NURSERY / GRANARY / THRONE / MIDDEN) and a tile footprint.
//
// Provides: nearestChamber(role, pos), chamberClimate(chamber) for brood
// placement, capacity checks for food storage and waste. Builders extend/repair
// chambers via ants/jobs.ts; this file just tracks and queries them.
