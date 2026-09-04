// ID format helpers. No logic beyond string shaping + type-branding.
//
// AntId       monotonic within the colony ("a" + base36 counter from ColonyState)
// LineageId   "L" + founding ant id; stable for the life of a dynasty
// VisitorId   anonymous UUID minted in the browser (src/web/net/visitor-id.ts),
//             sent as a header on every mutating request; never tied to an account
//
// Exports branded-type aliases + parse/format/validate guards used by
// src/worker/* when trusting inbound values.
