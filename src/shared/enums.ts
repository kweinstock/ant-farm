// Shared enumerations — the vocabulary every layer agrees on.
//
// Imported by: src/sim/* (authoritative use), src/worker/* (validation),
// src/web/* (rendering + UI labels). Keep this file free of logic and of any
// runtime dependency so it is safe to import from the browser and the Worker.
//
// Contents:
//   Caste        QUEEN | WORKER | SOLDIER | DRONE
//   Job          FORAGER | NURSE | BUILDER | SOLDIER | UNDERTAKER | NEST_WORKER | IDLE
//                (mostly age-based "temporal polyethism", but UNDERTAKER is
//                 assigned dynamically from corpse load — see src/sim/corpses.ts)
//   LifeStage    EGG | LARVA | PUPA | ADULT
//   TileType     SOIL | TUNNEL | CHAMBER | WALL | EXIT   (nest cross-section)
//   ChamberRole  QUEEN | NURSERY | FOOD_STORE | COMMONS | EXIT
//                (the graveyard / midden is a SURFACE zone, not a chamber — see world/surface.ts)
//   Space        NEST | SURFACE   (ant.location.where — the two coordinate spaces)
//   Carrying     NONE | EGG | FOOD | CORPSE
//   WeatherKind  CLEAR | RAIN | SNOW | HEAT | COLD_SNAP
//   Season       SPRING | SUMMER | FALL | WINTER
//   TimeOfDay    DAWN | DAY | DUSK | NIGHT
//   PheromoneKind TRAIL | ALARM | RECRUIT
//   EventKind    BIRTH | DEATH | LINEAGE_EXTINCT | QUEEN_DIED | FORAGE_SUCCESS
//                | PREDATOR_STRIKE | WEATHER_CHANGED | NUPTIAL_FLIGHT
