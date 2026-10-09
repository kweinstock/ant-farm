// Worker entry point.
//
//   export { ColonyDO }   required — wrangler.jsonc's durable_objects binding
//                         names this class; it has to be a named export of
//                         whatever file "main" points to, or the binding
//                         can't find it.
//
//   default.fetch(request, env, ctx)
//     - the live WebSocket stream and (later) any state-mutating call:
//       resolve the single Durable Object  id = env.COLONY.idFromName("global-colony")
//       and forward the request to its own .fetch()
//     - everything else: env.assets.fetch(request) — the built src/web bundle
//
// There is no REST API: the only endpoint is the stream. Visitors cannot change
// the colony (pins live in the browser), and there is no D1, KV or cron — the
// Durable Object's own storage and alarms are the whole backend.
export { ColonyDO } from "./colony-do";

const COLONY_NAME = "global-colony";

export default {
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/ant-farm/api/stream") {
            const id = env.COLONY.idFromName(COLONY_NAME);
            const stub = env.COLONY.get(id);
            return stub.fetch(request);
        }

        return env.assets.fetch(request);
    },
} satisfies ExportedHandler<Env>;