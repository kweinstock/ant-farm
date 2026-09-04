// Tiny path router for /ant-farm/api/*. Method+path -> handler in api/*.
// JSON helpers (ok/created/badRequest/tooManyRequests), CORS headers, and
// extraction of the X-Visitor-Id header used for pins + rate limiting.
// No framework — this is a handful of string matches.
