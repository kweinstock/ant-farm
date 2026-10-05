// Shared enumerations — the vocabulary every layer agrees on.
//
// Re-exports the sim's own types instead of redeclaring them (a parallel
// declaration is what caused this file to drift from the real sim in the
// first place — see git history / the phase-13 planning notes). Type-only
// re-exports erase completely at build time, so this stays free of runtime
// logic and safe to import from both the browser and the Worker.

export type { Caste, Job, AntId } from "../sim/ants/ant";
export type { ChamberRole } from "../sim/world/nest";
export type { BroodStage } from "../sim/colony/brood";
export type { Season } from "../sim/environment/season";
export type { WeatherKind } from "../sim/environment/weather";
export type { TimeOfDay } from "../sim/environment/clock";

// "Space" and "Carrying" were in the original stub's doc comment but don't
// exist as named types anywhere in src/sim: location space is the inline
// literal "nest" | "surface" on Ant.location.where, and there's no
// "Carrying" enum — Ant just has carrying: BroodId[] and carryingFood:
// number. Left out rather than invented.