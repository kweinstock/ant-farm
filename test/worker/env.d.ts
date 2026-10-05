// Standard @cloudflare/vitest-pool-workers augmentation: `cloudflare:test`'s
// `env` is typed against `ProvidedEnv`, which is empty by default — this
// extends it with the real bindings from worker-configuration.d.ts's global
// `Env` (wrangler-generated, do not hand-edit that file instead).
declare module "cloudflare:test" {
    interface ProvidedEnv extends Env {}
}
