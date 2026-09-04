// Per-ant learning. Small bounded stores:
//   foodSites   remembered {pos, quality, lastSeen} — decays, refreshed on visit
//   pathStats   success/failure counts per route -> preference weighting
//   dangerSpots remembered predator-strike / death locations -> avoidance
//
// Reinforced on success, decays over time. Learning rate is a heritable trait
// (genetics/traits.ts). Aggregate effect: death rate per forage trip falls over
// generations (test/sim/learning.test.ts).
