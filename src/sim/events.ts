// Domain event types emitted by step(). Plain data, no behavior.
//
//   Birth            {antId, name, lineageId, parents, simTime}
//   Death            {antId, name, cause, ageTicks, simTime}
//   LineageExtinct   {lineageId, surname, foundedAt, endedAt}
//   QueenDied        {antId, simTime}   -> colony is now in decline unless a new queen matures
//   CorpseInterred   {corpseId, antId, simTime}   -> an undertaker got a body to the graveyard
//   ForageSuccess    {antId, amount, resourcePos}
//   PredatorStrike   {antIds, simTime}
//   WeatherChanged   {from, to, simTime}
//   NuptialFlight    {newQueenIds, droneIds, simTime}
//
// The Worker fans these out: to WebSocket clients (as part of Diff) and to D1 via
// src/worker/lineage-sink.ts for the family trees, names, and memorial.
