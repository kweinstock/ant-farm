// The wire contract. Single source of truth for everything that crosses the
// network. Imported by src/web/net/* (decode) and src/worker/* (encode).
//
// WebSocket messages (server -> client unless noted):
//   Hello        {protocolVersion, colonyId, simTime, tickMs}      on connect
//   Snapshot     full ColonyState projection (see src/sim/state.ts toSnapshot)
//   Diff         {baseSeq, seq, changes[]}  positional/keyed deltas since last frame
//   ActionAck    {actionId, accepted, reason?}   response to a client action
//   Error        {code, message}
//   (client -> server) Subscribe {viewport?} — optional interest hint to trim diffs
//
// REST DTOs (shapes only, no transport code):
//   AntSummary   {id, name, caste, job, ageTicks, lineageId, pinned?}
//   AntDetail    AntSummary + {lifespanTicks, energy, traits, parents[], childrenCount, memoryDigest}
//   LineageNode  {antId, name, bornAt, diedAt?, children: LineageNode[]}
//   PinList      {visitorId, antIds[]}
//   Stats        {population by caste, weather, season, timeOfDay, temperature, waterLevel, foodStores}
//
// Rule: only food/water/pin actions exist here. There is deliberately NO message
// for weather/season/predators — that boundary is the whole "visitors can't touch
// everything" design point.
