// Worker entry point. Two handlers:
//
//   fetch(request, env, ctx)
//     - CORS + static asset passthrough (env.ASSETS, the built src/web bundle)
//     - route /ant-farm/api/* via router.ts
//     - for the live stream and any state-mutating call: resolve the single
//       Durable Object  id = env.COLONY.idFromName("global-colony")  and
//       forward the request to its .fetch()
//     - for read-only browsing (ant list/detail, lineage trees, pins, stats):
//       hit D1 (env.DB) / KV (env.CACHE) directly — keeps the DO's hot path free
//
//   scheduled(event, env, ctx)   -> delegates to cron.ts
//
// Bindings expected (see wrangler.jsonc): ASSETS, COLONY (Durable Object),
// DB (D1), CACHE (KV, optional).
