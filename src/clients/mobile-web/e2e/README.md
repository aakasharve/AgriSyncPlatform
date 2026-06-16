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
# 1. Start the backend with the E2E flags. The /__e2e/reset + /__e2e/seed
#    endpoints delegate to TestFixtureService, gated on the TestFixtures flags.
ALLOW_E2E_SEED=true TestFixtures__AllowRuntimeReset=true TestFixtures__AllowRuntimeSeed=true \
  dotnet run --project src/AgriSync.Bootstrapper --urls http://localhost:5000

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

## Persona-tag convention (ADR 0018)

When `_COFOUNDER` ADR 0018 went into effect (2026-05-08), high-trust specs (`trust_tier: high`) gained a persona-coverage requirement: every persona declared in the spec's `personas_covered` field must be exercised by at least one Playwright spec.

Tag every relevant `test()` or `test.describe()` block with the persona it walks through. Allowed values mirror the spec template:

- `@persona:Farmer`   — low-literacy primary user (Purvesh Arve — 8888888888 / Testuser@123)
- `@persona:Mukadam`  — labour overseer / supervisor profile
- `@persona:Worker`   — voice-only worker profile
- `@persona:Owner`    — review / approval profile

### How to tag

Append the tag(s) directly to the test title — Playwright matches them via `--grep`:

```ts
test('Farmer records offline wage advance and syncs next day  @persona:Farmer', async ({ page }) => {
  // walkthrough mirrors the spec's `walkthrough` section
});

test.describe('Mukadam reviews pending advances  @persona:Mukadam', () => {
  // ...
});
```

A test may carry more than one persona tag if the same flow is observed by multiple roles in a single walkthrough.

### How to run by persona

```bash
# Just the Farmer walkthroughs:
npx playwright test --grep '@persona:Farmer'

# Anything tagged with any persona (smoke for high-trust coverage):
npx playwright test --grep '@persona:'
```

### Coverage rule (informative; CI enforcement is a follow-up)

For any spec with `trust_tier: high` and `personas_covered: [A, B]`, the e2e suite should contain at least one passing test tagged with each of `@persona:A` and `@persona:B`. CI enforcement on this rule is intentionally deferred until the first one or two real high-trust specs flow through the new template, so the rule can be tuned against actual walkthroughs rather than hypothetical ones. Until then, missing persona coverage is a verifier-flagged review note, not a CI blocker.
