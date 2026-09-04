// Best-effort, batched export of sim events to D1 (env.DB) via ctx.waitUntil so
// the tick never blocks on the database:
//   Birth          -> insert ant row + lineage_edge rows
//   Death          -> update ant.died_at / death_cause
//   LineageExtinct -> update lineage.extinct_at
//   WeatherChanged / PredatorStrike / NuptialFlight -> event_log rows
// Buffers a few seconds of events and writes them in one batch to stay under the
// D1 free-tier daily write cap (see docs/cloudflare-setup.md).
