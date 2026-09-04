// Pre-adult pipeline: EGG -> LARVA -> PUPA -> ADULT with per-stage timers scaled
// by chamber temperature/humidity (nurses move brood between chambers to
// optimize — see ants/jobs.ts). Larvae must be fed by nurses or they die.
// On eclosion, creates an Ant (ants/ant.ts) with traits from genetics/inheritance.ts
// and a name from names/generator.ts; emits Birth.
