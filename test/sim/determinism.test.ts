// Same seed + same queued inputs => byte-identical state after N ticks.
// Also: run 100 ticks in one call vs 100 single-tick calls => identical.
// This is the guarantee that makes Durable Object hibernation-replay safe.
