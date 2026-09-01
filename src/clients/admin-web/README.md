# AgriSync Admin console (`admin-web`)

The internal operations console for AgriSync / ShramSafal. It is **not** the farmer app —
that is `src/clients/mobile-web`. This one is for the people running the platform: farm
health, silent churn, API errors, the voice pipeline, the North Star metric, users and
admin settings. Thirteen screens, sixteen routes.

React 19 + TypeScript + Vite 8, React Router 7, TanStack Query 5, Tailwind v4 (token layer
in `src/styles/globals.css`), Vitest + Testing Library.

It talks to one backend — the .NET API in `src/AgriSync.Bootstrapper` — under two path
prefixes, `/shramsafal/admin/...` and `/user/...`. It has no database, no server and no
build-time data. Everything on every screen came over the wire, or is honestly labelled as
absent.

---

## Run it

```bash
cd src/clients/admin-web
npm install
npm run dev          # http://localhost:4001
```

**Port 4001 is pinned with `strictPort: true`** (`vite.config.ts`). That is deliberate, not
a default: local CORS allow-lists, tooling and the founder's bookmarks all assume it. If
4001 is taken, Vite fails loudly instead of quietly moving to 4002 and leaving you with a
console the API will not talk to. Free the port; do not change the number.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on 4001 |
| `npm run build` | `tsc -b` **then** `vite build` — the type-check is half the build |
| `npm run test` | Vitest, run once (`npm run test:watch` to watch) |
| `npm run lint` | ESLint over the whole package |
| `npm run preview` | Serve the built `dist/` locally |

### Environment — a fresh worktree has none

`.gitignore` excludes `.env` and `.env.*`, so **a clean checkout has no env files at all**
and `VITE_API_BASE_URL` will be undefined. Create `.env.local` yourself:

```
VITE_API_BASE_URL=http://localhost:5048
```

and, for a production build of the admin site, `.env.production`:

```
VITE_API_BASE_URL=https://api.shramsafal.in
```

`src/lib/api.ts` falls back to `http://localhost:5048` when the variable is missing, and
says so loudly — `console.warn` in dev, `console.error` in a production bundle. That
fallback is a dev convenience and is **wrong in a deployed bundle**: a production build with
no `.env.production` ships a console that asks a laptop for its data. Every request then
fails, every screen shows its denied-or-empty state, and the whole thing reads as *"my
admin account lost its permissions"* — a configuration mistake wearing a security bug's
clothes. If the console loads but every panel reports a failed request, check this first,
and check the browser console for that message.

There is deliberately **no build-time refusal** yet. `vite.config.ts` could fail the build
on a missing `VITE_API_BASE_URL`, the way mobile-web does — but `.env.production` is
gitignored, so CI has no copy, and adding the refusal without a matching workflow change
would break the build on the first push. See the open item at the end of this file.

---

## The thing that will waste your afternoon: you have no admin membership locally

**Symptom.** You sign in successfully — the API returns 200 and a token — and then every
route you open lands on `/403`, saying your account has no admin membership for this
console. It looks like the routing broke, or a guard is too strict.

**It is neither. That is the fail-closed rule working exactly as designed, and it must not
be "fixed" by loosening a guard.**

What actually happens, measured and reproducible with curl:

```
POST /user/auth/login  {8888888888 / Testuser@123}  -> 200, token issued
GET  /shramsafal/admin/me/scope                     -> {"outcome":"Unauthorized",
                                                        "scope":null,"memberships":[]}
```

The only seeded local user is **a farmer**. `PurveshDemoSeeder` creates no admin
membership, and the `ssf.admin_users` table has never been read because its migration has
not been run. So there is no local path to an admin scope at all.

`useAdminScope` returns `canRead` / `canWrite` / `canExport` as **false** whenever the
scope is unresolved — never "unknown, so allow" — and `RequireScope` sends an
`Unauthorized` outcome to `/403`. Given that scope, `/403` is the correct answer. An
operations console that guessed permissive on an unanswered question is the defect; this is
the absence of it.

**To walk the routes locally you need an admin membership in the local database.** Seeding
one for the existing test user is the smallest change — seed data only, no schema and no
guard. That work is not in this package; it is backend plus seed data.

Two related things that look like bugs and are not:

- **`/403` is reachable without a scope on purpose.** It is the only route deliberately
  outside `RequireScope`. Put it inside and an unresolved scope redirects to a page that
  redirects.
- **`/settings/admins` says the allow-list has one entry and that `ssf.admin_users` has
  never been read.** That is the true state of the system, printed rather than hidden
  behind a plausible-looking table.

---

## How to read this codebase

```
src/
  app/          providers, shell, nav, command palette   — the frame
  components/
    data/       DataList, ChartShell                     — one list, one chart shell
    state/      the honest-state vocabulary              — read this first
    ui/         Button, Card, KpiCard, FreshnessChip
  features/     farmer-health (landing + drilldown)
  hooks/        one hook per endpoint
  lib/          api client, auth, formatting, module keys
  pages/        one file per route
  styles/       globals.css — the ONE token layer
```

**Read `src/components/state/index.ts` before writing a screen.** The single rule this
console is built around is that an absence must say which absence it is:

| The situation | The component |
|---|---|
| The request broke | `LoadFailed` |
| The feed stopped | `FeedDown` (names *when*) |
| The filter excluded everything | `NoMatch` |
| We looked, over a named window, and there is none | `MeasuredZero` |
| There is no data source at all | `NotMeasuredPanel` |
| One value is absent, in a cell | `NotMeasured` — the only component allowed to print a missing value |
| One value is hidden by permission | `Masked` |
| It is still loading | `LoadingState` (name the block) |

A 500, a timeout and a 403 are never drawn as good news. Seven screens used to say *"No
errors found. The system is healthy."* over a failed request. `honestStates.test.tsx` is
what stops that coming back.

Two more rules that are easy to break by accident:

- **No raw hex anywhere outside `globals.css`.** If a screen needs a colour that is not a
  token, either the colour is wrong or the token is missing.
  `styles/__tests__/tokens.contract.test.ts` fails on a literal.
- **Fonts are a charter rule, not a preference.** DM Sans for English, brand and numbers;
  Noto Sans Devanagari for Marathi body text. Never `system-ui`, never `Arial`, never a
  bare generic fallback. Farm and farmer names are very often Devanagari — render them
  through `PersonName`, which is the one place that check lives.

---

## Routing, and the 404

Sixteen routes. `/login` and `/403` sit outside the auth and scope gates; everything else,
**including the catch-all**, sits inside them.

An unknown path renders a real 404 (`pages/NotFoundPage.tsx`) that names the address it did
not match and redirects nowhere. It used to be `<Navigate to="/" replace />`, which sent
every typo, every stale bookmark and every genuine broken link to Home with the address bar
rewritten and nothing said. Those three are indistinguishable under a silent bounce, and
that is not hypothetical — it is how a dead row-click on `/farms/:farmId`, a route this
console has never registered, survived under a `cursor-pointer` table for its whole life.

---

## Testing

```bash
npm run test
```

Worth knowing before you debug a red run:

- **`vitest.config.ts` is separate from `vite.config.ts` on purpose** and sets
  `testTimeout: 20_000`. That is a measurement, not a tolerance: several files mount the
  whole console — router, guards, lazy routes, axios interceptors — and compete for cores
  with every other file. Every failure at the old 5 s default was the *test* timeout
  expiring, never an assertion.
- **Every waiter in a whole-console file passes an explicit timeout** (`WAIT` /
  `SETTLE_WAIT` / `WHOLE_CONSOLE_WAIT`, 15 s). A waiter allowed exactly as long as its
  test can never be the thing that reports the failure — the test dies first and tells you
  the wrong story.
- **The `@` alias is declared in three places** — `vite.config.ts` (bundling),
  `tsconfig.app.json` (type resolution) and `vitest.config.ts` (test resolution). All
  three must agree. Change one and you get a suite that resolves imports differently from
  the app it is meant to be evidence for.
- **`eslint.config.js` demotes rules to warn and `npm run lint` allows 9999 warnings.**
  That is deliberate, so admin-web participates in the CI gate without a shell `|| true`
  hiding it. Errors still fail. Do not inherit stricter defaults without driving the
  warning count down first.

---

## Open items (not defects — decisions and follow-ups)

- **No build-time guard on `VITE_API_BASE_URL`** — see the env section above. Needs a
  workflow change alongside it, which is outside this package.
- **Six files still use `font-mono`, 18 times** (`globals.css` §A.1 lists them by name).
  CONTRACT.md §8 bans monospace; those six chose it during the port for values read
  character by character — the OTP field, the farmer-search field, error timestamps and
  status codes, and five `<code>` spans. A live disagreement between the contract and
  shipped screens, and a founder call rather than a sweep.
- **Four legacy `.glass*` / `.chip-*` rules survive in `globals.css` §B** with named
  consumers: `ForbiddenPage` and `FreshnessChip`. Neither belonged to a screen task, so
  neither was ported. Restyling them is a visual change.
