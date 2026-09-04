// Three stigmergic layers over the grid, each a Float32 array:
//   TRAIL    laid by returning foragers, followed toward food
//   ALARM    laid near threats, triggers defensive behavior + recruitment
//   RECRUIT  short-range "come help here" for building/brood emergencies
//
// Per tick: deposit (from ant actions) -> diffuse to neighbors -> evaporate.
// Evaporation rate is a balance param; rain accelerates it (environment hooks).
// Emergent trail networks, and their collapse when a food source runs out, come
// entirely from these three simple ops.
