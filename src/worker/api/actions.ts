// POST /ant-farm/api/actions/food   { pos, amount }
// POST /ant-farm/api/actions/water  { pos, amount }
// Thin pass-through: forward to ColonyDO.fetch() with the visitor id; return the
// DO's ActionAck. All validation/rate-limiting happens in the DO (worker/inputs.ts)
// so there is exactly one enforcement point.
