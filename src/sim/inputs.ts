// The ONLY channel by which the outside world mutates the sim.
//
//   applyInputs(state, queued: VisitorInput[]) : void
//
// Accepts exactly two kinds:
//   { kind: "food",  pos, amount }   -> add/grow a food pile on a SURFACE tile
//   { kind: "water", pos, amount }   -> add/grow a water pool; tracked level decays via evaporation
//
// Rejects anything out of bounds or off-surface. Amounts are already clamped by
// src/worker/inputs.ts before they get here; this is the second guard.
// Pins are NOT handled here — they are pure client/D1 state and never touch the sim.
