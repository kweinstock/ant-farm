import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Lives inside test/worker/ (not the project root) so this file's own
// import of "@cloudflare/vitest-pool-workers" resolves from
// test/worker/node_modules — that's the only place the package is
// installed, since it needs a vitest version (^3) incompatible with the
// root project's (^5), so npm workspaces can't hoist it. See
// test/worker/package.json's own vitest devDependency.
export default defineWorkersConfig({
    test: {
        include: ["**/*.test.ts"],
        poolOptions: {
            workers: {
                wrangler: { configPath: "../../wrangler.jsonc" },
            },
        },
    },
});
