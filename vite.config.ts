import { defineConfig } from "vite";

// This project is served under a path prefix on kweinstock.dev, never at the
// root. `base` makes every built asset URL absolute under that prefix so it
// works the same on production, testing, and `vite preview`.
//
// outDir nests under dist/ant-farm/, not flat dist/, to match how Cloudflare
// Workers Assets resolves a path-scoped route: wrangler.jsonc's route
// "kweinstock.dev/ant-farm/*" makes the assets binding look up a request for
// /ant-farm/foo under <assets directory>/ant-farm/foo — it does not strip
// the route's own path prefix before checking disk (confirmed via `wrangler
// dev`'s own startup log: "kweinstock.dev/ant-farm/* (Will match assets:
// dist\ant-farm\*)"). `base` alone only bakes that prefix into the URLs
// index.html references; without the build output actually living at that
// nested path too, every asset request 404s against the real file and falls
// through to the "single-page-application" SPA fallback, which serves
// index.html (200 OK) for the .js request itself — the browser then rejects
// it as a module script for having the wrong MIME type, and nothing
// renders. wrangler.jsonc's assets.directory stays "./dist" (the parent);
// only this outDir moved.
export default defineConfig({
  base: "/ant-farm/",
  build: {
    outDir: "dist/ant-farm",
    emptyOutDir: true,
  },
});
