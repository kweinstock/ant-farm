// Uniform-grid spatial hash: bucket ants by tile region so senses.ts can ask
// "who/what is near me" in ~O(1) instead of scanning every ant. Rebuilt once per
// tick at the top of the ants phase. The main thing that keeps the sim linear in
// population.
