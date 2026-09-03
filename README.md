# Global Ant Farm

Path-based project on `kweinstock.dev`. Vite + TypeScript, deployed to Cloudflare
Workers static assets. Served at `kweinstock.dev/ant-farm/` (and
`testing.kweinstock.dev/ant-farm/` from the `testing` branch).

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
