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
