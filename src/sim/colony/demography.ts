// Maintains cached population counts by caste, job, age band, and life stage, so
// the HUD and balance logic never scan every ant. Recomputed incrementally on
// birth/death/reassignment. Feeds Stats DTO (shared/protocol.ts).
