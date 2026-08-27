# shramsafal-web

The farmer-facing app for AgriSync / ShramSafal — a voice-first, Marathi-first PWA that lets
smallholder farmers record farm work by speaking, and keeps working when the network doesn't.

- **Stack:** React 19 + TypeScript + Vite, Dexie (IndexedDB) for offline storage, Zod for schema validation.
- **Offline-first:** logs are written locally and reconciled through a sync outbox, so a farmer in a
  field with no signal loses nothing.
- **Also ships as the Android APK** — the APK bundles these web assets at *build* time, so a web
  deploy alone never reaches APK users.
- **Not published to npm.** `shramsafal-web` is a private workspace package; there is nothing to install.

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production bundle into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src/**` |
| `npm test` | Vitest unit suite |
| `npm run e2e` | Playwright end-to-end suite |
| `npm run deploy:dry-run` | Show what an S3 deploy would change, mutate nothing |
| `npm run deploy` | Deploy `dist/` to S3 with the codified cache policy |

Use `npm run deploy` rather than calling `scripts/deploy-s3.sh` by path. The script sets its own
cache headers and self-verifies from the CDN edge; hand-rolled `aws s3 sync` has caused a live
privacy incident before by stripping those headers.

Local dev credentials come from environment variables or `src/AgriSync.Bootstrapper/secrets/local/credentials.json`
(gitignored) — never from a tracked config file.
