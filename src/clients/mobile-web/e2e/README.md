# mobile-web E2E (Playwright)

This folder is the harness scaffold for Sub-plan 05 of the Industry-Grade Hardening master plan.

## Status — PREP_READY (no specs yet)

Sub-plan 05 specs (Tasks 3–7 — login, offline log capture, sync retry, attachment upload, admin org switch) are intentionally not yet authored in this branch. Reason: they depend on stable `data-testid` contracts that arrive with the Sub-plan 04 frontend restructure.

What is in tree right now:

| File | Purpose |
|---|---|
| `playwright.config.ts` | Chromium + WebKit + mobile-Android projects, retries=2 in CI, traces on first retry, video on failure. |
| `fixtures/seed.api.ts` | Talks to backend `/__e2e/reset` + `/__e2e/seed` (gated on `ALLOW_E2E_SEED=true`). |
| `fixtures/offlineHelper.ts` | Playwright CDP network throttle helpers (`goOffline` / `goOnline`). |
| `fixtures/otelTracePropagation.ts` | Captures `traceparent` headers for OTel propagation specs. |
| `specs/` | Empty (`.gitkeep` placeholder). Filled in Sub-plan 04 follow-up. |

## How to run (once specs land)

```bash
# 1. Start the backend with the E2E flag.
ALLOW_E2E_SEED=true dotnet run --project src/AgriSync.Bootstrapper --urls http://localhost:5000

# 2. Install browsers (first time only).
cd src/clients/mobile-web
npm run e2e:install

# 3. Run the suite.
npm run e2e
```

## Why no specs yet

Per the user's `READY_WITH_CAVEATS` note on Sub-plan 04 / `PREP_READY` on Sub-plan 05:

> Sub-plan 05 prep allowed: Playwright harness setup, test skeletons, CI wiring that does not depend on unfinished 04 pages, runbook drafts, smoke-test scaffolding.
>
> Not allowed yet: claiming 05 green, final E2E assertions against screens not yet restructured in 04.

When Sub-plan 04 lands stable selectors, Tasks 3–7 of Sub-plan 05 can be unblocked.
