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
// the colony (pins live in the browser), and there is no D1 or KV. The Durable
// Object's own storage and alarms are the backend; a cron trigger (scheduled(),
// below) only re-arms the alarm if its chain has died.
import { ColonyDO } from "./colony-do";
export { ColonyDO };

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

    // Watchdog (wrangler.jsonc triggers.crons): an alarm that fails hard enough,
    // such as a CPU-limit reset, is dropped and the colony stops until a visitor
    // arrives. This wakes the object and re-arms it.
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        // worker-configuration.d.ts types the binding without the class, so RPC needs the generic.
        const colony = env.COLONY as DurableObjectNamespace<ColonyDO>;
        await colony.get(colony.idFromName(COLONY_NAME)).ensureAlarm();
    },
} satisfies ExportedHandler<Env>;