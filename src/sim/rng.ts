// Seeded pseudo-random generator (mulberry32 / xoshiro128**). The seed lives in
// ColonyState and is mutated deterministically as numbers are drawn.
//
// Every stochastic decision in the sim MUST route through here: death rolls,
// weather transitions, name generation, trait mutation, wander direction.
// Nothing else in src/sim may call Math.random(). This is what makes runs
// reproducible and hibernation-replay safe.
