# DFES Farmer-Facing Deploy Readiness — Run Completion Report

**Date:** 2026-08-15 · **Branch:** `feat/dfes-companion` · **Base:** `a11f00cc` → **Head:** `977a95e4`
**Plan:** `2026-08-14-dfes-farmer-facing-deploy-readiness.md` · **Handoff:** `2026-08-14-SESSION-HANDOFF-dfes.md`

**Status: code complete, reviewed, and sound to merge — pending the founder-owned gates below.**
Not merged. Not pushed. Not deployed. Commits unsigned by design (CLAUDE.md, 2026-08-08).

---

## 1. What a farmer gets that he did not have before

| Before | After |
|---|---|
| He types his whole day by hand and Sathi says **०/१०** | The day persists what he typed and **scores** (proven: 6/10 on a real database) |
| He answers Sathi's question and nothing happens | The answer **raises the score**, credited at the same weight as logging the fact directly, never double-counted |
| The number on screen does not move until something else refreshes it | The score **refetches** as soon as the server accepts the answer — and never moves on a failed write |
| The first sync after saving **destroys** device-only fields on his own phone | The pull **preserves** them; Sathi's familiarity counter stops counting backwards |
| A deleted log **resurrects** on the next pull | The deletion survives |
| An honest "no work today" comes back as a work day with nothing in it | It is preserved, and shows **consistency instead of a score** (founder ruling 2) |
| Questions speak generically | The engine can now **speak** the weather and previous log it already used to choose the question (mechanism only — copy awaits agronomist review) |

---

## 2. Verification — what was actually run

**Both gates were re-run by the controller directly, not taken on trust.**

| Suite | Result |
|---|---|
| Frontend (`npx vitest run`) | **exit 0 — 996/996 tests, zero timeouts, zero assertion failures** |
| Backend (`dotnet test src/AgriSync.sln`) | exit 1 — **1706 passed / 49 failed / 1 skipped** |

**Every one of the 49 backend failures is proven not ours:**
- 47 fail on Docker/Testcontainers unavailability (Docker is absent on this machine by project convention).
- 2 are in `AiEndpointsTests.cs`, which `git diff` proves is **byte-identical to `origin/main`** — untouched by this run.
- The run's own real-Postgres tests **passed**: `SyncPushManualDraftRealPostgresTests` (a manual day persists) and `AnswerRaisesScoreTests` (answering raises the score, 2 → 5).

**Review depth:** nine task-level reviews, six fix rounds, plus two multi-agent adversarial reviews
(48 agents total). Across both adversarial passes, **35 candidate defects were raised and 34 were
refuted** — they described real code but attributed pre-existing behaviour to this run. The one that
survived was fixed (§4).

**NOT verified:** nothing has been run on a real device end to end. No farmer's handset, no browser,
no deployed server. The score fixes are proven by tests against a real PostgreSQL database with real
row-level security — strong evidence the server is correct — but no phone has walked the path from
typing a day to seeing the number move. **That is what the Founder Acceptance Gate is for**, and it
should include one run on a real device with the data connection throttled.

---

## 3. Deploy order — mandatory, and unforgiving in one direction

1. **Backend API first** (`api.shramsafal.in`), confirmed live at the new SHA via `/version`.
2. **Then the mobile-web bundle** (S3 sync + CloudFront invalidation).
3. **APK last**, via the `android-release` workflow.

**Why the order matters:** this branch adds one new field to what the phone sends the server. A new
server serves every old phone unchanged (the field is optional at every layer). But an **old server
rejects a new phone's day outright**. Shipping web before the API means a window where every manual
day bounces — visibly, as a red badge, recoverable with Retry once the API is up, but an hour of
farmers seeing failures for no reason.

**No database migration. No new config key, no new dependency, no new registration.** The backend
deploy is a straight binary swap. (Verified: no migration, entity, or DbContext file is touched, and
both columns the new code reads already exist.)

**Two flag conditions the founder must know:**
- **The APK does not read `.env.production`.** `android-release.yml` sets only two environment
  variables. Turning the companion on for APK users requires adding the chosen flags to that
  workflow's `env:` block. A web-only flag flip never reaches APK users.
- The 2026-07-19 decision to **pause the rich-day counter** is implemented as an opt-in flag that
  defaults to *unpaused*. Turning `VITE_UNDERSTANDING_METER=1` on without
  `VITE_UNLOCK_COUNTER_PAUSED=1` brings back the counter that was deliberately paused.

**Before flipping the meter on:** re-check the `/engagement` call volume on the no-work card (it
fires a second uncached fetch that folds the farm's whole history), and test the score card on a real
handset with data throttled — a failed *read* blanks the number rather than holding the last one.

---

## 4. The one real defect found by the final review — and fixed

**The app could permanently record an AI-guessed number as a number the farmer typed by hand.**

A farmer speaks a spray log; the AI fills in "250 ml" and "3 workers at ₹350". Later he opens that
log to edit it, or simply adds one more thing to the same day — either way the AI's numbers are
sitting in the manual-entry form. He corrects one thing and saves, and the app tells the server those
figures were hand-typed. Doctrine `P8` says provenance is forever; there is no later correction that
un-does it. The same-day case also wrote a second set of ledger rows for one real job.

This was **new in this branch** and **not behind a feature flag**, so it would have shipped the moment
the branch merged.

**Fixed** (`977a95e4`): the claim "the farmer typed this" is now made by the code that knows where the
form's data came from, not by the save button, which cannot know. A form filled from anything —
an edit, or the same day's earlier log — claims nothing and ships nothing. A blank form typed by hand
still claims manual, still ships, still scores.

**Two consequences to state plainly rather than soften:**
1. **The double-count is closed on the server only.** The farmer's own device can still show a doubled
   day in local totals. That local duplication is pre-existing and untouched by this run.
2. **A second manual entry for the same plot on the same day now ships nothing and scores nothing**,
   by design. It is the correct fail-safe — before the fix it shipped, but double-counted *and* lied —
   but it means "manual entry always scores" is not true: it holds for the first log of a day per plot.

---

## 5. What must be decided or fixed later

**Needs a founder decision:**
- **Three of Sathi's eight gap questions cannot raise the score at all** — `scope`, `purpose`,
  `continuity` have no weight in the scoring engine (`scope` was deliberately removed). Inventing
  weights would fabricate a score, so they credit nothing. Accept, extend the design, or stop asking
  those three.
- **The 16 context-rich Marathi drafts** await the agronomist, at
  `G:\VALIDATION\shram-sathi-context-rich-prompts.md`. It carries two blockers and four decisions, and
  states "nothing here ships until 1–4 are answered". The agronomist-approved wording currently in the
  app is **untouched across the entire branch** (verified).
- **Two English strings** on the no-work card were written by an implementer, not reviewed. Pass them,
  or confirm Marathi-only for the pilot.
- **`{weather}` would speak English** ("Light rain") on a Marathi-first surface. The recommendation is
  to speak the numbers instead (wind speed, rain probability) — a number needs no translation.

**Must fix later — none can silently produce a wrong number for a pilot farmer:**
- **A hand-typed "no work today" records nothing at all.** The `आज काम नाही` button just opens a blank
  manual screen; nothing in the app records a typed rain-stopped day. So founder ruling 2's
  acknowledgement is live for **voice days only**. Nothing breaks and no streak is lost, but the ruling
  is half-live.
- **Typed expenses and planned tasks never reach the server** — that money lives only on the handset.
  Pre-existing, but the pilot should run *knowing* it.
- **An edited log never reaches the server.** The server keeps the first version forever, including its
  figures. Pre-existing, but this branch is what makes the server's copy matter.
- A rejected day is labelled "failed" rather than "needs your attention" (affects `main`'s whole sync
  surface — fix there once, not here).
- A typed quantity is still invisible to the server's score; provenance detail is lost on every pull for
  four bucket types.
- An `'ai'` label can still be applied to hand-typed data via stale session state — the mirror image of
  §4, but the *less* damaging direction (data is withheld, never mislabelled as human).

---

## 6. Accepted risks, unchanged

- **Shared handsets** remain an accepted risk by founder ruling 1 (the pilot is farmers who own their
  phones). Re-opens as a blocker if FPO/FPC or family devices are ever targeted.
- The target score of **9 is an engineering guess** until the calibration sitting happens after the
  pilot starts (founder ruling 4).

---

## 7. Founder gates still open

- [ ] **Gate A** — context-rich Marathi approved by the agronomist (blocks the new copy only).
- [ ] **Gate B** — pilot roster: 10–20 named farmers who own their handsets.
- [ ] **Gate C** — merge verdict flipped `NO` → `YES` in the branch manifest.
- [ ] **Gate D** — which of the seven flags go to `1` in production.
- [ ] **Acceptance** — one run on a real device, ideally with the connection throttled.
