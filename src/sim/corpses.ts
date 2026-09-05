// Corpses + the undertaker job. Introduced in Phase 3c (see docs/roadmap.md).
//
// A dead ant (ants/lifecycle.ts) no longer just vanishes from state.ants — it
// leaves a Corpse behind at its death spot:
//
//   Corpse { id, location: { where: "nest" | "surface"; pos }, ageTicks }
//
// Corpses are SMALL: up to 2 per tile (vs 1 ant per intent, 3 eggs per nursery
// tile). They also DECAY on their own — a corpse older than CORPSE_DECAY_TICKS
// is removed even if no undertaker ever reached it, so a stalled or dying
// colony can't leak corpse entities forever.
//
// Exports:
//   advanceCorpses(state) -> { corpses, events }   age + drop decayed ones
//   assignUndertakers(state) -> AntId[] (or a per-ant job patch)
//
// Undertaker assignment — recomputed EVERY tick, it is not an age band:
//   - corpseCount === 0  -> nobody is an undertaker this tick
//   - desired = clamp(round(corpseCount * UNDERTAKER_PER_CORPSE),
//                     0, MAX_UNDERTAKER_FRACTION * workforce)
//   - proximity-weighted pick: rank available workers (idle / forager, not
//     nurse or queen) by distance to their nearest corpse; the `desired`
//     closest ones are tasked. An ant standing on/next to a body is far more
//     likely to be chosen than one across the nest.
//
// The UNDERTAKER job itself lives in ants/jobs.ts: pick up nearest corpse ->
// carry to EXIT -> onto the surface -> drop in the graveyard zone
// (world/surface.ts) -> revert to previous job. Emits CorpseInterred.
//
// Determinism: proximity ties broken by AntId order; all rolls via state.rngSeed.
