# MASTER pilot-readiness plan — strict cross-verification

**Date:** 2026-08-15 · **Branch:** `feat/dfes-companion` (84 ahead of `origin/main`, 0 behind)
**Verifies:** `2026-08-15-MASTER-pilot-readiness.md` · **Method:** 5 independent agents + supervisor, every claim checked against code in this worktree.

## VERDICT: **RED — do not dispatch.**

The plan is well-researched and most of its individual observations are true. It fails on three
things that no amount of execution fixes:

1. **Wave 1 cannot work as scoped.** It is a client-only fix to a value the server owns.
2. **Wave 0's migration risk tier is falsified by the project's own classifier.**
3. **The deploy sequence in Wave 4 has no mechanism for 2 of its 4 steps.**

Only **2 of 22 tasks** (0.1, 0.5) are safe to dispatch today.

---

## PART 1 — the decision register, verified row by row

| # | Recorded decision | Verdict |
|---|---|---|
| 1 | Both browser + installed app | **TRUE.** Consequence understated — see G-3: Dexie v23 makes the point of no return earlier than the APK. |
| 2 | All four surfaces ON | **TRUE**, but `VITE_DAILY_LOOP` **defaults OFF**. Confirm what prod serves today before sizing 2.4. |
| 3 | Answer by speaking, no taps | **TRUE as a decision.** Wave 3.7 as written does **not** deliver it — see G-8. |
| 4 | ⚠️ Owner-confirms-own / others queue | **Premise TRUE, conclusion INCOMPLETE.** `operatorRole.ts:38-42` and `profileAndCropsReconciler.ts:150` verified exactly. But the fallback rule cannot be implemented client-side either — see G-1. |
| 5 | Mukadams in pilot; approval screen exists | **PARTLY TRUE.** `ReviewInboxSheet.tsx` exists, but the mutation it fires (`verify_log_v2`) is **unimplemented server-side** and permanently rejected. The approval screen does not work end to end. |
| 6 | Number never goes backwards within a day | **TRUE as a decision, UNIMPLEMENTED and CONTRADICTED.** No task enforces intraday monotonicity, and Wave 3.11 explicitly removes points. See G-9. |
| 7 | 0/10 was a bug | **STALE.** Fixed two commits ago; typed days score **6/10** on a real DB. Wave 3.8 would rebuild a working fix. |
| 8 | Spoken no-work day + chips after | **TRUE.** Scope understated: **six** layers, not four. See G-7. |
| 9 | Harvest / Scouting / Entire Farm untouched | **TRUE.** No task touches them. |
| 10 | Label → "Shram Safal Reviewed" | **TRUE.** Small, precise, ready. |
| 11 | Motivational lines keep नोंद | **TRUE — and already settled by you.** See G-5; this is one of the six ⚠️ boundary strings. |
| 12 | "The six rulings" | **TRUE — all six are real and all six are covered.** *(Corrected: an earlier pass reported Ruling 5 missing. It is not.)* The canonical list is `docs/superpowers/specs/2026-08-15-shram-sathi-followup-system-design.md` §"The six decisions". **Ruling 5 = "Numeric certainty is required in v1"** (spec :80-93) → detail Task 8 → **Wave 3.12**. The detail plan implements it but never cites it by the label "Ruling 5", which is why a grep for that string finds only 1, 2, 3, 4, 6. No ruling was dropped. |

**Rows needing your correction before execution: 4, 6, 7, 12.**

---

## THE BLOCKING GAPS

### G-1 · Wave 1 is one-third of a fix — **the single most important finding**

The server is sole authority on verification status:
- `DailyLog.cs:70-77` derives `CurrentVerificationStatus` by folding events; `DailyLogConfiguration.cs:133-134` `Ignore()`s it. **No column exists for a client to write.**
- `logsReconciler.ts:136-137`: `// Verification is a server-side FSM; the device never wins it.`
- `DailyLog.Create` adds zero verification events → an owner's own synced log returns as **`Draft`**.
- No server-side auto-approve exists anywhere; `VerificationStateMachine` has no `Draft → Verified` edge for any role.

**Therefore any fix confined to `LogFactory` + a Dexie backfill is overwritten on the next pull.**

Three compounding defects the plan does not carry:

- **`CONFIRMED` does not move the ring.** `dayState.ts:77-80` — `VERIFIED_STATUSES = {VERIFIED, APPROVED}`. Stamping `CONFIRMED` leaves the ring at 70% and `isClosed` false permanently. *This is the most likely way this plan ships broken and passes its own tests.*
- **The proposed comparison is unwritable.** The owner GUID does not exist on a new farmer's device before first sync. Correct predicate:
  ```ts
  const actor = profile.operators.find(op => op.id === profile.activeOperatorId);
  const isOwner = actor?.capabilities?.includes(OperatorCapability.APPROVE_LOGS) ?? false;
  ```
  Capability, never identity — it also covers `SECONDARY_OWNER` and works in both pre- and post-sync states.
- **Four `verifiedByOperatorId: isOwner ? 'owner' : undefined` writes** at `LogFactory.ts:317,454,686,819` are not in the plan. Left alone, every "confirmed" log carries a verifier id matching no operator.

**Also inside this blast zone, unlisted:** `verify_log_v2` returns `MutationTypeUnimplementedCode` (`PushSyncBatchHandler.cs:406-411`) → classified PERMANENT → `REJECTED_USER_REVIEW`. **Every manual verification a farmer performs today is silently rejected.** And `VerifyLogCommand.ts:5-9` sends `verificationStatus` where the server allowlist expects `status`.

**Required:** Wave 1 gains a server-side task — either `CreateDailyLog` emits a `Draft→Confirmed` event when the creating operator holds owner role, or `verify_log_v2` is implemented and fired on create. Plus a decision on which status the ring counts.

### G-2 · Wave 0.2's risk tier is machine-falsified

ADR 0024 §BC1: *"Classification is **DERIVED, not declared** … never from a self-declared chart string."* Running the mandated `classify-migration.py` against `20260713052440_AddDfesDataSpine`:

```json
{"change_kind":"destructive","rehearsal_method":"clone",
 "reasons":["CreateIndex unique on existing table -> strict (dup-data fail)",
            "Sql() data-mutation/destructive DDL -> strict"]}
```

`Up()` is 12 `AddColumn` (all nullable — no rewrite risk) + 2 `CreateTable` + **3 `CreateIndex` (one unique)** + a raw `Sql` block doing `ENABLE/FORCE ROW LEVEL SECURITY`, 4× `DROP POLICY IF EXISTS`, 4× `CREATE POLICY`, `REVOKE UPDATE, DELETE`.

**`Down()` drops 2 tables and 12 columns of farmer data** — while the deploy lane's own SSM document states *"EF Down() throws by design — no migration rollback inside this document."* That assumption is false here. Anyone reaching for `database update <previous>` destroys data.

Wave 0.2 also omits ADR 0024's ephemeral-lane steps 4–6: RLS tenant A/B isolation smoke, empty-GUC-no-500 (ADR 0020), `RlsExemptionAllowlistTests`. This migration ships two tables with **RLS enabled and forced**; dropping the RLS smokes is the riskiest omission in Wave 0.

### G-3 · The migration lane EXISTS — the plan describes it backwards

> **CORRECTION (supersedes the first pass of this report).** An earlier verification concluded "no prod
> path applies ShramSafal migrations." **That was wrong**, and wrong for a structural reason worth
> recording: `_COFOUNDER/` does not exist inside a git worktree, so any agent verifying deploy claims
> from `.claude/worktrees/*` cannot see the deploy history and will reach that false conclusion.
> Deploy-history searches must run from the main checkout. The standing memory note
> `prod-migration-application-gap` is stale on this point.

**The proven lane:** `_COFOUNDER/OS/State/Deploy/HISTORY/1344da2b.md` records deploy `23222cdc`
(2026-07-04) applying **17 `ShramSafalDbContext` migrations** to prod — `schema: ssf`, history table
`ssf.__ef_migrations`, `tier_final: heavy`, surface `database`, through the `/deploy` plugin's full
7-gate machine with an RDS snapshot floor (`shramsafal-prod-db-pre-23222cdc-20260704004123`) and G5
verification.

**The mechanism:** stage `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` at G4 → `Program.cs` applies the
migrations **on API boot** → reset to `false`. Chart line 171 makes this explicit; G4 evidence records
*"ALLOW correctly reset to false."*

| Step | Possible today? |
|---|---|
| 1. Migration proven applied **before** the API restarts | **NO — and it never has been.** The API restart *is* what applies the migration. The plan's step 1/step 2 split contradicts the only procedure with a successful prod track record. |
| 2. API second | **Merged into step 1** by the real mechanism. |
| 3. Web third | **YES.** |
| 4. APK last with flags | **NO.** The plugin has **no APK surface**; `android-release.yml` sets 2 vars. All 7 companion flags bake **OFF**. |

**So the migration is achievable today by repeating the `23222cdc` procedure.** Two blockers remain:
the **APK flag gap**, and the plan's **ordering requirement, which no mechanism satisfies and which
should simply be dropped** in favour of the proven boot-coupled lane.

**This makes Wave 0.1 more important, not less.** Because the real lane applies migrations during API
boot, a failed migration *is* the silent-exit-0 scenario — the process dies looking like a clean
shutdown while the site is down.

**Durability caveat:** the executable artifacts (`_COFOUNDER/.local/api-binary-swap-*.sh`,
`ssf-migrations.sql`) live in a path gitignored *inside* the `_COFOUNDER` repo. They are per-deploy
scratch, templated from the previous deploy — **not a committed runbook**. Task 0.2's purpose stands;
its stated rationale is what needs correcting.

**Open tension:** `agent-deployer` IAM denies `rds:CreateDBSnapshot`/`rds:Restore*`, yet the July
deploy took a snapshot. Either founder credentials were used or the role changed. **Confirm which
before relying on the plugin to take the snapshot floor.**
And **`/version` only proves a SHA if the deploy exports `BUILD_SHA`** (`Program.cs:643-653`, else `"unknown"`).

### G-4 · The two branches collide — but NOT where the first pass said

> **CORRECTION (supersedes the first pass).** I wrote that the July-dated `AddDfesDataSpine` arriving
> after the sibling's August migrations would make EF "apply out of order" and break. **That is false.**
> EF Core computes pending migrations as *assembly set minus applied set* from `ssf.__ef_migrations`
> and applies them; it has **no monotonicity check** (no Flyway-style out-of-order rejection), and the
> repo adds no custom ordering guard. Verified further: the two migration sets are **completely
> disjoint** — zero shared tables, columns or policies. `AddDfesDataSpine` touches
> `ssf.observation_events` (+12 cols) and creates `daily_richness_aggregates` + `question_events`;
> the sibling's August five touch `audit_events`, `farm_boundaries`, `correction_events`,
> `cost_entries`, and create `raw_blob_subjects`. **Deploy order carries no schema risk in either
> direction.**

**Scale (corrected):** `feat/server-authoritative-architecture` is **202 commits ahead** of `origin/main`
with **16 migrations** not on main (not 5). `feat/dfes-companion` is 84 ahead. Both are 0 behind.
**Neither branch has anything in production** — `origin/main` HEAD is `739dfe90` (2026-07-18).

**The two collisions that are real:**

1. **🔴 Dexie `v23` add/add — the serious one, and it fails silently.** *Both* branches independently
   created `dexie/versions/v23.ts` exporting `applyV23`, and both registered `applyV23(this)` in
   `DexieDatabase.ts`. Main tops out at v22. **Dexie never re-runs a version it has already applied.**
   If branch A ships its v23 to farmers' phones and branch B later ships a *different* v23, those
   devices are already at IndexedDB 23 and **will never run B's upgrade** — permanent, silent schema
   divergence with **no error**. **Whichever branch ships second MUST renumber to v24 before any web
   deploy.** This is non-negotiable and easy to miss because nothing fails loudly.

2. **🟠 `create_daily_log` payload allow-list.** Both branches extended the same wire contract
   (sibling: `scope`/`plotIds`/structured labour; dfes: `manualDraft`). The server's `PayloadHasOnly`
   rejects the **entire mutation** on any unexpected field — so a sloppy merge silently breaks every
   log save.

**Plus:** `ShramSafalDbContextModelSnapshot.cs` was rewritten from the same base by both (+347/−15 and
+346/−8). Whoever merges second **must regenerate it, never hand-merge** — a hand-resolution that drops
the other lane's entities makes the next `ef migrations add` emit a migration that **drops those
columns and tables**, silently, until it runs.

**Of the 30 conflicts: ~20 real, 2 EF-mechanical, 8 incidental** (including both branches independently
making the same fix — removing a hardcoded DB password).

### G-4b · Recommendation: ship `feat/dfes-companion` first

1. **The flip condition did not trigger.** The sibling does **not** build Wave 1's server-side half:
   `verify_log_v2` returns `MutationTypeUnimplementedCode` on both branches identically;
   `VerificationStateMachine.cs` has a **zero-byte diff** vs main; `Draft→Verified` exists for no role;
   `DailyLog.Create` emits no verification event; `operatorRole.ts` and `profileAndCropsReconciler.ts`
   are byte-identical to main **on both branches**. Wave 1 must be built either way.
2. **dfes is deployable; the sibling demonstrably is not.** dfes's tree is substantively clean
   (`git diff --numstat` empty — pure LF→CRLF churn). The sibling is **mid-task**: an untracked
   `features/sync/recovery/` module is already imported by a modified tracked file, and an
   *already-committed* migration is being rewritten in place. Plus 49 open gaps, 8 open founder
   decisions (one *"blocks everything else"*), and a release blocker added today.
3. **Order is free at the database level** (see the correction above), so sequencing should follow
   readiness, and the smaller lane is ready.

**Strongest counter-argument, stated fairly:** whoever ships second pays the reconciliation cost, and
that cost is much higher for 202 commits than for 84. The sibling also carries security work that
arguably outranks a companion feature — the `audit_events` TRUNCATE hole, transcript leakage out of
correction events, RLS on `farm_boundaries`. **The right response is to ship dfes now *and* pull the
sibling's security migrations forward as their own small lane**, not to hold a finished branch behind
an unfinished one.

**One free win available:** the sibling already repaired the v1 verify wire
(`VerifyLogCommand.ts` — `verificationStatus`→`status`, plus `'confirmed'` in the allowed set), which
dfes still has broken. Cherry-pick that fix into Wave 1 rather than rediscovering it.

### G-5 · Gate A is already answered — and the sweep is largely already done

`G:\VALIDATION\shram-sathi-FINAL-strings.md` records **Ruling C = `sathi-only`**: the नोंद ban applies to lines Sathi *speaks*, not to UI chrome. It carries founder-approved final Marathi for **94 of 95 strings**. Spot-check: 4 of 5 sampled strings are **already in the code**.

The one genuinely open question is the one that document ends on:

> *Are the blackboard quotes Sathi speaking (ban applies) or the product's wall (it does not)?* **One answer settles six strings** — `closeToday`, `weeklyReviewPrompt`, Q4, Q6, Q7, Q9.

The plan's (a)/(b)/(c) re-asks a settled question in different terms and would have agents **inventing replacements** instead of applying your approved set. Its four drafted replacements are worse than redundant: **none of the four source strings exist in `translations.ts`** — they are hardcoded literals, resolving to **6 edit sites + 5 test assertions + 3 comments**, one of which sits beside a *second* fabrication (`"3 दिवसांपूर्वी"`, `QuickLogSheet.tsx:140`).

**The real Marathi gap is different and unblocked:** `mainView.tsx` — the primary navigation surface — contains **zero** `t()` calls. A Marathi-only farmer sees `Daily Log`, `Daily Closure`, `Close Yesterday`, `Running Cost`, `Today`, `Yesterday`, `Activity Feed`, `Pending approvals`, `Cost may be inaccurate`, `Day Not Closed`, and the save toast `Logged. Day closure: 70% -> 40%` in English.

Verified counts: **65 farmer-visible नोंद lines / 25 files** (plan said 64/24 — accurate). Legal-tagged strings are **11, not 9**. "Bottom navigation tab" is wrong — it is a header segmented control (`PageToggle.tsx:21`).

### G-6 · The fabrications DO still reach the server

Plan §2.1's scope note ("since `977a95e4` these no longer reach the server") is **incomplete**. The `manualDraft` wire is closed — but `ManualEntry.tsx:356-365` fires `postAiCorrectionBlob({ aiDraft, userDraft, provenance })` → `CorrectionEventStore.ts:133-136` POSTs `CorrectedParse: JSON.stringify(userDraft)` to `/shramsafal/corrections`. `userDraft` carries the invented tractor, `'Well'`, `'Unknown'`. On the voice path this is the normal case, and **the fabrications are what make the POST fire** (they create the diff). The server records them as *the farmer's correction of the AI* — the strongest possible attribution to him. **P4 violation, still live.**

Sites: the 7 named are exact, plus **8 more in the same file** (206, 234, 238, 281, 285, 314, 316, 318) and 2 in `LogFactory.ts:614,751`. Line 285 is load-bearing — it stamps `'Spray'` on any non-fertilizer input, which is what conjures the tractor at 325. Line 350's injected `90` doesn't display a fake number; it **suppresses** the low-confidence warning (`ObservationEventCard.tsx:131-133` renders only when `< 60`).

**The `summary` credit, quantified:** on a silent day `possible = 55`, so the injected `"Log processed."` is worth `10 × (20 × 0.5) / 55 = 1.82` → **the farmer sees 2/10 for a day he said nothing about.** WHAT is weight 20, *tied* with DOSE, not "biggest" — but it is the biggest always-applicable dimension. Blanking is safe (`z.string()` with no `.min(1)`); the plan's `.strict()` reasoning is wrong (the guard is *required*, not *strict*) and deleting would not break parse — `BackendAiClient.ts:104-125` uses `safeParse` with a silent fallback. **The instruction is right; the reason is wrong.** Exactly one test pins the literal.

### G-7 · Wave 3: 4 of 12 tasks are dispatchable

**READY (4):** 3.1, 3.2, 3.6, 3.9
**NEEDS AUTHORING (5):** 3.3, 3.5, 3.7, 3.8, 3.10
**FOUNDER-GATED (3):** 3.4, 3.11, 3.12

- **3.3 will not compile.** `FindQuestionEventAsync` exists nowhere in `src/`. The plan's Correction 1 mandates adding it but gives **no signature**, does not amend the Files list, and silently creates an **undeclared collision with 3.5** on `IShramSafalRepository.cs` + `ShramSafalRepository.cs`.
- **3.5's version guard is two unwired local variables.** `applyWeatherRule` is computed and never threaded anywhere. Worse, it guards **only** the weather change while 3.4 and 3.11 also change scoring with no guard — so a `dfes-3` day recomputed after 3.4 **will** be rescored, exactly what the plan forbids. This is a design task, not an insert.
- **3.7 does not unblock 3.11.** Its own test asserts `response: null` — the answer returns as a new parsed log, not answer text. `AnsweredGap.TryFrom` returns false on blank. So 3.11's `ObservationAnchor` would be unreachable dead code.
- **3.10 is six layers, not four.** `ManualDraftNormalizer`'s output goes to `LedgerDerivationService`, **not** to the scorer's roots; the only bridge is `PersistedDayRootBuilder`, which **never emits `dayOutcome`**. A perfectly wired contract still would not reach `DeclaredNoWork`. Also needs `npm run generate:csharp`, which rewrites all 31 files in a folder the plan forbids staging.
- **3.8's premise is stale** (see Part 1 row 7).

**The serialisation table is wrong in both directions.** 2.2 does not modify `DfesLensExtractor.cs` (it only cites it). Five real multi-task files are **missing**: `LedgerRecognitionPanel.tsx` (T1+T6, identical range), `MeterQuestionHost.tsx` (T1+T7), `MeterDisplay.tsx` (T6+T7), `dfesQuestionBank.ts` (T6+T10+T11), and the repository pair (T3+T5).

**Gate letters are swapped between the two plan files.** MASTER: A=नोंद, B=fertiliser, C=certainty, D=observation. DETAIL: A=fertiliser, B=certainty, C=observation, D=नोंद. An agent dispatched to "3.4 — Gate B" opens detail Task 4 and reads **"BLOCKED ON GATE A."** The detail plan is also internally wrong twice (Gate A says "blocks Task 2", work is in Task 4; Gate B says "blocks Task 7", work is in Task 8) and misstates the version bump as Task 3 when it lands in Task 5.

**Cross-wave inversion:** 2.2 must land **after** 3.5. Nothing in Wave 3 warns of the inbound dependency.

### G-8 · Three of eight of Sathi's questions cannot move the number — and 3.5 makes it four

`AnsweredGap` accepts eight dimensions (WHAT, DOSE, SCOPE, CARRIER, COST, WEATHER, PURPOSE, CONTINUITY). `DfesLensExtractor` scores **five** (WHAT, COST, DOSE, CARRIER, WEATHER). **SCOPE, PURPOSE and CONTINUITY credit nothing.** Wave 3.5 removes WEATHER from the roster → **four of eight** become dead ends.

The whole premise of Wave 3 is *"answering raises the score."* A farmer who answers and watches the number stay still stops answering. This was flagged as an open founder decision in the previous run's report and the plan dropped it.

### G-9 · Wave 3.11 breaks the guarantee Wave 3.5 installs

Decision 6 says the number never goes backwards. Wave 3.11 removes reward points from a terse observer, and **two of your three filler examples already pass today's bar**. 3.5 lands before 3.11, so 3.11 cannot remove points without breaking the guard 3.5 just installed. It also lands on the wrong side of doctrine **P7** (*"naming people must never shrink the number — that punishes the farmer for being helpful"*).

**Fix the framing:** "a filler answer earns **zero additional** points — never negative."

### G-10 · Editing a log is completely broken — not in the plan at all

`updateLog` (`UpdateLog.ts:84`) enqueues mutation type **`add_log_task`** with payload `{dailyLogId, action:'UPDATE_LOG', updatedData, reason, actorId}`. There **is no update mutation in the catalog** — the DailyLog aggregate has only `create_daily_log`, `add_log_task`, `verify_log(_v2)`, `add_location`. `AddLogTaskPayload` requires `activityType: z.string().min(1)`, which the payload lacks → `validatePayload` fails → `enqueue` throws → caught → `{success:false}` → `handleManualSubmit` throws → **the farmer sees an error and the edit is lost.** It is never saved locally either.

`AddIssueToLog.ts:101` routes through the same call. And per G-1, an owner correcting his own log after the Wave 1 fix would **drop the ring 30 points again** (`UpdateLog.ts:47-76` resets verification to PENDING on edit).

### G-11 · The consent copy a pilot farmer signs is placeholder text

**78 `LEGAL_REVIEW_PENDING` tags under `src/`** counted with the CI gate's own include-list (`*.md`/`*.ts`/`*.tsx`/`*.cs`), across 21 files — including all three consent agreements (`agreement_mr.md`, `agreement_hi.md`, `agreement_en.md` — 8 each). A 79th tag sits in `marathi_worker_names.txt`, which the gate's include-list does not scan. The gate also greps `_COFOUNDER/`, so its true count is higher still.

Founder verdict **DS-015 (2026-05-17)** is explicit: *"engineering ships placeholder Marathi/Hindi/English legal copy NOW; **counsel reviews and swaps before real-farmer onboard**."* ADR-DS-008:165 — *"Counsel-swap of all `LEGAL_REVIEW_PENDING` strings is the **binding gate** for real-farmer onboard."*

**This pilot is real-farmer onboard.** Consent is the lawful basis for recording a farmer's voice under DPDP. The plan never mentions it.

### G-12 · Plan-contract defects (supervisor, `STOP` verdict)

Missing outright: **Change Surface** (auto-reject per `_COFOUNDER/CLAUDE.md:66`) · **Blast radius** with "does NOT touch X" · **Acceptance criteria** (no test is named anywhere) · **Definition of Done** · **Rollback plan** · sibling `*_DEPLOYMENT.md` (required: DB migration + >1 surface + new prod infra — all three hit) · `Founder approved: [ ]` tickbox · **RDS snapshot floor**.

Also: spec `master-pilot-readiness-2026-08-15` **exists in no spec directory** (the branch's registered spec is `_COFOUNDER/specs/_active/dfes-companion-2026-07-11.md`; the `commit-msg` hook is a format check only and would pass a fictional id). **`docs/AGRISYNC-DOCTRINE.md` does not exist on this branch** — only on `feat/server-authoritative-architecture`; every executor spawned here works blind to the doctrine, against a `CLAUDE.md` that still asserts the retired "signed commits required" rule. `_COFOUNDER/` is absent from the worktree, so the **test-scope pre-commit gate silently skips**; `gitleaks` is not installed. Wave 3 and §4.3 have **zero checkboxes**; five tasks collapse "Step 1–5" into one box. Every task says "Step 1: Write the failing test" **addressed to the implementor** — inverting the independent-test-writer rule. Phantom path: `manual-entry/useManualEntryHydration.ts` → real is `manual-entry/hooks/useManualEntryHydration.ts`.

**Doctrine E6 violation:** §4.1 pre-declares the failure count. *"Measure; never predict."*

---

## TEST BASELINE OF RECORD — measured, not predicted

**The branch is healthy.** `dotnet build` → **0 errors**. `npx tsc --noEmit` → **exit 0**. Lint → 0 errors / 384 warnings (script pins `--max-warnings 9999`).

**Backend: 1706 passed / 49 failed / 1 skipped (1756).** All 49 are in `ShramSafal.Sync.IntegrationTests`: 47 `DockerUnavailableException` + 2 `AiEndpointsTests` receipt-extract assertions. Both assertion failures are **provably pre-existing** — not merely because the test file is byte-identical, but because every file in the receipt-extract path (`AiEndpoints.cs`, `ExtractReceiptHandler.cs`, `AiOrchestrator.cs`, `IAiProvider.cs`, `ReceiptExtractCanonicalResult.cs`) has an **empty diff vs `origin/main`**.

**Frontend: the true baseline is 905/905.** A full run shows 901/4, but **all four pass in isolation**; `ProfilePage.snapshot.test.tsx` needs `--pool=threads` on this machine.

**Hold agents to: backend 49 (re-run the project alone if the solution shows 50 — contention noise), frontend 905 passing / 0 failing.** Any backend failure that is neither `DockerUnavailableException` nor one of the two named `ReceiptExtract` tests is **new**.

**Working tree:** 3 `.snap` + 30 pure LF→CRLF files under `sync-contract/schemas/payloads-csharp/` (`--ignore-cr-at-eol` yields 0 content lines) + 16 untracked. Both plan files and the spec are **untracked** — nothing under review is committed. `git grep` cannot see them; use the Grep tool.

---

## CORRECTED FLAG FACTS (Wave 0.4)

**17 flags are missing from `.env.production.example`, not 8.** Code reads 26 `VITE_*` names; the template has 9. `VITE_FARM_GEOGRAPHY_V*` resolves to exactly `VITE_FARM_GEOGRAPHY_V2`.

**Only one is dangerous when unset:** `VITE_UNLOCK_COUNTER_PAUSED` — absent ⇒ the deliberately-paused 2026-07-19 counter comes back. `VITE_VOICE_DOOM_LOOP_DETECTOR` is inverted (defaults **ON**); adding it as `=0` would *disable* doom-loop protection. `VITE_FARM_GEOGRAPHY_V2` and `VITE_WEATHER_BACKEND_FETCH` are **dead** — zero production consumers.

**All 8 Gate F flag names are spelled correctly and every one gates live code.** Gate F omits `VITE_VOICE_CONTINUITY`.

**Dexie v23 is unconditional.** `DexieDatabase.ts:759` calls `applyV23(this)` with no flag check. Every device loading the new bundle upgrades IndexedDB regardless of every flag. **A flag rollback does not roll the schema back**, and serving the old bundle afterwards raises `VersionError` on upgraded devices. The point of no return is the **web deploy**, not the APK.

**Wave 0.3 undercounts: 9 localhost fallbacks, not 3** — plus `inviteApi.ts:27`, `serviceProofClient.ts:12`, `testsClient.ts:34`, `jobCardsClient.ts:55`, `BackendFarmGeographyClient.ts:32`, `BackendWeatherClient.ts:20`. Good news: **all nine read one variable** (`VITE_AGRISYNC_API_URL`), so a single require-guard fixes all nine. Precedent exists — `vite.config.ts:11-31` already has a *deny*-guard (`assertNoForbiddenEnv`); this adds the mirror.

**Wave 2.4 correction:** `DailyLoopHero` and the `mainView.tsx:239-243` ring are **mutually exclusive** (opposite sides of the `dailyLoop` flag; a comment at `:231-234` says so). The contradiction is real but lives **entirely inside `DailyLoopHero.tsx`** — 100% ring at `:87` and "आज काहीच सांगितलं नाही" at `:99`, same button, same empty-day state. Fix one component, not two.

**And it is not live today.** `.env.production.example:30` ships `VITE_DAILY_LOOP=0`; `.env.local:7` has it `=1`, which is why the contradiction reproduces in preview. Gate F proposes flipping it ON and that checkbox is **unticked**. So this is a **latent defect that ships the instant Gate F is ticked** — meaning **the 2.4 fix and the Gate F flip must land in the same release, or the flip publishes the contradiction to farmers.** (The live prod value is not in the repo and cannot be verified from here; and because Vite bakes it at build time, flipping it for the APK needs a rebuild and re-release, not a config change.)

**Wave 2.5 / recompute correction:** there is **no sweep**. `RecomputeAsync` has five callers, all single-day-on-write. The uncontrolled surface is the **read path** — the `/10` is derived on read from `components_json` (`GetDayUnderstandingHandler.cs:62-64`), so any change to `DayUnderstandingScore` reaches every historical row **instantly, with no recompute and no guard**. 2.2 changes the extractor, which *is* recompute-gated. The plan has the risk pointed at the less dangerous of the two.

---

## WHAT "DEPLOY READY" ACTUALLY REQUIRES

Before any farmer sees this, these must exist and none do today:

1. A working prod apply path for `ShramSafalDbContext` migrations (G-3).
2. A migration failure that exits non-zero (Wave 0.1 — correct as written).
3. A snapshot the deploy role can actually take, or founder credentials (G-3).
4. A resolved merge order vs `feat/server-authoritative-architecture` (G-4).
5. Wave 1 with its server-side half, and a status the ring counts (G-1).
6. The corrections-POST fabrication path closed (G-6).
7. Counsel-swapped consent copy, or an explicit founder override of DS-015 (G-11).
8. An APK workflow carrying the flags (Wave 0.4 — correct as written, wrong counts).
