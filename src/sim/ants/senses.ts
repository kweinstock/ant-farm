// Builds an ant's local perception for this tick using the spatial hash:
// nearby tiles + their type, local pheromone readings (all 3 layers, with
// gradient direction), visible resources, nearby kin/threats/corpses, current
// chamber climate. Pure read of state -> a Perception struct handed to behavior.ts.
