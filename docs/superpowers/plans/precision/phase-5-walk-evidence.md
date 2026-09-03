# Labour V2 R1 — The Acceptance Walk (founder-gate evidence sheet)

> **spec:** 2026-08-28-labour-v2-release-1 · **Phase 5 Task 5.2**
> **Run:** 2026-09-03, branch `feat/labour-v2-r1`, tree at Phase 5's four test
> commits on top of `1c367628`. Every count below is the verbatim tally of the
> named command, run on this tree, this day. Re-running any row's command must
> reproduce its count (backend rows from the repo root; frontend rows from
> `src/clients/mobile-web`).

**What this sheet is, in plain words:** your complete flow — from "मी बोललो"
to "the register remembers" — written as a checklist where every claim names
the automated test that proves it and the number that test printed. Nothing
here asks you to read code. If a claim ever stops being true, its named test
goes red in CI before any farmer sees the change.

---

## The walk — every row ran, every row green

- [x] **Row 1 — a natural main log stays untouched.** Speaking a normal day's
  work still goes through the same generic parser; this release restricted
  nothing there (D9.7).
  - Test: `src/core/domain/__tests__/LogFactory.oneEngagementOneQuantity.test.ts` — **14 passed (14)**
  - Gate: `npm run test:voice-pipeline` — **all 5 checks [PASS]**
  - Drift check: `git diff origin/main...HEAD --stat` on the generic prompt
    buckets (`ShramSafal.Infrastructure/AI/Prompts/core`) — **empty**; on
    `features/logs` — 11 files, **all labour-parse additions**
    (attendanceDraft, LabourReview rows, ManualEntry attendanceOnly,
    hydration, ActivityCard labour display, closureReceiptProjection).
    *Rebinding: the plan's two-dot `git diff origin/main` conflates
    origin/main's own advance (v1.0.10–.12 landed on main after this branch
    forked); three-dot is the release's own diff.*

- [x] **Row 2 — work truth is recorded (the existing engagement path).**
  - Test: `AgriSync.ArchitectureTests/LabourAnchorRules.cs` — **3 passed (3)**
  - *Rebinding: the plan expected 2 (single-producer + WTL A8); the landed
    file carries a third pin (PIN 3: AttendanceMark single-producer). More
    protection, same claims.*

- [x] **Row 3 — labour info is carried forward (the ladder asks only what is missing).**
  - Test: `src/features/labour/__tests__/attendanceLadder.test.ts` — **8 passed (8)**

- [x] **Row 4 — the anchor exists** and **Row 5 — the mic is available.**
  - Tests: `labourAnchor.test.ts` — **8 passed (8)**; `LabourHub.test.tsx` — **27 passed (27)**
  - The three named cases live verbatim: "a Draft log carrying a parsed 12 is
    NOT an anchor" · "the same log after confirmation IS the anchor, headcount
    carried forward" · "no anchor: hero inactive, approved reason rendered,
    ledger tile untouched".

- [x] **Row 6 — ask only WHO.** The rung-3 case asserts only the remainder
  question (यांच्याशिवाय अजून कोण होते?); the rung-4 case asserts only
  हे बरोबर आहे का?.
  - Tests: `attendanceLadder.test.ts` rungs + `AttendanceResult.test.tsx`
    ("rung 3: only the remainder question", **"rung 4: only हे बरोबर आहे का? —
    neither WHO nor the remainder is re-asked"**) — file total **15 passed (15)**
  - *Gap closed HERE: the rung-4 render had no assertion of its own
    (AttendanceResult.tsx:106 was covered only through save-path tests); the
    walk added it, per its mandate.*

- [x] **Row 7 — a labour-owned result screen.**
  - Test: `AttendanceResult.test.tsx` — **15 passed (15)**

- [x] **Row 8 — confirm / correct: बरोबर is the only save event.**
  - Tests: `labourResultOwnership.test.tsx` + `AttendanceResult.test.tsx` —
    **20 passed (20)** ("a labour-intent draft renders AttendanceResult, and
    handleManualSubmit is NOT called by rendering" · "nothing is saved until
    बरोबर; बरोबर saves exactly once")

- [x] **Row 9 — one person, two works = ONE attendance.**
  - Tests: `RecordAttendanceMarkHandlerTests` (incl.
    `Two_disagreeing_engagement_facts_return_Contradicted_and_stage_nothing`,
    `Two_CONSISTENT_facts_ask_nothing`) +
    `BuildHajeriLedgerTests.TwoWorksOneDayIsOneRowOneCellAndNoCountChanges` —
    **12 passed (12)**
  - Safety net on the real database:
    `AttendanceMarkUniqueIndexRealPostgresTests.A_second_canonical_mark_for_the_same_person_day_is_refused_with_23505`
    — **1 passed (1)** (real Postgres)

- [x] **Row 10 — anonymous stays anonymous.** No code path can invent a person
  from a count or a guess: exactly one production door creates a FieldOperator.
  - Test (added by this phase): `FieldOperatorSingleProducerRules.cs` — **1 passed (1)**

- [x] **Row 11 — the register (हजेरी वही) is available throughout.** Never
  gated, never blanked; zero rows still draw the whole week.
  - Tests: `HajeriLedgerTotals.test.tsx` — **17 passed (17)** ("the हजेरी वही
    tile renders on a real farm (no preview, no flag)" · "zero rows still draw
    the week — the empty card sits BELOW the grid, never instead of it") +
    `LabourHub.test.tsx` — **27 passed (27)**
  - Backend: `BuildHajeriLedgerTests` — **14 passed (14)** (incl.
    `ZeroMarksStillRenderTheWholeWeek`, `AnUnmarkedDayIsANullCellNotAbsent`,
    `NightIsANightNeverAFullDayAndNeverASum`,
    `ANoWorkDayStillCarriesItsColumnAndItsMarks`)

- [x] **Row 12 — weekly memory is dimensional, never one number.**
  - Tests: `HajeriCellDetail.test.tsx` — **3 passed (3)** ("reads the week
    dimensionally and never as one number") + `CleanRegisterRules.cs` —
    **2 passed (2)** (the wire contract carries no money and no totals member;
    `AttendanceMark.Value` stays `[Obsolete]`)

- [x] **Row 13 — a worker's future acknowledgement can attach.** R1 builds no
  acknowledgement and forecloses none.
  - Test (added by this phase): `AttendanceAttachabilityRules.cs` — **4 passed (4)**

**Supplementary authority rows (Phase 2 bindings the flow rests on):**

- [x] The जबाबदारी switch: `LabourManagementPermissionTests` — **50 passed (50)**
  (incl. `A_Mukadam_without_a_grant_is_denied_and_only_the_owners_switch_changes_that`)
- [x] The gate end-to-end incl. expiry: `LabourCapabilityGateTests` — **22 passed (22)**
  (incl. `An_expired_grant_denies_forward_and_the_stored_decision_is_untouched`)
- [x] Reads never consult the write gate: `LabourLedgerReadRules` — **1 passed (1)**
- [x] Offline truth (P10): `AttendanceMarkSyncRealPostgresTests` — **2 passed (2)**
  (real Postgres; `AttendanceMark_journey_push_dedupe_amend_and_userscoped_pull`
  proves a mark is reconstructable without the originating device) +
  `attendanceP10.test.ts` — **1 passed (1)** ("walks the whole loop:
  queue-labelled intent, never \"server\", until the pull acknowledges it")
- [x] The two standing questions (D5/D4), encoded:
  `farmerVocabulary.scan.test.ts` — **2 passed (2)**;
  `FarmerFacingVocabularyRules` — **1 passed (1)**;
  `HajeriLedgerClean.test.tsx` — **3 passed (3)**

**Whole-suite close:**

- [x] Architecture tests, full: **107 passed (107)** — was 99 before Phase 5's 8.
- [x] ShramSafal Domain tests, full: **1990 passed, 1 skipped (1991)** — was
  1989 + 1 skipped before Phase 5's duplicate-mark pin (the skip predates this
  release).
- [x] Mobile-web labour scope (`src/features/labour` + the two labour
  navigation suites): **439 passed (439)**.
  *Re-run 2026-09-03 after Task 9 (B001) landed: `npx vitest run
  src/features/labour` alone = **468 passed (468, 41 files)**; the whole
  `src/core/navigation` = **98 passed (98, 20 files)**; `src/infrastructure/
  sync` + `src/features/sync` = **483 passed (483, 41 files)**; `npx tsc
  --noEmit` = **0 errors**. The original 439 was true of the pre-Task-9
  tree; both counts are kept so neither snapshot lies about its date.*
- [x] Mobile-web full (`npm run test`, 332 files): **3333 passed, 2 failed
  (3335)** — both failures are 5000 ms timeouts under full-suite parallel load
  in files this release never touched
  (`mainView.dayUnderstandingOrder.test.tsx`,
  `SyncMutationCatalog.contract.test.ts`); re-run in isolation both are green
  (**8 passed (8)**). Recorded, not hidden: they are load flakes, not
  regressions of this release.
- [x] `npx tsc --noEmit`: **0 errors**.

---

## Three decisions the walk carried (from earlier task reviews)

**1. Duplicate-mark input — the small pin was ADDED.** No production door can
write two marks for the same person-day (the single producer amends-in-place;
the database's unique index refuses a second row with 23505). But if that
invariant ever broke, the ledger builder's cell assignment would silently keep
the LAST mark in list order. That degraded mode is now pinned as a decision,
not an accident:
`BuildHajeriLedgerTests.ADuplicatePersonDayIsLastMarkWinsOneRowOneCellBehindTheIndex`
— one row, one cell, the later statement whole, never a doubled row. Anyone
changing that behaviour must now change a named test that explains what it
guards.

**2. The unfailable testid pin was DELETED.** `HajeriLedgerTotals.test.tsx`
asserted no element with testid `ledger-row-total` exists — but no component
ever had that testid, so the assertion could never fail (a totals column added
under any other name sailed past it). It was removed; the structural owner of
"nothing trails the seventh cell" is `HajeriLedgerClean.test.tsx`, which fails
on ANY trailing element regardless of what it is called.

**3. The one transient the register can show (the acknowledged-but-unpulled
window, from the 3.5 review).**

> **CORRECTED at the final whole-branch review (B001), then BUILT as Phase 4
> Task 9.** When this sheet was first written, the paragraph below described
> behaviour that did not exist: `getLocalAttendanceMarks` had zero production
> callers, an offline-spoken mark appeared NOWHERE until sync, and a
> server-refused mark was invisible forever. Task 9 built the consumption
> this sentence had been promising; every claim below now names the test that
> pins it (all run green on this tree, 2026-09-03, after Task 9's commits).

A mark you speak while offline shows immediately in the register as queue
intent — its stated fact drawn in a dashed amber box with a small clock and
an amber glyph, plus a legend line carrying the app's existing on-phone claim
(`sync.onPhone`, resolved at Marathi: लक्षात ठेवलं ✓ — shipped i18n copy, not
new Marathi) — visibly WEAKER than the solid fill an acknowledged mark earns,
never presented as server truth (P10). The treatment is composed from the
app's own queue vocabulary (the sync drawer's amber+Clock pending card and
the resolved `sync.onPhone` string); no cell-level unsynced treatment existed
anywhere before this, so composing those existing pieces IS the minimal
honest treatment. Pinned by:
`features/labour/__tests__/attendanceOverlay.test.ts` — **10 passed (10)**
(the compose: per-half merge so an unspoken half never erases an acknowledged
fact; a person or date the wire didn't draw still gets its row/column; the
offline register), `features/labour/components/__tests__/
HajeriLedgerUnsynced.test.tsx` — **5 passed (5)** (weaker-never-identical,
the pending marker, the conditional legend, the tap-detail label), and
`features/labour/__tests__/useLabourState.localPlane.test.ts` — **4 passed
(4)** (the hook composes queue intent over a successful GET; a FAILED GET
with local facts renders the register beside the outage banner instead of
the dead-end, `view: 'own'`).

When the phone reconnects there is one brief window: the server has ACCEPTED
the mark (the queue row flips to APPLIED and stops rendering) but the next
pull has not yet delivered the server's own row. For those seconds — normally
within the same sync cycle — that one mark can be absent from the register,
then it returns permanently as server truth. Nothing is lost, nothing is
double-shown (`features/labour/__tests__/attendanceP10.test.ts` — **1 passed
(1)**, the whole loop; `attendanceLocal.test.ts` — **5 passed (5)**, the
live-intent statuses + the attach-time name snapshot).

A mark REFUSED by the server never vanishes silently: a
`REJECTED_USER_REVIEW` row keeps rendering as weaker intent, and the parked
`AttendanceContradiction` now has its answering surface — the labour route
renders the approved question (एक गोष्ट स्पष्ट करा + the `ATTENDANCE_COPY`
body, State D's own card) rebuilt from the device's attributed engagements,
and the answer re-enqueues the SAME queue row with
`resolvedLabourAssignmentId`, speaking only the half the ruling decides
(B002). Pinned by `features/labour/__tests__/attendanceParked.test.ts` —
**9 passed (9)** (park-by-code, question-or-nothing, the exact resolution
payload, the park clears) and `features/labour/components/__tests__/
LabourFeature.contradiction.test.tsx` — **6 passed (6)** (the route renders
the approved copy, answering clears the card, the outage register). The park
carries the server's error CODE on the queue row now
(`infrastructure/sync/__tests__/MutationQueueDurability.test.ts` — **10
passed (10)**, incl. the two Task 9 pins).

This — plus the outage register labelled by the existing banner — is the
honest ordering: we never show "saved" before the server's own copy is on the
phone. One residual, stated: the in-labour manual हजेरी sheet's post-save
refresh (so the register composes the just-made marks) is wired but sits
behind the hard-`false` `SHOW_ATTENDANCE_TILE` door, so no farmer-reachable
surface exercises it today; the voice path re-mounts and re-fetches by
construction.

---

## Rebindings (plan text → tree, per the "tree is the authority" rule)

| # | Plan said | Tree has | Where handled |
|---|---|---|---|
| 1 | 5.1 allowlist without `HoursBasis` | landed Task 2.5 exposes public `AttendanceMark.HoursBasis` | added to the allowlist, comment on the test |
| 2 | Row 2 expects 2 LabourAnchorRules facts | 3 (PIN 3 added by the landed build) | Row 2 records 3 passed |
| 3 | Row 1 drift check `git diff origin/main` (two-dot) | origin/main advanced past the fork (v1.0.10–.12) | three-dot `origin/main...HEAD` = the release's own diff |
| 4 | 3.5 backend test "an offline mark is reconstructable…" | `AttendanceMark_journey_push_dedupe_amend_and_userscoped_pull` (+ non-member fail-closed test) | supplementary row |
| 5 | 3.5 client test "a queued mark is `source: 'queue'`…" | "walks the whole loop: queue-labelled intent, never \"server\", until the pull acknowledges it" | supplementary row |
| 6 | 4.1 test names ("zero named people…", "an unmarked day…", "a Full+Night day…", 4.2 "a no-work day…") | `ZeroMarksStillRenderTheWholeWeek`, `AnUnmarkedDayIsANullCellNotAbsent`, `NightIsANightNeverAFullDayAndNeverASum`, `ANoWorkDayStillCarriesItsColumnAndItsMarks` | Row 11 |
| 7 | Row 11 title "zero rows still draw the week" | extended: "…— the empty card sits BELOW the grid, never instead of it" | Row 11 |
| 8 | 5.3 reads `HajeriLedger` props `{ data; onToast }` | tree adds optional `onOpenCell?` | no change needed; the doc's render calls typecheck |
| 9 | "only other textual hit of `FieldOperator.Create(` is a doc comment in FieldOperator.cs" | zero other literal hits on HEAD (the definition line reads `FieldOperator Create(`) | pin green either way |
| 10 | vocabulary-scan Step 2 expects RED on "Comes with their role" | Phase 2's D5 copy landed first; the offender is gone | scan GREEN; bite-proof done instead (see below) |
| 11 | CleanRegisterRules Step 5 expects RED on `Total`/`WeekTotal`/`DailyTotals` | Phase 4.4 landed first; the DTO graph is clean and `Value` is `[Obsolete]` | 2 passed — the acceptance bar was already cleared |
| 12 | cosmetic pin "HajeriLedgerTotals.test.tsx:100" | line 45 on HEAD (file reshaped since the review) | deleted (decision 2 above) |

**Deviations inside Phase 5's own verbatim code (each scope-preserving, each
bite-proven):**

- **5.1/E2:** the negative GRANT regex now runs on comment-stripped migration
  source. The migration's own comment ("ENFORCED BY THE GRANT … never UPDATE
  or DELETE") spans to the real GRANT with no intervening semicolon and
  tripped the plan's raw-source regex — prose failing a build, which the
  phase's own idiom section forbids.
- **5.3 scan:** template-interpolation placeholders (`${ON_PHONE_MR}`) are
  stripped before matching — they are code identifiers (the farmer sees the
  resolved i18n Marathi), and the identifier's `ON` tripped the hardcoded-
  ON/OFF regex on three `ReviewSheet.tsx` Marathi toasts.
- **5.3 scan:** the JSX-text `[A-Za-zऀ-ॿ]` class is split into two
  tests (`/[A-Za-z]/ || DEVANAGARI`) — ESLint's
  `no-misleading-character-class` (max-warnings 0 in pre-commit) forbids a
  combining mark sharing a class with base characters. Same match set.
- **5.3 scan bite-proof:** the plan's suggested plant ("Comes with their
  role" as the ternary literal) is invisible to the scan's own scope rules (a
  Latin-only literal in a JSX expression is neither a Devanagari literal nor
  a JSX text node); the bite was proven by planting `role` inside the
  Devanagari literal instead — the exact D5 failure mode — RED with the
  offender named, then reverted GREEN.

**Bite-proofs run (each: plant → RED with the named message → revert → GREEN):**
5.1(a) `WorkerAcknowledgementId` plant → fails with the verbatim sentence
"R1 has closed the door Correction 10 asked us to leave open." · 5.2-G1 wrong
expected path → fails naming `CreateFieldOperatorHandler.cs` · 5.3 scan →
`role` in a Devanagari literal · 5.3 render → `₹0` planted in the row loop →
"renders no ₹ anywhere" RED.

---

## Founder Acceptance Gate

- [ ] **Founder:** I walked this sheet, the claims match what I asked for in
  the master review, and the counts above are the pointers I verify against.
  (code-complete ≠ approved; nothing merges without this tick)

## Gate conditions carried from the internal ledger (M1, final review)

- **Branch CI: RUN AND GREEN on the required check.** Branch pushed; draft PR #75 opened
  to trigger CI; `gate` — the single required check on `main` — **passes**, as do
  `backend`, `build-test`, `frontend`, `mobile-web`, `contract-tests`, `arch-tests`,
  `eslint`, `mobile-web-lint`, `regen-and-diff`, `security`, both CodeQL analyses, and
  gitleaks.

  **CORRECTION to the condition recorded at the Task 2.1 review.** That review required "the
  8 Docker-only suites green in branch CI". That is not achievable in this repo and never
  was: **no CI job runs `Category=RequiresDocker` at all** — `ci-gate.yml:74` and
  `dotnet-ci.yml:112` both exclude it repo-wide, with the stated reason that the
  Testcontainers LocalStack/S3 suites are chronically red, and `ci-gate.yml:95` deliberately
  carves out three named Postgres-only isolation tests it does run. This branch changed none
  of that; the exclusion predates it.

  **What matters is that it does not hide this release's proofs.** Every labour and
  attendance guarantee is proven by `RequiresPostgres` suites, which DO run in CI and passed
  there — verified by name in the `backend` job log:
  `AttendanceMarkSyncRealPostgresTests` (the offline journey: push → dedupe → amend →
  user-scoped pull; non-member fails closed with zero rows),
  `AttendanceMarkUniqueIndexRealPostgresTests` (the 23505 safety net),
  `LabourAssignmentParentIntegrityRealPostgresTests` (engaged-through FK; dangling operator
  rejected), and the full `LabourCapabilityGrantRealPostgresTests` matrix — including
  *"an existing Mukadam row is untouched and reads as OFF, no backfill"* and *"an expired
  grant is denied by the real SQL predicate and nothing is rewritten"*.

  **Two checks are red and neither is this branch's:** `eval` fails because its job starts
  the API against a Postgres service on port 5432 while the app connects to 5433 — a
  workflow/config mismatch in a file this branch never touched; and `e2e` was **also red on
  PR #74**, the last PR merged to `main`, so it is the established baseline rather than a
  regression. (The bare `CodeQL` 2s stub is likewise pre-existing; both real CodeQL analyses
  pass.) Neither is the required check.
- **Footnote on the D6 breakdown:** engagements whose arrangement was never voiced bucket
  as रोजंदारी by the spec's own definition — the home line may say "x रोजंदारी" over
  engagements that never said the word. Copy stands unless the founder wants a third word
  for "unstated" (gate copy item, optional).

## Preview-door items awaiting the founder (C2, final re-verdict)

All three sit behind the hard-`false` attendance-capture door (`SHOW_ATTENDANCE_TILE`) —
no farmer can reach them today — and must be decided before that door ever opens:

- the save button still reads **"जतन करा → मंजुरीसाठी"** though no approval step rides a
  mark — keep the promise (build an approval step) or change the copy;
- the **"आज किती लोक आली?"** counter collects a number the save silently discards —
  wire it or remove it;
- **"नाव जोडा"** only shows a toast — build the add-person flow or remove the button.

---

# Closure round — 2026-09-03 (founder direction of the same date)

Six closure commits sit on top of the release: `4c1bd756` `df2e9268` `21cbf661`
`35087e6c` `af9fe23e` `83d012ec`. **This section describes the exact HEAD that will
merge.**

## 1. The economic model was WRONG and is now fixed

The founder corrected the model: रोजंदारी and उक्ते describe the **basis on which the
farmer owes money**, never the identity, frequency or naming of a person. He warned that
`ContractUnit == null → रोजंदारी` might not be sufficient. **He was right — three of his
seven cases failed.**

| Case | Scenario | Before | After |
|---|---|---|---|
| A | 6 unnamed workers, no agreement | PASS | PASS |
| B | worker appears once in a season | PASS | PASS |
| C | मुकादम brings 8, no agreement | PASS | PASS |
| **D** | मुकादम brings 8 **under an उक्ते agreement** (no unit) | **FAIL** — read as day-rate | **PASS** |
| **E** | fixed **₹15,000 whole job, no measurement unit** | **FAIL** — ₹15,000 on the day-rate card | **PASS** |
| **F** | 4 day-rate + 8 उक्ते, same plot & day | **FAIL** — 12 day-rate, ₹16,200 combined | **PASS** — 12 total, 4 + 8, never combined |
| G | day-rate headcount, rate unknown | PASS — no ₹0, no invented amount | PASS |

The fix is one predicate reusing `EngagementType`, a field that already exists, is NOT
NULL on every row, and already travels on the wire: an engagement is उक्ते when it is
typed as a contract **or** carries a measurement unit. **No new column, no migration, no
wire change, no client change.** Pinned by `UkteDiscriminatorTests` — 7/7, measured at
3-failed before the change.

## 2. Farmer-facing vocabulary — the dignity rule applied

Internal names are untouched by design. On screen: farmer-facing **"Labour" /
"Labour Management" is gone**, and **रोजंदारी no longer appears as a category of person**.
The day-rate half now reads `दिवसाच्या हिशोबाने` — the founder's own provisional
illustration, explicitly **not** a naming decision. `उक्ते काम` stays. Nothing else was
renamed; ambiguous `मजूर` / `कामगार` occurrences are **flagged, not replaced**, for the
naming session. The Phase 5 vocabulary scan gained a farmer-facing `Labour` ban, proved by
a negative control (re-inserting `· Labour` turns it red).

Full audit — 453 farmer-facing strings, 259 unique terms, 15 founder decisions:
`docs/superpowers/plans/precision/farmer-facing-vocabulary-audit.md`

## 3. The membership read boundary — VERIFIED, NOT MET, and it is the founder's call

All three gates between a caller and the register filter on **non-terminal**
(`status NOT IN (5,6)`), none on **operationally active**. So `PendingOtpClaim`,
`PendingApproval` and **`Suspended`** still reach the register today. The founder's stated
expectation is therefore **not met**.

**No behaviour was changed.** The smallest centrally-owned fix would alter **eight other
feature areas plus the RLS layer** — far outside Labour V2, and not a change to make
quietly at a release gate. What landed instead is a `RequiresPostgres` suite pinning all
six statuses, so today's behaviour is documented and any drift breaks a test.
**This is the one item genuinely awaiting a founder decision.**

## 4. The unfinished manual door — proven shut

`Attendance.tsx` is imported in exactly one place and rendered in exactly one place; the
route trace found **no second door**. A test now fails if it opens for a real farm. The
three unfinished controls are held in one named follow-up:
`docs/superpowers/plans/precision/followup-manual-attendance-door.md`

## 5. Release size — both numbers, reconciled

| | PR base (`origin/main...HEAD`) | Historical base (`a7784b18..HEAD`) |
|---|---|---|
| Answers | what merging changes in `main` | how far the tree moved since work began |
| Commits | **128** | **137** |
| Files | **333** | **403** |
| Matches GitHub PR #75 | **yes, exactly** | no |

Use the PR base for the merge decision. Detail:
`docs/superpowers/plans/precision/reports/closure-stats-report.md`

## 6. Final CI, against the exact commit that will merge

`83d012ec` — **`gate` PASSES** (the single required check on `main`), with `backend`,
`build-test`, `frontend`, `mobile-web`, `contract-tests`, `.NET Architecture Tests`,
`mobile-web-lint`, `admin-web-lint`, `marketing-web`, `regen-and-diff`, `scan`,
`Frontend Layer Tests`, `Dependency Review`, gitleaks and **both** CodeQL analyses.

Three red, none of them this release: `e2e` (**also red on PR #74**, the last merge to
`main`), `eval` (its job starts the API against Postgres on 5432 while the app dials 5433 —
a workflow this branch never touched), and the bare `CodeQL` 2s stub (the two real analyses
pass). None is the required check.

Local gates at the same commit: Domain **2005 passed / 1 skipped**, Architecture **107**,
labour + related vitest **519**, `tsc` **0 errors**, RealPostgres labour set **100**.
