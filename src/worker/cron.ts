// scheduled() handler, invoked by the Cron Trigger (every minute).
//   - ping ColonyDO so its alarm survives eviction during quiet periods
//     (the DO replays missed ticks on wake, but the ping keeps drift small)
//   - nightly housekeeping: compact/prune old event_log + dead-ant rows in D1,
//     refresh the KV "most-pinned ants" leaderboard and cached living-ants page
