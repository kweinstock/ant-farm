# Global Ant Farm

Path-based project on `kweinstock.dev`. Vite + TypeScript, deployed to Cloudflare
Workers static assets. Served at `kweinstock.dev/ant-farm/` (and
`testing.kweinstock.dev/ant-farm/` from the `testing` branch).

## Design

A persistent global ant-colony simulation: one authoritative colony ticking
server-side in a Cloudflare Durable Object, thin browser clients that watch a
live stream and can drop food/water and pin favorite ants. Everything under
`src/` and `test/` is currently a **comment-only stub** — the design lives in
`docs/`:

- [`docs/roadmap.md`](docs/roadmap.md) — **start here.** Phased build order; each
  phase runs and is testable. Cloudflare doesn't enter until phase 6.
- [`docs/architecture.md`](docs/architecture.md) — folder tree, data flow, the
  Cloudflare free-tier mapping, and the language choice (all TypeScript).
- [`docs/cloudflare-setup.md`](docs/cloudflare-setup.md) — bindings, deploy, the
  request-budget math.
- [`docs/simulation-model.md`](docs/simulation-model.md) — tick order, ant rule
  engine, determinism contract.
- [`docs/data-model.md`](docs/data-model.md) — DO storage vs D1 vs KV.
- [`docs/ant-biology.md`](docs/ant-biology.md) — the real-ant facts being modeled.

## Scripts

```bash
npm install
npm run dev            # Vite dev server
npm run build          # build to dist/
npm run preview        # serve dist/ locally
npm run typecheck      # tsc, no emit
npm run lint           # eslint
npm run deploy         # build + wrangler deploy (production)
npm run deploy:testing # build + wrangler deploy --env testing
```

## Deploy

Runs through Cloudflare Workers Builds — one Worker per branch:

| Branch    | Worker           | Deploy command                      | Serves                              |
| --------- | ---------------- | ----------------------------------- | ----------------------------------- |
| `main`    | `ant-farm`         | `npx wrangler deploy`               | `kweinstock.dev/ant-farm/`            |
| `testing` | `ant-farm-testing` | `npx wrangler deploy --env testing` | `testing.kweinstock.dev/ant-farm/`   |

Build command for both: `npm run build`.

See `../landing-page/SETUP.md` for the full routing model and how to connect the
builds. Remember to add an entry to `../landing-page/public/projects.json`.
