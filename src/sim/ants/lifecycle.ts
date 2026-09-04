// End-of-tick resolution for adults: burn energy (movement + metabolism trait),
// starvation damage when energy hits zero, old-age death roll as ageTicks
// approaches lifespanTicks, cold-death checks in WINTER/COLD_SNAP. Produces
// Death events, frees the ant from state.ants, and hands lineage/extinction
// bookkeeping to genetics/lineage.ts. Also triggers job reassignment on age
// thresholds.
