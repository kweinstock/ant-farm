// Shared enumerations — the vocabulary every layer agrees on.
//
// Imported by: src/sim/* (authoritative use), src/worker/* (validation),
// src/web/* (rendering + UI labels). Keep this file free of logic and of any
// runtime dependency so it is safe to import from the browser and the Worker.
//
// Contents:
//   Caste        QUEEN | WORKER | SOLDIER | DRONE
//   Job          FORAGER | NURSE | BUILDER | SOLDIER | UNDERTAKER | NEST_WORKER | IDLE
//                (job is assigned by age via "temporal polyethism" — see src/sim/ants/jobs.ts)
//   LifeStage    EGG | LARVA | PUPA | ADULT
//   TileType     SOIL | TUNNEL | CHAMBER | SURFACE | WALL | EXIT
//   ChamberRole  NURSERY | GRANARY | THRONE | MIDDEN
//   WeatherKind  CLEAR | RAIN | SNOW | HEAT | COLD_SNAP
//   Season       SPRING | SUMMER | FALL | WINTER
//   TimeOfDay    DAWN | DAY | DUSK | NIGHT
//   PheromoneKind TRAIL | ALARM | RECRUIT
//   EventKind    BIRTH | DEATH | LINEAGE_EXTINCT | QUEEN_DIED | FORAGE_SUCCESS
//                | PREDATOR_STRIKE | WEATHER_CHANGED | NUPTIAL_FLIGHT
