# Launch Readiness — everything a real user touches, except the oversight loop

> **For agentic workers:** REQUIRED SUB-SKILL — `superpowers:subagent-driven-development`. Steps use
> `- [ ]` checkboxes. **Do not redesign the architecture** — it is closed (see Spec §2).

**Date:** 2026-08-15 · **Branch:** `feat/server-authoritative-architecture`

**Spec (binding authority):** `docs/superpowers/specs/2026-08-14-FOUNDER-DECISIONS-launch-cohort-and-scope.md`
Supporting evidence: `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` (defect
inventory, locked principles, corrections) and `2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md`.

**Goal.** Make everything a real user touches trustworthy enough for 50–100 growers who already
manage labour teams — **except the owner's oversight loop, which is another lane's work.**

**The bar, in the founder's words:** *"They are trust builders. By their validation our system will
work in masses, so we should make it trustworthy enough."*

**The test each task is measured against:** nothing a farmer enters silently disappears, and nothing
he is shown is a number he never said.

---

## Scope boundary — read before Task 1

**NOT IN THIS PLAN (owner-oversight lane, branch `feat/owner-oversight-loop`):** unseen-since-last-visit
tracking · the per-person per-day notification summary · the one-line description of what was done ·
splitting `can_manage_labour_records` into two grants · the Reflect→approval navigation · **and the
"approval does not stick" defect (spec D8 step 1), which that lane owns as its foundation.**

If a task here appears to require a change inside that boundary, **stop and report** rather than
crossing it. Both lanes share one repository; only one may own a file.

**IN THIS PLAN:** offline capture, money truth, machinery and activity expenses, planned tasks, the
return path's fabricated values, shared-handset isolation, voice retention and consent, harvest's
honest absence, and the labour UI's own trustworthiness.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Locked principles (spec §2 of the FINAL plan).** Server owns durable acknowledged farm truth.
  Unknown stays unknown — never reconstruct missing truth with convenient defaults (`P4`). A
  truthful missing feature beats a fake working one (`P5`). No fix may block recording today's work
  (`P9`). Corrections never silently overwrite (`P3`). Stated and derived never impersonate each
  other (`P1`).
- **Protect, do not redesign:** the log-save honesty layer · the no-multiply rule (a labour expense
  with no stated total is deliberately not sent) · auth and token storage · server tenancy and RLS ·
  crash recovery on `mutationQueue` · the structured labour round trip · verification's event-sourced
  FSM · `UploadQueueRetry`'s deliberately narrow `failed`-only scope · field-operator erasure
  semantics. **Use them as reference implementations.**
- **Never invent farmer-facing Marathi.** English placeholders only; the founder authors final copy.
  Existing Marathi strings may be reused verbatim but not newly composed.
- **Commit hooks are live.** `.husky/commit-msg` requires a lowercase `spec:` trailer and a subject
  **≤72 bytes** (Devanagari makes bytes and characters diverge). `.husky/pre-commit` runs
  `eslint --max-warnings 0` on **staged** files — a tree-wide run is 361 warnings and that is fine;
  CI enforces 600. Never `--no-verify`.
- **`check:file-sizes` caps source files at 800 lines.** Split, never suppress.
- **Two suites, and the split is deliberate.** `npm test` is the **merge gate** and must stay at
  **exit 0** — it excludes `REPRO-*.test.ts`. `npm run test:repro` is the **open-defect suite**, red
  on purpose, reporting-only in CI. **When a REPRO file goes fully green, rename it out of the
  `REPRO-` prefix** so it joins the gate as a permanent regression guard. A shrinking REPRO count is
  progress.
- **A Dexie version bump is one-way for APK users.** An older build opening a newer database throws
  and the app is unusable for that farmer. **Non-indexed fields need no bump** — prefer them. If a
  bump is genuinely required, ship it alone, never bundled with a behavioural change.
- **Every verification command runs unpiped** (or with `set -o pipefail`) and asserts its exit code.
  A vitest run that silently collects a subset is how a green gate becomes meaningless — **assert the
  file count too.**
- **Flake is a conclusion, never an assumption.** A failing test is a defect until a recorded
  isolated re-run on the same commit proves otherwise, with command and exit code.
- **Prove each guard by mutation:** break it, watch the **named** assertion fail, restore, confirm by
  hash. "23 failed" is not evidence; `machinery_survives_the_first_pull_after_acknowledgement` is.
- **Branch:** `feat/server-authoritative-architecture`. **Merge to `main` is founder-gated and never
  autonomous.** No task here merges, pushes to a shared branch, or deploys.

---

## Change Surface

**DB:** Tasks 2, 3 and 5 add columns via EF migrations in the `ssf` schema (additive only, no drops,
no renames). No RLS policy change. No seed change. Tasks 1, 4, 6, 7 touch no database.

**Backend:** Tasks 2, 3, 5 widen `PayloadHasOnly` allow-lists, add persistence and read-back, and
regenerate C# payload records from zod. Task 4 changes one error-classification path. No new
endpoint. No new NuGet package.

**Frontend:** `src/clients/mobile-web` throughout. Task 1 adds one review surface. Task 6 adds one
"coming soon" screen. **No Dexie version bump in any task** — every new field is non-indexed.

**Cross-cutting:** No secrets. No prod infra. **No AI prompt change, so no prompt-registry bump and
no golden-set delta.** Tasks 1 and 6 touch `.tsx`, so the L5b UI gate engages — batch all `.tsx`
writes before the first `.tsx` commit and never set `UIUX_GATE_BYPASS`.

---

## Task ordering rationale

Ordered by farmer harm, with contract-shaped work grouped so the wire is opened once rather than
three times. Task 1 first because it is client-only and completes work already half-landed. Tasks 2
and 3 share the money contract and must land together or income inherits the same inversion. Task 7
last among the code tasks because it is the highest blast radius and benefits from a settled tree.

---

### Task 1: Let the farmer see and confirm the drafts his offline notes produced

**Why first:** the persistence half already landed (`27e55ce7`); the drafts exist in
`pendingAiJobs.result` and **nothing reads them.** Until this lands, the fix is invisible and the
farmer's offline note still produces nothing he can act on.

**Files:**
- Read first: `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts` (the
  `PendingAiJobResult` shape and its comments) · `src/infrastructure/sync/AiJobWorker.ts` (how it is
  written) · `src/features/logs/components/manual-entry/ManualEntry.tsx` (the `initialData` prop) ·
  `src/infrastructure/ai/BackendAiClient.ts:104-132` (how the LIVE path normalises a parse).
- Create: a reader module that lists unreviewed results and marks one reviewed.
- Create: one review surface listing pending drafts and opening `ManualEntry` with the parse.
- Modify: wherever the surface is reachable from (follow existing navigation conventions).

**Interfaces:**
- Consumes: `PendingAiJobResult` from `DexieDatabase.ts`.
- Produces: `listUnreviewedAiResults()` and `markAiResultReviewed(jobId)`.

- [ ] **Step 1: Read the four files above before writing anything.** Confirm for yourself that
      `result` is written on completion, that nothing reads it, and exactly how `BackendAiClient`
      turns an API payload into an `AgriLogResponse`.
- [ ] **Step 2: Normalise through the SAME code the live path uses.** The payload is stored verbatim
      precisely so there is one reading of it. **Do not write a second parser.** If the live path's
      normalisation is not currently exported, extract it without changing its behaviour and have
      both call it — that extraction is a pure move, verified by the live path's existing tests
      staying green.
- [ ] **Step 3: A draft is an offer, never a record.** The surface must not create a `DailyLog`, must
      not mark anything confirmed, and must not present a total the farmer did not state. It offers
      the parse into `ManualEntry`; the farmer's existing confirm path does the rest.
- [ ] **Step 4: Mark reviewed only after the farmer acts.** Set `reviewedAtUtc` when he confirms or
      explicitly discards — never merely on viewing, or one glance silently loses the note.
- [ ] **Step 5: Failed jobs are not drafts.** Only `status === 'completed'` rows with a `result` and
      no `reviewedAtUtc` may appear. A `failed_permanent` job has its own honest surface already.
- [ ] **Step 6: Tests.** Cover: a completed job with a result appears · a reviewed one does not · a
      failed one does not · a completed row with **no** result (an old row from before `27e55ce7`)
      does not appear and does not throw. Run them, record the command and exit code.
- [ ] **Step 7: English placeholder copy only.** No newly composed Marathi (Global Constraints).
- [ ] **Step 8: Full verification.** `npx tsc --noEmit` · `npm test` (assert exit 0 AND the file
      count) · `npm run lint` · `npm run check:file-sizes`. Record real output; do not predict.

---

### Task 2: Machinery and activity expenses reach the server and come back as themselves

**Why grouped:** both are the same defect — the client sends them flattened into `tasks` (or not at
all) and the rebuild guesses them back as the wrong record type. Spec D4 sizes this at ~a week and
calls it "fix the half-built", not construction.

**Files:**
- Read first: the labour round trip end to end — it is the proven pattern and this must copy its
  shape, not invent one.
- Contract: `sync-contract/schemas/payloads/create_daily_log.zod.ts` and its generated C# twin.
- Backend: the `create_daily_log` handler, persistence, and the pull DTO/query.
- Frontend: the payload builder and `logsReconciler.ts`'s rebuild.

- [ ] **Step 1: Copy the labour seam.** Labour already travels structured, persists, reads back and
      reconstructs. **Read it first and follow it.** Do not design a second mechanism.
- [ ] **Step 2: Five commits, cut by pipeline stage, in this order** — contract (zod + regenerated
      C# + widened `PayloadHasOnly` + the parity test) · server persistence + EF migration · server
      read-back (DTO + query + client twin) · client reconstruction · **only then** removing the
      local-only path. **Stage 5 lands at least one deploy after stage 3 is prod-proven — never in
      the same PR.** Stages 1–4 are additive and reversible; stage 5 is the only irreversible commit.
- [ ] **Step 3: Machinery is machinery.** It currently returns as a crop activity. When it comes back
      in its own bucket, the phantom-duplicate hazard documented in `logsReconciler.ts` must be
      re-read and the guard's comment updated to match the new truth.
- [ ] **Step 4: The migration travels with the binary.** Startup migrations are disabled in
      production and no deployment step in this repo applies a ShramSafal migration — **state this
      explicitly in the report** rather than assuming a mechanism exists.
- [ ] **Step 5: Turn the REPRO assertions green** and run the full verification set from Task 1
      Step 8, plus `dotnet test src/tests/AgriSync.ArchitectureTests --configuration Release` and the
      sync contract tests with `--configuration Release` (a running dev API locks Debug output and
      the failure is disguised as a bare "Build failed").

---

### Task 3: Income stops being recorded as money spent

**Why with Task 2:** it is the same contract wave. Landing it later means opening the money wire
twice, and harvest would inherit the inversion.

- [ ] **Step 1: Reproduce it first.** `REPRO-A3` already asserts an income event must be
      distinguishable from an expense on the wire. Run it, record the red.
- [ ] **Step 2: Direction is an explicit field, never inferred from sign or category.** A negative
      amount is not a direction; a category is not a direction. `P1` — stated and derived never
      impersonate each other.
- [ ] **Step 3: Carry the six fields dropped at the outbox boundary** — qty, unit, unit price,
      payment mode, vendor, attachments — in the same contract change.
- [ ] **Step 4: Existing rows have no direction.** Decide and **state in the report** how a row
      written before this reads back. It must not silently become income or expense — unknown stays
      unknown (`P4`).
- [ ] **Step 5: Verification** as Task 2 Step 5.

---

### Task 4: A cost correction reaches the server, or the farmer is told why not

**Files:** `src/features/finance/financeCommandService.ts:162` · the correction payload · the server's
`ToOutcome`.

- [ ] **Step 1: The id shape is the whole trap — read this before touching the payload.** The server
      validates `financeCorrectionId` as a bare GUID; this id is minted `madj_`-prefixed. **Renaming
      the field without changing the id makes the validator throw inside an unawaited promise, so the
      correction stops reaching the outbox at all — strictly worse than being refused at the server.**
      Change the id's shape first, in its own commit, with a migration for ids already on farmers'
      phones. Then rename.
- [ ] **Step 2: Remove `originalAmount` entirely.** It is a hardcoded `0` — a fabricated previous
      value in a money ledger (`P4`). The server reads the real previous amount from the entry
      itself. **Do not send the real value instead**; the allow-list does not accept the key.
- [ ] **Step 3: Carry `ErrorKind` on the wire.** The server already classifies every error and
      **drops the classification in `ToOutcome`**, reducing the client to string-matching a
      hand-written list. Carrying the kind removes the whole class; adding another string fixes one
      mutation. The string already added for `SyncInvalidPayload` stays until the kind lands.
- [ ] **Step 4: Verification** as Task 2 Step 5.

---

### Task 5: Planned tasks actually travel

**Spec D4 sizes this "days — pure wiring": the commands exist on both sides and nothing calls them.**

- [ ] **Step 1: Verify that claim yourself** before building. Find both commands, confirm zero
      callers, and **report if the claim is wrong** rather than building around it.
- [ ] **Step 2: Wire the existing commands.** If they genuinely exist on both sides, this is wiring —
      resist adding a mechanism.
- [ ] **Step 3: A planned task is the farmer's intention, not a promise.** It must not appear as work
      recorded, and must not enter any cost total.
- [ ] **Step 4: Verification** as Task 2 Step 5.

---

### Task 6: Harvest says honestly that it is not here yet

**Spec D4: one honest "coming soon" screen for harvest. Nothing else hidden.**

- [ ] **Step 1: Find every reachable harvest entry point.** The save handler updates screen memory
      only and the backend has no harvest type, so **every** path that looks like it records a
      harvest currently loses it.
- [ ] **Step 2: Replace the entry points, do not merely hide the button.** A farmer who reaches the
      screen by any route must meet the honest message, not a form that silently discards.
- [ ] **Step 3: Existing local harvest data is NOT deleted.** It has no server copy. Leave it in
      place, readable; migrating it awaits the founder's product-truth ruling.
- [ ] **Step 4: English placeholder copy.** The founder authors the final Marathi.
- [ ] **Step 5: Verification** as Task 1 Step 8.

---

### Task 7: Two farmers on one phone cannot reach each other's records

**Highest blast radius in this plan. Read every correction below before writing a line.**

- [ ] **Step 1: The root cause is NOT "two keys fall out of sync".** Unknown ownership resolves to
      the shared database — **the routing fails OPEN.** Clearing browser storage does not corrupt the
      answer; it deletes the answer, and the fallback hands the incumbent's database to whoever asks
      next.
- [ ] **Step 2: Move the ownership claim INSIDE the database it describes** — one `appMeta` row
      written in a `rw` transaction on first authenticated open, so no partial clearing can
      desynchronise the claim from the data. **`appMeta` has existed since v1 — no Dexie bump.**
- [ ] **Step 3: Fail closed, and know the blast radius before you make it throw.** There are
      **299 `getDatabase()` calls across 84 files**. Produce an inventory of which sites swallow a
      throw (a worker stops silently) versus which crash boot — **before** changing the behaviour.
      Note the init effect's `try/catch` logs only and its `finally` always clears the loading flag,
      so a throw today becomes fail-open plus a crash; and activation is conditional while
      `dataSource.initialize()` on the next line is not, so demo mode and any pre-hydration render
      still open the incumbent's database.
- [ ] **Step 4: MOVE local keys, never delete them.** Harvest, procurement and finance settings have
      **no server home**; clearing them is data loss wearing containment's clothes. On activation for
      a new user, migrate the incumbent's un-namespaced keys into the incumbent's own namespace
      first. Read the active user **live** — a `setUser()` mirror re-introduces the boot-order race
      the current code was written to avoid.
- [ ] **Step 5: Four raw-key stores, not two** — `FinanceLegacyStore`, `VocabStore`,
      `FarmInviteStore`, `DeviceIdStore`. **`DeviceIdStore` is a hard ordering constraint:** both
      server dedupe layers key on `deviceId`, so re-minting it changes every unsent mutation's dedupe
      key and manufactures permanently-failed rows. **Do not re-mint it.**
- [ ] **Step 6: Fix `LegacyLocalStorageMigrator` in the same commit** — it reads via the key helper,
      so after scoping the read misses and it sets its once-only flag anyway, silently losing the
      import.
- [ ] **Step 7: Cache Storage is origin-scoped, not database-scoped.** Renaming isolates only future
      writes and orphans the incumbent's photos. **Design the access boundary, not the name.**
- [ ] **Step 8: The previous farmer's database is quarantined, never deleted.** Route nobody to it.
      Deletion is irreversible and the device may hold the only copy.
- [ ] **Step 9: Assert the change is non-destructive** — old keys remain present and readable — and
      run the full verification set.

---

## 🛑 Founder Acceptance Gate

**Every deployment step is blocked until the founder ticks this.** Code-complete ≠ approved.

Verify on a real device — the branch has never run on one, and the plan's own rule is that a
clean-device journey must not be a unit test:

1. **Record a log with machinery, an activity expense and a stated total. Sync. Pull.** All three
   still there, and the total is the one you typed.
2. **Record a voice note in aeroplane mode. Restore network. Reopen.** The draft is offered for
   review, and confirming it produces the log you spoke.
3. **Record one income and one expense of the same amount.** They remain distinguishable.
4. **Correct a cost amount.** It reaches the server, or it appears in the conflicts screen.
5. **Open harvest.** An honest "coming soon", never a form that discards.
6. **Log out. Log in as a second farmer.** No trace of the first. **Then log back in as the first —
   his data is still there.**

Run `cd src/clients/mobile-web && npm test` — **expected exit code 0.** Point at the exit code.

**Founder approved: [ ]**

---

## Deployment Plan

Backend + web + **a new APK build** — the Android build bundles web assets at build time, so a web
deploy reaches zero APK users.

- [ ] Founder decides the merge. **Never autonomous.**
- [ ] `REMOTE_GREEN` on the landed commit. Local green is not evidence.
- [ ] **Disable both nap-schedule rules for the window.** Production stops daily at 19:30 UTC
      (01:00 IST) regardless of a manual wake; a heavy deploy plus the manual acceptance run above
      will straddle it and lose the database and host mid-flight. Re-enable after.
- [ ] **Pre-deploy RDS snapshot.** The database is single-AZ; a manual snapshot is the only rollback
      floor. This branch carries EF migrations — heavy tier, not a static push.
- [ ] Deploy via the `/deploy` plugin. **Never hand-rolled.**
- [ ] **CloudFront invalidation is mandatory.** `index.html` carries no cache header and inherits a
      24-hour TTL. Smoke checks must assert **`Content-Type`**, not status — that distribution serves
      `index.html` at HTTP 200 for paths that do not exist.
- [ ] Prod proof: `/version` SHA and HTTP status. **Written ≠ live.**
- [ ] `DEPLOYMENT_TRACKER.md` row.

**Rollback:** stages 1–4 of each domain are additive; **domain stage 5 is the only irreversible
commit** and lands a deploy later. Client-only tasks roll back by redeploying the previous SHA.

---

## Self-Review

**Spec coverage.** D4's list is covered task by task: planned tasks → Task 5 · income → Task 3 ·
expense corrections → Task 4 · machinery and activity expenses → Task 2 · harvest → Task 6. D9/D10
(voice retention, encryption, durable consent) are **deliberately deferred to a follow-on plan** —
the sweeper is already off (`9b48c623`), which is the part D9 ordered first, and encryption plus
consent durability is a security-shaped body of work that deserves its own plan rather than a tail
task here. **This is stated, not omitted.**

**Boundary check.** No task touches unseen-tracking, the notification summary, the permission split,
or the approval-sticking defect. Those are the oversight lane's.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every
task names the files to read first and the trap that makes the naive fix wrong.

**Constraint check.** No task requires a Dexie version bump. No task merges, pushes or deploys. No
task composes farmer-facing Marathi.
