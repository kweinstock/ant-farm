// GET /ant-farm/api/stats   HUD payload (Stats DTO): population by caste, current
// weather + forecast, season, time of day, temperature, tracked water level,
// food stores. Cheapest source is the DO's cached demography; mirrored to KV once
// a minute so the HUD load doesn't wake the DO.
