// Above-ground foraging trips — the colony's main risk/reward loop.
//
// A forager leaves via the single EXIT tile, travels to a remembered or
// pheromone-indicated resource, picks up food, returns, and deposits a trail on
// the way back (positive feedback recruits nestmates).
//
// Death roll per trip is raised by: active weather (RAIN/SNOW/HEAT), predator
// presence at the exit (environment/hazards.ts), distance, night.
// Lowered by: ant.traits.riskTolerance calibration, ant.memory of safe paths,
// strong existing trail, soldier escort.
//
// Emits FORAGE_SUCCESS / PREDATOR_STRIKE / DEATH events. Successful trips
// reinforce ant.memory (ants/memory.ts) => measurable drop in deaths over
// generations (test/sim/learning.test.ts).
