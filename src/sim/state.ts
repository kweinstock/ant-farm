// ColonyState — the entire world in one serializable object, plus the two
// projections the client ever sees.
//
//   ColonyState {
//     seq            monotonic tick counter
//     simTime        ticks since founding
//     rngSeed        current PRNG state (advanced in place — see rng.ts)
//     grid           flat typed arrays for tiles (see world/grid.ts)
//     nest           chamber list + roles (world/nest.ts)
//     surface        exit position, resource spawn points (world/surface.ts)
//     resources      food piles + water pools (world/resources.ts)
//     pheromones     trail/alarm/recruit layers as Float arrays (pheromones.ts)
//     ants           Map<AntId, Ant> (ants/ant.ts)
//     brood          egg/larva/pupa records (colony/brood.ts)
//     queenId        AntId | null
//     lineages       Map<LineageId, LineageMeta>
//     nextAntId      counter
//     env            { season, timeOfDay, weather, temperature, forecast }
//     stats          cached demography for cheap HUD reads (colony/demography.ts)
//   }
//
//   createInitialState(seed) -> ColonyState   founding queen + starter workers + dug nest
//   toSnapshot(state) -> Snapshot             lossy: only what the client renders (ant pos/caste/job/carry, resources, pheromone summary, env, stats)
//   diff(prev, next) -> Diff                  minimal change set between two snapshots
