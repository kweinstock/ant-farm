// Server-side gate for visitor actions BEFORE they reach the sim:
//   - accept only { kind: "food" | "water", pos, amount }
//   - validate pos is on a SURFACE tile and in bounds
//   - clamp amount to per-action max
//   - per-visitor daily allowance (X-Visitor-Id) + a global rate limit so a
//     traffic spike can't wreck the colony or the request budget
//   - enqueue for the NEXT tick (never mutate mid-tick)
// Rejections come back as ActionAck{accepted:false, reason}. Pins are handled in
// api/pins.ts and never come here.
