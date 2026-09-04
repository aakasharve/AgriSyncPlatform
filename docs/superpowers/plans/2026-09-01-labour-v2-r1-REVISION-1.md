# Labour V2 R1 — REVISION 1 (modified sections only)

**Status:** awaiting founder approval. NOT yet spliced into the plan.
**Plan it revises:** `2026-09-01-labour-v2-r1-human-execution-layer.md` (same folder).
**Produced by:** four independent expert passes (CTO / cross-verifier / data engineer /
design expert) against your 11 corrections, then one integrator. 67 findings.

**One founder ruling is already applied here:** your 2026-09-01 answer (b) on money —
D-H6 stands, the register IS the wage book, and Correction 9 forbids the system
CALCULATING a wage, not the register SHOWING an amount you stated. The experts were
briefed before that ruling and had written "money is outside R1" in five places;
all five are corrected.

Each section below says exactly which part of the plan it replaces.

---
# Founder Final Direction — 2026-09-01 (binding)

**"Do not restart the plan."** REVISION 1 is accepted as conceptually close enough. The 15
corrections are applied below. Execution order is fixed:

> Phase 0 verification → founder-approved visuals → exact implementation plan → build.

## Phase 0 MAY decide (engineering truth only)

- the exact anchor provenance available in the repo
- the smallest engagement-scoped representation for the Labour Mukadam relationship
- the existing primitives usable for extra time and explicit hours
- the repo-native attendance write / sync route
- the exact permission changes required
- the existing access and privacy boundaries

## Phase 0 may NOT reopen — these are founder decisions ALREADY MADE

1. whether all five attendance realities belong in R1 — **they do**
2. whether offline attendance belongs in R1 — **it does**
3. whether Mukadam authority is owner-controlled — **it is**
4. whether temporary delegation belongs in the pilot — **it does**
5. whether हजेरी is always available independent of capture state — **it is**
6. whether the Labour Mukadam relationship matters — **it does**
7. whether no-work attendance is valid — **it is**
8. whether generic voice may discover Labour information — **it may**
9. whether Labour voice is verification-only — **it is**

**Phase 0 returns only findings that force a change in implementation. It returns no
settled product questions.** A finding that contradicts one of the nine is escalated as a
repo-truth conflict with file:line evidence — never as a question to re-decide.

## Final acceptance, asked of every interaction and every stored fact

> **Did ShramSafal remember enough that the farmer had to tell us less than before?**
>
> **Did we preserve farm reality without inventing certainty?**

If both are yes, proceed.

---

# REVISED PLAN SECTIONS — Labour V2 R1

## Resolutions of expert disagreement (stated, not averaged)

| Conflict | Taken | Why |
|---|---|---|
| **Crew representation.** CTO: no new anything (`WorkerCount` + `WorkerNamesJson` suffice). Crossverifier: adopt spec D16's `accompanying_count` on `attendance_marks`. DataEngineer: reject D16, add `engaged_through_field_operator_id` FK on `labour_assignments`. | **DataEngineer's rejection of D16, but NOT his FK.** All three pre-decide, and Correction 7 says Phase 0 must *find* the smallest representation. Converted to a Phase 0 investigation with all three candidates named and the D16 defect recorded. | D16's `accompanying_count` on the mark is provably wrong: `attendance_marks` is unique on `(farm_id, field_operator_id, work_date)` (`Migrations/20260831180408_AddAttendanceMarks.cs:41-44`) but a crew count is per-engagement — Shankar bringing 8 to grapes and 4 to cane on one day would have to store an invented 12. That is a repo-verified rejection, so it goes in. The FK is a *good* candidate, not a verified necessity, so it does not. |
| **Anchor definition.** CTO: `DailyLog.CurrentVerificationStatus != Draft` + non-null `WorkerCount` (zero schema change). Crossverifier/DataEngineer: add `headcount_certainty` + `headcount_spoken_text` columns mirroring the cost pair. | **CTO's, with the column pair kept as the named fallback.** | Correction 3 says the anchor is "human-stated **or accepted**". A confirmed log *is* acceptance, and `CurrentVerificationStatus` (`DailyLog.cs:106-111`) already carries it with no migration. The column pair is only needed if Phase 0 finds the confirm screen never actually shows the headcount to the farmer — so it becomes a conditional Phase 0 question, not a scheduled build. |
| **`SHOW_LEDGER_TILE`.** CTO: delete the constant and the `|| isPreview` escape. Crossverifier: flip it to `true`. | **CTO's deletion.** | A constant that can be flipped back is a switch, and Correction 5 says the ledger "may never" be gated. Deleting the branch is the only version that survives a future executor. |
| **`AttendanceMark.Value`.** CTO/crossverifier: delete or rename. DataEngineer: `[Obsolete]`, defer, remove consumers from the read path. | **DataEngineer's.** | Correction 9 says do not pre-decide night arithmetic. Deleting `Value` is itself a decision; marking it obsolete and keeping it out of the R1 read path leaves the founder's ruling genuinely open. |
| **Task 1.5 (worker confirmation mockup).** CTO: "demote or cut". Crossverifier: "cut to a single frame or defer". Design: "remove entirely, record intent in Appendix A". | **Design's — removed entirely.** | With Task 5.1 reduced to an architecture test, R1 builds nothing this screen would describe. A gate on an unbuilt concept is exactly the misallocation Correction 2 names. |

**Marked UNVERIFIED (asserted without file:line, not adopted):**
- Crossverifier: "the governing spec's offline ruling makes attendance capture offline-mandatory." I confirmed `SyncMutationCatalog.cs` has no attendance descriptor and `LabourEndpoints.cs` has no attendance route, but the claim that R1 *must* ship offline attendance rests on spec P10, which says offline capture is required in general — it does not name attendance. **UNVERIFIED as an R1 obligation.** Recorded as a Phase 0 question, not a task.
- Design: "the approved decisions were made against interactive mockups that are not in this repo." I confirmed no `.html` exists under `docs/` on this branch. Whether approved mockups exist *elsewhere* is **UNVERIFIED** — the plan must ask the founder, not assert their absence.

---

## 1. Replaces: `## Global Constraints` → the block `**Additional locks from 2026-09-01:**` (plan lines 40–52)

**Serves corrections 5, 9, 11.**

```markdown
**Additional locks from 2026-09-01:**

- **One control, not a matrix.** The owner decides *once* whether a person may
  manage labour on this farm — "Allow Labour Management", yes/no. Temporary
  delegation is that same control with a duration attached, never a second
  permission model. No attendance-specific flag, no responsibility set, no RBAC.
- **Role ≠ authority — and today the code disagrees.**
  `LabourManagementPermission.IsCarriedByRole` (LabourManagementPermission.cs:85-86)
  includes `AppRole.Mukadam`, and `SetLabourPermissionHandler.cs:110-113` REFUSES an
  owner who tries to switch it off. "The owner may keep him as mukadam with the
  authority OFF" is **impossible in the shipped code**. Phase 2 makes it possible.
- **Temporary delegation is pilot scope.** "Today only" / "until Sunday" must work.
  No expiry concept exists anywhere on membership or grant — greenfield, verified.
- **Three of the five day realities are expressible today.** `DayMark` is
  `{Unmarked, Full, Half, Absent}` and `NightMark` is `{Unmarked, Worked, NotWorked}`
  (AttendanceMark.cs:165-182); `attendance_marks` has `day_mark` and `night_mark` and
  no duration column (Migrations/20260831180408_AddAttendanceMarks.cs:19-27).
  **EXTRA TIME and SPECIFIC HOURS have no representation — and that is now an
  IMPLEMENTATION GAP, not a founder question.** All five realities are R1 (founder
  final direction, 2026-09-01 §1). Phase 0 finds the smallest repo-native storage;
  it does not ask whether they belong. Hours are stored **as stated** and are never
  auto-converted into day fractions.
- **Night arithmetic is NOT decided.** `AttendanceMark.Value` (AttendanceMark.cs:151-158)
  already returns Full+Night = 2 and `AttendanceMarkTests.cs:126` pins it. That is a
  shipped interpretation, not a locked truth. R1 must DISPLAY day and night as two
  preserved facts. No R1 read path may consume `Value`.
- **The week is NOT collapsed into one number** (final direction §2). Full, Half, Night,
  Extra Time and Explicit Hours stay DISTINCT facts unless the farmer explicitly said
  something that makes them equivalent. A week reads dimensionally — conceptually
  `5 पूर्ण / 1 अर्धा / 2 रात्री / 3 तास जादा`, exact treatment being a Phase 1 decision —
  never a single invented `6.5`. `AttendanceMark.Value` may not be used to manufacture
  that equivalence.
- **Money is DISPLAYED but never CALCULATED** (founder ruling 2026-09-01, option b,
  overturning the panel's reading of Correction 9). D-H6 stands: the register IS the
  wage book, and D-H7's "every row ends in the week's money" is R1 scope. What
  Correction 9 forbids is the system *computing* a wage — no rate x days, no derived
  settlement, no arithmetic that invents a figure nobody said. An amount renders only
  where the farmer STATED it, carried through unchanged (doctrine P4 no fabricated
  numbers; P7 attribution never changes a reported quantity). A week with no stated
  amount renders blank — never zero, never computed.
- **The ledger DESIGN is approved; the ledger COMPONENT does not implement it.**
  `HajeriLedger.tsx:33-44` renders one 26px cell taking a single tri-state
  (`PresenceStatus = 'present' | 'half' | 'absent'`, labour.types.ts:47) — no night
  half (D-H3), no crew grouping (D-H1/D-H2). Phase 4 must build the split cell. This
  is not reopening a decision; it is finishing one.
- **The हजेरी ledger is never gated BY CAPTURE STATE** (final direction §7 — a precise
  correction). It must not disappear because there is no Work Log, no headcount, no marks,
  an incomplete capture, or a no-work day. The MIC may be gated by the anchor; the LEDGER
  may not. Unknown renders blank, never zero, never `–`.
  **This is NOT a statement about who may read it.** Existing farm access and privacy rules
  still govern which actors may see attendance and stated money. Labour V2 does not redesign
  farm privacy, and membership alone is not asserted to authorise reading anything.
- **Farm Mukadam ≠ Labour Mukadam.** Farm Mukadam = `AppRole.Mukadam`
  (AgriSync.SharedKernel/Contracts/Roles/AppRole.cs:6), a farm-membership role,
  account-bound, governs authority. Labour Mukadam = a `FieldOperator`
  (FieldOperator.cs:59-77), needs no account, is a work identity only. No code path
  in attendance or crew work may read `AppRole.Mukadam` to mean Labour Mukadam.
- **Labour mic is a verification instrument.** No explicit labour anchor → no mic.
- **The invoking feature owns the result surface.** Today it does not: a labour parse
  is AUTO-SUBMITTED with no confirmation screen (AppRouter.tsx:214-228), while
  `useVoiceRecorder.ts:624` still promises "never skip to auto-save". Phase 3 fixes it.

**Out of scope for R1 (founder §25, restated):** wage calculation · payroll ·
settlement · reputation · worker scoring · permanent crew identities · marketplace ·
attendance prediction · biometric attendance · mandatory worker accounts ·
per-person-per-task timesheets as a farmer workflow · generic RBAC redesign ·
**a worker acknowledgement channel**.
```

---

## 2. Replaces: `## File Structure` (both tables, plan lines 56–82)

**Serves corrections 1, 5, 6, 7, 10.**

```markdown
## File Structure

**Already exists — reuse, do not duplicate:**

| File | Responsibility |
|---|---|
| `ShramSafal.Domain/Farms/FarmMembership.cs` | who a human is *on this farm*; carries `CanManageLabourRecords` (:81). **TODAY it is un-settable for Mukadam and owner-tier** — R1 must make it authoritative for Mukadam. |
| `ShramSafal.Domain/Farms/LabourManagementPermission.cs` | the effective allow decision. `IsCarriedByRole` (:85-86) currently includes Mukadam — that is what Phase 2 removes. |
| `ShramSafal.Application/Services/LabourManagementGate.cs` | the shared predicate. `IsAllowedAsync` (:60-80) is `static` and takes **no clock** — Task 2.2 must thread one in. Five call sites listed at :12-19. |
| `ShramSafal.Domain/Labour/FieldOperator.cs` | work identity **without** an account — name alone is enough (`Create` at :79). No "who brought him" link exists (:59-77). |
| `ShramSafal.Domain/Labour/FieldOperatorWorkRow.cs` | attribution overlay. Grain is person × **engagement** (:21-24), so one person on two works on one date yields two rows. |
| `ShramSafal.Domain/Farms/LabourAssignment.cs` | the engagement. `WorkerCount` (:63) is the reported quantity; `WorkerNamesJson` (:97) is descriptive only and plays no part in counting (:107-109). `CostCertainty`/`CostSpokenText` (:130,:133) are the provenance pairing idiom — **`WorkerCount` has no such sibling**. |
| `ShramSafal.Domain/Labour/AttendanceMark.cs` | **built 2026-08-31** — one ruling per person per farm-day. Carries no engagement or log reference (:67-93), which is what makes Correction 8 free. |
| `ShramSafal.Domain/Labour/AttendanceMarkCorrection.cs` | **built 2026-08-31** — a separate append-only table pointing at a mark by `AttendanceMarkId` (:73). **This is the attach pattern Correction 10 relies on.** |
| `ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs` | the ledger read. `BuildHajeriLedger` at :809, called at :713. Authorises on membership alone (:170-178) and never gates the read on the labour grant — **Correction 11 is already satisfied server-side.** |
| `features/labour/components/HajeriLedger.tsx` | the CURRENT single-axis register (present/half/absent/null, :33-44). **NOT the D-H3 approved design** — the split cell is unbuilt, and the screen is unreachable (:47). |
| `features/logs/attendanceDraft.ts` | keeps a labour parse out of the Work Log's buckets (:45-65). Note :60-63 discards `disturbance` — Task 4.2 must reckon with that. |

**Persistence that already exists (do NOT rebuild):**
`ShramSafalDbContext.cs:148,151` (both DbSets) · `IShramSafalRepository.cs:919,930,936`
(three port methods) · `ShramSafalRepository.cs:1577,1597,1606` (implementations) ·
both migrations with RLS **enabled and forced** plus grants.

**Genuinely missing on the write path:** the use case, an HTTP endpoint on
`ShramSafal.Api/Endpoints/LabourEndpoints.cs` (no attendance route exists), and a
`SyncMutationDescriptor` in `Contracts/Sync/SyncMutationCatalog.cs` (no attendance
descriptor exists). Whether offline attendance capture is an R1 obligation is
**UNVERIFIED** — routed to Task 0.3 Q6, not scheduled.

**To create:**

| File | Responsibility |
|---|---|
| `docs/superpowers/mockups/2026-09-01-labour-r1/` | the approval screens (Phase 1). **This directory does not exist** — Task 0.1 Step 5 creates it. |
| `ShramSafal.Application/UseCases/Labour/RecordAttendanceMark/` | command, handler, result |
| `features/labour/components/AttendanceResult.tsx` | the Labour-owned parse result surface |

**Deliberately NOT created:** no `LabourCrew.cs` — Correction 7 rules out a persistent
crew entity, and Task 0.3 Q2 finds the smallest representation among existing
primitives. No `FarmResponsibility.cs` — Correction 1 rules out a responsibility set;
the one control is `CanManageLabourRecords`. No acknowledgement field on
`AttendanceMark` — Correction 10 locks attachability, not a field.
```

---

## 3. Replaces: `### Task 0.1: Make the governing specs reachable` — Steps 3 onward

**Serves corrections 2, 7, 9 (gives Phase 0 a checkable floor).**

```markdown
- [ ] **Step 3: Verify both are non-empty and complete — exact counts, so the check can fail**

```bash
grep -c "^## D[0-9]" docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md   # expect 15
grep -c "D-H[0-9]"   docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md          # expect 23
grep -n  "^## .*D-H" docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md          # expect D-H1..D-H10
```

`grep -c "^## D-H"` returns **9**, not 10 — D-H10's heading is `## 🔴 D-H10 —` and the
emoji defeats the anchor. Do not read 9 as a truncated copy.

- [ ] **Step 4: Record this branch's migration inventory verbatim in the plan's Phase 0 findings**

```bash
git log --oneline main..HEAD --name-only -- src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/
```

Expected — three additive migrations, **none of which any correction reverts**:
1. `20260831155124_GrantFieldOperatorWorkRowsToAppRole` — grants only. KEEP.
2. `20260831180408_AddAttendanceMarks` — creates `ssf.attendance_marks`, RLS ENABLE **and**
   FORCE (:51-57), grants (:82-94), `ux_attendance_marks_farm_operator_day` unique (:41-44).
   KEEP — that unique index is what makes Correction 8 safe by construction.
3. `20260831185516_AddAttendanceMarkCorrections` — append-only enforced at the GRANT
   (SELECT + INSERT only). KEEP — it is the proof-of-pattern Correction 10 relies on.

Record also: `attendance_marks` holds no PII of its own and the erasure worker's
disposition is already written (`Infrastructure/Privacy/ErasureWorker.cs:196-217`).
Any column added later must keep that true — a name snapshot would not.

- [ ] **Step 5: Create the mockup directory Phase 1 writes into**

```bash
mkdir -p docs/superpowers/mockups/2026-09-01-labour-r1
```

- [ ] **Step 6: Commit**
```

---

## 4. Replaces: `### Task 0.2: Verify the permission floor`

**Serves correction 1.**

```markdown
### Task 0.2: The permission floor — three findings already established, one open

**Files:** Create `docs/superpowers/plans/2026-09-01-labour-r1-VERIFICATION.md`

**Do not re-discover these three. Record them, with the evidence, and move on:**

1. **CONFIRMS PLAN** — `CanManageLabourRecords` is persisted and settable:
   `FarmMembership.cs:81`, `SetLabourRecordManagement` at :311-321; full stack shipped —
   `GET/PUT /shramsafal/farms/{farmId}/labour-permissions[/{userId}]`
   (`MembershipEndpoints.cs:220-221`), client (`labourPermissionsClient.ts:7-8,:145-150`),
   hook (`useLabourPermissions.ts:71,:124-131`), and a per-member switch already rendered
   on the profile team list (`IdentitySection.tsx:492-503`).
2. **CORRECTS PLAN** — a Mukadam holds labour authority **by role** and the owner cannot
   switch it off. `LabourManagementPermission.IsCarriedByRole` (:85-86) includes
   `AppRole.Mukadam`; `IsAllowed` (:94-95) is role OR grant; `IsRedundantGrantTarget` (:117)
   makes `SetLabourPermissionHandler.cs:110-113` **refuse** the owner with
   `ShramSafalErrors.LabourManagementCarriedByRole`. Correction 1's "keep him as mukadam
   with the authority OFF" is impossible today. This is Phase 2's real work.
3. **CONFIRMS PLAN** — no expiry concept exists. Grep of `FarmMembership.cs` for
   `Expire|ExpiresAt|ValidUntil` returns nothing; the only `ValidUntilUtc` in ShramSafal is a
   subscription (`GetMyFarmsHandler.cs:16`), which `LabourManagementPermission.cs:32-38`
   deliberately excludes from labour. Temporary delegation is greenfield.

**The one genuinely open question:**

4. `IdentitySection.tsx:466-468` states that the two permission states render in **English**
   because no Marathi was ever approved. What are the founder's Marathi words for
   "Allow Labour Management" ON and OFF? Do not invent them.

- [ ] **Step 1: Record findings 1-3 with evidence; carry question 4 to the Task 0.5 gate**
- [ ] **Step 2: Commit**
```

---

## 5. Replaces: `### Task 0.3: Verify the identity and crew floor`

**Serves corrections 6, 7, 9, 10.**

```markdown
### Task 0.3: The identity and crew floor — find the smallest representation

**Findings to record (established, do not re-derive):**

- **`FieldOperator` needs only a name.** `FieldOperator.Create` (:79) requires a display
  name; `FullName` is nullable; there is no linked-user column (:59-77).
- **No Labour-Mukadam primitive exists.** `grep -rni mukadam ShramSafal.Domain/Labour/`
  returns zero. The only thing named Mukadam in code is `AppRole.Mukadam`
  (`AppRole.cs:6`), a farm-membership role — and `GetLabourDataHandler.cs:191-194`
  already renders `Mukadam || Worker` memberships as labour "People", which is exactly
  the confusion Correction 6 forbids. **CONSTRAINT, not a question:** any crew link is a
  `FieldOperatorId`, never an `AppRole`. Both may be the same human on the same day and
  must remain two rows in two tables.
- **`AttendanceMark` has no acknowledgement field** (:67-93) — the Correction 10 slot,
  and the reason Phase 5 is a test rather than a build.

**Q2 — an ENGINEERING question, not a product one. The semantic requirement is FIXED
(final direction §3): the record must preserve THROUGH WHOM the anonymous workers came,
or the Mukadam-wise हजेरी view cannot exist truthfully. Counts are ENGAGEMENT-SCOPED —
Shankar with 8 on grapes and 4 on cane is two engagement-scoped facts, NEVER "12 unique
workers for the day", and never an aggregate on Shankar's own farm-day mark. Do not create
a permanent `Crew`. Find the smallest repo-native shape:**

| Candidate | What it costs | Known objection |
|---|---|---|
| (a) Nothing new — `LabourAssignment.WorkerCount` (:63) is 9 with `WorkerNamesJson` (:97) = `["Shankar"]` | zero | **ELIMINATED by final direction §3.** Loses "through whom": a reader cannot tell Shankar organised the 8 from Shankar merely being named first. The founder has ruled the relationship is required, so a representation that cannot express it is not a candidate. |
| (b) One nullable FK on the engagement: `labour_assignments.engaged_through_field_operator_id uuid NULL` | one column, one migration, no entity | **LEADING CANDIDATE** — engagement-scoped by construction, which is exactly what §3 requires. The anonymous remainder stays arithmetic (`WorkerCount − distinct attributed operators`), so no fabricated worker row can exist. Phase 0 confirms or beats it on repo evidence; the founder does not choose the column. |
| (c) Spec D16's `accompanying_count` on `attendance_marks` | one column | **REJECTED by repo truth.** `attendance_marks` is unique on `(farm_id, field_operator_id, work_date)` (`Migrations/20260831180408_AddAttendanceMarks.cs:41-44`), but a crew count is per **engagement**. Shankar bringing 8 to grapes and 4 to cane on one day must store an invented 12 — asserting 12 unique people, which D9.12 forbids — or silently drop one. It also duplicates `WorkerCount`, giving one fact two editable homes. **Record this rejection in the plan; the spec is wrong here.**

- [ ] **Step 1: Recommend the smallest shape that satisfies §3, with file:line evidence.
      Report it as an engineering finding, not a founder question. Do NOT implement it in
      Phase 0 — Phase 2 or 4 builds it once Phase 1 has drawn the Mukadam-wise view.**

**Q3 — `AttendanceMark.Value` (AttendanceMark.cs:151-158) pre-decides the night arithmetic
the founder has just unlocked, and carries a second defect:** it maps both `Absent` and
`Unmarked` to `0m`, and `AttendanceMarkTests.cs:57,:71` assert that as intended — "he did
not come" and "nobody said" are indistinguishable in arithmetic, which is trust rule 3
failing inside the one number the ledger would show. Name every consumer. Recommendation to
put to the founder: mark it `[Obsolete]` with the reason and keep it out of every R1 read
path — do not delete it (deleting is itself a ruling on Full+Night) and do not consume it.

**Q4 — Extra time and specific hours have no column** (`DayMark`/`NightMark` at :165-182;
migration columns at :19-27). State as **CORRECTS PLAN**. **SETTLED (final direction §1): all five realities
are R1.** This is no longer a choice — it is a missing capability to be sized. Find the
smallest repo-native shape and recommend it; the leading candidate is `hours numeric(4,1)
NULL` plus an `hours_basis` reusing the existing `LabourTimeBasis {Unspecified, Assumed,
Explicit}` (`Farms/LabourTime.cs:18-30`, verified present), stored as stated and **never
back-derived into a day fraction**. Extra time and specific hours are distinct facts, not
modifiers of Full/Half. Phase 2 gains the migration task regardless of shape.

**Q5 — Is there a Labour- or Farms-side no-work-day primitive?** Verified: none.
`DayClassification.DeclaredNoWorkDay` (`Domain/Dfes/DayClassification.cs:18`) exists only in
the Dfes context. **SETTLED (final direction §4), and confirmed in code:** `DailyLog` is the FACTUAL
record of the farm day, not a record of completed work — `DailyLog.DayOutcome`
(`Logs/DailyLog.cs:811,:819`) already carries the vocabulary
`WORK_RECORDED | DISTURBANCE_RECORDED | NO_WORK_PLANNED | IRRELEVANT_INPUT`
(`Contracts/Dtos/DailyLogDto.cs:134`), and `NoWorkReasonCode` / `DeclaredNoWork` machinery
exists (`DfesLensExtractor.cs:223,:237-238,:531`). So a no-work day is already a legitimate
`DailyLog`, and `DisturbanceEvent` requiring a `DailyLogId` is not an obstacle. Spec D11
stands: reuse `Disturbance`, invent no second reason taxonomy, fabricate no productive work.
**The remaining job is narrow: ensure the existing day/disturbance truth SURVIVES the
attendance flow** — today `attendanceDraft.ts:63` discards it. Report the route, not a question.

**Q6 — Offline attendance IS R1 (final direction §5). Do not ask again.** Attendance is a
core farm-operation fact in an offline-first rural app, so an authorised person must be able
to mark it without connectivity. `SyncMutationCatalog.cs` has no attendance descriptor and
`LabourEndpoints.cs` has no attendance route — that is the gap to be filled, not evidence
against the obligation. **Find the repo-native route** (the existing mutation-descriptor and
queue pattern) and report it; do NOT design a second offline system. Trust semantics are
fixed: an offline action is LOCAL INTENT until server acknowledgement makes it DURABLE
SYNCHRONISED TRUTH, and the UI must not claim the stronger state before the weaker one
resolves.

- [ ] **Step 2: Answer all with file:line, mark CONFIRMS/CORRECTS, commit**
```

---

## 6. Replaces: `### Task 0.4: Verify the capture floor`

**Serves corrections 3, 4, 11.**

```markdown
### Task 0.4: The capture floor — two findings confirmed, three open

**Confirmed, record and move on:**

- **Q1 CORRECTS PLAN — no gate exists.** `simpleRoutes.tsx:83-89` (`onGoToLog`) sets
  `logIntent = 'labour'` and routes to `'main'` with **no condition**. That line is where the
  anchor gate belongs. The hero it hangs off is `LabourHub.tsx:325-334`.
- **Q2 CONFIRMS PLAN — hiding, not owning.** The labour parse renders in the generic
  `ManualEntry` with an `attendanceOnly` flag that only decides what is DRAWN
  (`mainView.tsx:496-497`; `ManualEntry.tsx:34,575`; `manual-entry/types.ts:70-78`). The
  guarantee that other buckets are not SAVED lives upstream in `toAttendanceOnlyDraft`
  (`attendanceDraft.ts:45-65`). `AttendanceResult.tsx` replaces the `mainView.tsx:481-499` branch.
- **Q3 CONFIRMS PLAN — `logIntent` survives.** Cleared only on a route change away from
  `'main'` (`useAppNavigation.ts:85-91`); the save path routes back to Labour while it is set
  (`useLogCommands.ts:661-664`).
- **Q4 CONFIRMS PLAN — the parse carries a headcount.** `LabourEventSchema.count`
  (`AgriLogResponseSchema.ts:456`) and `workerNames` (:465-479), reaching the server as
  `LabourAttendanceDraftDto.Headcount` (`Contracts/Dtos/LabourDataDto.cs:291-305`, `int?`,
  0 reserved for genuine no-labour).

**Open, and each one changes a Phase 1 screen:**

- **Q5 — Can the persisted engagement tell a human-stated headcount from an unconfirmed AI
  one?** Answer from the repo: **no.** `LabourAssignment.WorkerCount` (:63) has no certainty
  and no spoken-text sibling, unlike `TotalCost` (:130,:133). So "WorkerCount is not null" is
  satisfied by exactly the unconfirmed parse Correction 3 says is NOT an anchor.
  **Then verify the proposed substitute:** does the log confirmation screen actually show the
  farmer the headcount before he confirms? If yes, `CurrentVerificationStatus != Draft`
  (`Logs/DailyLog.cs:106-111`; `VerificationStatus.cs:3-10`) IS the acceptance signal and no
  column is needed. If no, the fallback is a `headcount_certainty` + `headcount_spoken_text`
  pair mirroring the cost pair exactly — which is a founder decision, not an executor's.

- **Q6 — Do any capture gate and any ledger gate share a flag, constant block, or
  conditional today? Name them.** Known: `SHOW_ATTENDANCE_TILE` (LabourHub.tsx:37, capture)
  and `SHOW_LEDGER_TILE` (:51, memory) sit in one block, share one doc comment, and are
  revealed together by a single `isPreview` at :339 and :342. `WeeklyDashboard.tsx:64`
  (`SHOW_LEDGER_BUTTON`) is the second ledger door. Find any others.

- **Q7 — What is the app's Marathi for "verification cannot start because no headcount was
  stated"?** Grep of `src/clients/mobile-web/src/i18n/` finds nothing. Do not invent it —
  carry it to the founder as copy, marked `[FOUNDER: Marathi needed]`.

- [ ] **Step 1: Answer all with file:line, mark CONFIRMS/CORRECTS, commit**
```

---

## 7. Replaces: `# Phase 1 — UI mockups and founder approval` (the whole phase, plan lines 173–227)

**Serves corrections 2, 4, 5, 6, 9, 10 — this is the largest change.**

```markdown
# Phase 1 — UI mockups and founder approval

**No product code in this phase.** Output is screens the founder judges by eye, at 390px,
at true rendered size.

**Precondition:** any `CORRECTS PLAN` finding from Task 0.5 rewrites the affected task's
Deliverable BEFORE that screen is drawn. Findings 0.3-Q3 (night arithmetic), 0.3-Q4 (extra
time / specific hours), and 0.4-Q5 (anchor provenance) each change what a screen is allowed
to show. **Tasks 1.1–1.4 are the capture journey and are drawn as one continuous flow.**

**Marathi rule for every screen below:** where the founder has supplied words, use them
verbatim. Where he has not, leave the line blank and mark it `[FOUNDER: Marathi needed]`
with the English meaning beside it. No agent invents farmer-facing Marathi.
**Word order:** Marathi `X पैकी Y` means "Y out of X" — the TOTAL binds before पैकी, so a
partial resolution reads `12 पैकी 8 समजले`, never `8 पैकी 12`
(`i18n/syncTranslations.ts:141-146`; restated `i18n/translations.ts:749`).

### Task 1.1: State A — the anchored flow

**Files:** Create `docs/superpowers/mockups/2026-09-01-labour-r1/01-state-a-anchored.html`

Two panels on one page, at 390px.

- [ ] **Step 1: Panel 1 (before the mic)** — the anchor stated back as a fact the farmer
      already gave: "12 people already reported", with the single question
      **`या 12 जणांमध्ये कोण होते?`** (founder-supplied; spec D9.6) directly above the
      existing hero, which keeps its shipped string `बोलून हजेरी घ्या` (LabourHub.tsx:331).
- [ ] **Step 2: Panel 2 (after the mic) — LABOUR-OWNED, not the Work Log confirm screen:**
      `ShramSafalला समजलं` / Ganesh / Ramesh / `Shankarसोबत 8` / `12 पैकी 12 समजले` /
      `[बरोबर] [बदल करा]` — the founder's exact words.
- [ ] **Step 3: MUST NOT SHOW** — any Work Log bucket; any crop or plot picker; the generic
      `तपासा` inbox card; any headcount stepper (the count is already known — rule 15);
      any amount — this screen answers WHO, and money lives in the register (D-H6).
- [ ] **Step 4: FOUNDER GATE — does panel 2 read as Labour's own answer, so that pressing
      `बरोबर` is the only save event?** Today there is no such moment: a labour parse is
      auto-submitted at `AppRouter.tsx:214-228` while `useVoiceRecorder.ts:624` still promises
      "never skip to auto-save".

### Task 1.2: State B — no headcount, and why verification cannot start

**Files:** Create `.../02-state-b-no-anchor.html`

- [ ] **Step 1: Draw the hero visibly UNAVAILABLE — not hidden, not silently inert — with a
      one-line reason and one button that returns him to stating the labour quantity on the
      work log**
- [ ] **Step 2: The हजेरी वही tile must be visibly LIVE on this same screen.** This screen is
      the proof of Correction 11: gating capture does not gate memory.
- [ ] **Step 3: MUST NOT SHOW** — a greyed mic with no words; an error tone; the word
      "permission" (this is a missing fact, not a denied right)
- [ ] **Step 4: FOUNDER GATE — what does the app SAY here?** The repo has no string for it
      (Task 0.4 Q7). Ship this mockup with that line blank, marked
      `[FOUNDER: Marathi needed]`, plus two English candidates so he chooses the meaning
      before he writes the words.

### Task 1.3: State C — the Main Log already understood the people

**Files:** Create `.../03-state-c-confirm-only.html`

- [ ] **Step 1: Labour opens straight onto the draft — the same result card as 1.1 panel 2 —
      with NO mic offered at all. Only `[बरोबर] [बदल करा]`.** (Spec D9.6: "draft already
      complete → show it and offer बरोबर / बदल करा only.")
- [ ] **Step 2: MUST NOT SHOW** — a microphone; the question `या ... जणांमध्ये कोण होते?`
      (already answered — asking again is rule 15); a per-person confirm checklist
- [ ] **Step 3: FOUNDER GATE — when the main log already knew everyone, is silence-plus-
      `बरोबर` enough, or does he want the transcript line visible above it as proof of where
      the names came from?**

### Task 1.4: State D — the headcount contradiction

**Files:** Create `.../04-state-d-contradiction.html`

- [ ] **Step 1: Both numbers side by side, each attributed to who said it (log said 12 / you
      just said 10). One action. The owner is the final resolver.**
- [ ] **Step 2: Draw exactly two treatments at true size — an inline strip inside the result
      card, versus a one-question sheet**
- [ ] **Step 3: MUST NOT SHOW** — a merge; a "which is correct?" radio that overwrites the
      first (rule 1); a person-by-person reconciliation list; any dashboard
- [ ] **Step 4: FOUNDER GATE — does the contradiction sit inside the result card or stop the
      flow; and if the mukadam is the speaker, does he see it at all or does it queue for the
      owner?** Spec D7 says his mark counts immediately and the owner corrects after — the
      mockup must not contradict that.

### Task 1.5: The adaptive ladder — all four rungs on one sheet

**Files:** Create `.../05-adaptive-ladder.html`

**This is Correction 4 made visible.** The founder cannot see mental load decreasing from
prose; he sees it by comparing screens.

- [ ] **Step 1: Four columns at 390px, left to right, the SAME shell losing content:**
      (a) nothing understood → Labour unavailable, no question asked;
      (b) only 12 understood → one question, `या 12 जणांमध्ये कोण होते?`;
      (c) 12 + some people → one question naming only the remainder;
      (d) 12 + full composition → no question, `बरोबर?` only
- [ ] **Step 2: Under each column print how many times the farmer must speak: 0 / 1 / 1 / 0**
- [ ] **Step 3: MUST NOT SHOW** — four different layouts. The reduction is only legible if
      the shell is visibly the same screen losing content.
- [ ] **Step 4: FOUNDER GATE — is rung (c) genuinely one question, or does "ask for the
      remainder" need the already-known names displayed beside it — which is more on screen,
      not less?** Rung (c) has no founder string; mark it `[FOUNDER: Marathi needed]`.

### Task 1.6: The हजेरी वही — always available, and Mukadam-wise

**Files:** Create `.../06-hajeri-ledger.html`

**Two panels. This replaces the deleted money-collision task.**

- [ ] **Step 1: Panel 1 — four conditions, ALL showing the grid:** no work log at all;
      headcount stated but nobody marked; a no-work day; a half-marked week. In every one the
      day columns and the name column are present, and unknown cells are **blank** — never
      `–`, which `cellGlyph` correctly reserves for a deliberate absence
      (`HajeriLedger.tsx:40-43`).
- [ ] **Step 2: Panel 1 must include a Full+Night day.** Draw the D-H3 split cell (day over
      night) with the row total rendered as the two marks or as `—`, **never as `2`**. Draw
      extra time and specific hours too — all five realities are R1 (final direction §1),
      each as its own distinct mark, never folded into a day fraction.
      **Money (founder ruling b; D-H6, D-H7):** the week's stated amount renders at the end
      of the row, exactly as the farmer said it. Where he stated none, that cell is blank —
      the register never fills it by calculating one.
- [ ] **Step 3: Panel 2 — the founder's exact day:** Farm Mukadam Ganesh as a person row with
      his own presence marked independently; Labour Mukadam Shankar as his own row with his
      own presence (blank if unknown) and ONE aggregate row beneath reading `Shankarसोबत 8`;
      direct workers Ramesh and Sunita as their own rows outside both. Beside it, the same
      screen tomorrow with the 8 gone.
- [ ] **Step 4: MUST NOT SHOW** — any amount the SYSTEM produced — a rate x days figure, a derived
      settlement, a week total it computed itself (stated money is shown, calculated money
      never is); the full-screen `अजून हजेरी नोंदवली नाही` takeover replacing the grid; a
      mic; eight rows or eight invented names (rule 11); Ganesh and Shankar under one heading;
      the 8 folded into Shankar's own cell (D16 forbids two presence truths for one man);
      the word मुकादम used to mean the `AppRole`.
- [ ] **Step 5: FOUNDER GATE — two questions.** (i) At exactly zero rows there is nothing to
      draw a grid from: keep the empty-state card but place it BELOW a visible empty week, or
      is the takeover acceptable at zero rows and nowhere else? (ii) Does the register need
      two visibly different words for Farm Mukadam and Labour Mukadam — the app has only one,
      `मुकादम`?

### Task 1.7: One control — "Allow Labour Management"

**Files:** Create `.../07-one-control.html`

**Merges the deleted Permission Centre and Temporary Responsibility tasks. Most of this
already exists** — the team list with a per-member switch renders today at
`IdentitySection.tsx:474-510`, with `canManage` / `isEditable` / `saving` states at :492-503.

- [ ] **Step 1: Draw the EXISTING team list with four members side by side:** one with labour
      management ON, one OFF, one temporary-and-active ("until Sunday"), one lapsed with
      history intact. Temporary is the SAME control with a duration attached, shown as a
      second state of that row — **never a second screen.**
- [ ] **Step 2: MUST NOT SHOW** — a matrix; separate attendance / expenses / approvals
      toggles; any of the words role, claim, policy, grant, ACL, permission model, membership
- [ ] **Step 3: Show that history keeps saying Prakash acted after his authority ends**
      (accountability survives expiry)
- [ ] **Step 4: FOUNDER GATE — put this to him first and directly:** today a Mukadam gets
      labour authority automatically and the owner **cannot** switch it off
      (`LabourManagementPermission.cs:85-86`; `SetLabourPermissionHandler.cs:110-113` refuses
      the request). Confirming Correction 1 overturns that code. Also settle the Marathi for
      ON and OFF — `IdentitySection.tsx:466-468` records that these two states ship in
      English because no Marathi was ever approved. **That is the real open item here.**

### Task 1.8: Founder confirmation of the whole set

- [ ] **Step 1: Present 1.1 → 1.5 as one continuous capture journey at 390px, then 1.6 and
      1.7 as the two surfaces that journey touches**
- [ ] **Step 2: The gate question is: "walk this and tell me where it asks you something you
      already said."** That is the only test Correction 4 can be judged by.
- [ ] **Step 3: STOP. Implementation begins only after this gate.**
```

---

## 8. Replaces: `# Phase 2 — Authority` (Tasks 2.1–2.3)

**Serves corrections 1 and 11.**

```markdown
# Phase 2 — Authority (D9.10 items 3 and 5 depend on it)

**Step-level code for Phases 2–5 is written after Task 1.8, deliberately.**

### Task 2.1: One switch, and the owner can turn it off

**Deliverable:** `CanManageLabourRecords` becomes the single "Allow Labour Management"
decision for every non-owner — including a Mukadam. Remove `AppRole.Mukadam` from
`LabourManagementPermission.IsCarriedByRole` (LabourManagementPermission.cs:85-86), so
`IsAllowed(role, hasExplicitGrant)` (:94-95) governs him. `IsRedundantGrantTarget` (:117)
then stops blocking him at `SetLabourPermissionHandler.cs:110-113` — keep that refusal for
`PrimaryOwner`/`SecondaryOwner` only — and the switch already rendered at
`IdentitySection.tsx:492-503` becomes editable for him.

**Test:** an owner turns the switch off for a Mukadam; the Mukadam remains a Mukadam; his
next labour write is denied by `LabourManagementGate.IsAllowedAsync`, not merely hidden.
Attendance marking asks that **same** predicate — no second permission, no second column,
no attendance-specific flag.

**Constraint:** NO new permission type and no responsibility set. Correction 1 forbids the
matrix. Blast radius to re-test, named honestly: the five call sites listed at
`LabourManagementGate.cs:12-19` (`CorrectLabourHandler.cs:163`,
`AttachFieldOperatorHandler.cs:93`, `CreateFieldOperatorHandler.cs:41`,
`RenameFieldOperatorHandler.cs:54`, `ShramSafalAuthorizationEnforcer.cs:170`), plus
`HasExplicitGrantAsync` (:107) which `VerificationStateMachine` consumes — that call becomes
redundant, not wrong. Existing proof `OwnerCanApproveAMukadamsLogRealPostgresTests` will need
rewriting; its intent (an ungranted foreman cannot sign off his own day) must survive.

### Task 2.2: Time-bounded authority

**Deliverable:** one nullable `labour_grant_expires_at_utc` on `farm_memberships`, evaluated
in `LabourManagementGate.IsAllowedAsync` against `IClock`, never on `IsCarriedByRole`.
Greenfield — no expiry concept exists anywhere (verified, Task 0.2 finding 3).

**Test:** an expired grant denies the action; the historical record of what the person did
while authorised is unchanged.

**Constraint:** expiry **denies forward**, never rewrites backward. Note the signature cost
the code already sets: `IsAllowedAsync` (`LabourManagementGate.cs:60-80`) is `static` and
takes no clock — threading one in is a signature change across six call sites.

### Task 2.3: Prove denial server-side

**Deliverable:** the Task 1.7-approved copy applied to the existing team list, plus proof.
No new screen unless the founder rejected the existing one at the 1.7 gate.

**Test:** a Mukadam with the switch OFF is refused by `LabourManagementGate.IsAllowedAsync`,
not merely hidden in the UI.

### Task 2.4: Preserve the capture/memory separation (a test, not a build)

**Reframed by final direction §7. The rule being preserved is narrow, and the earlier
wording overreached.**

WHAT THIS TASK ASSERTS: an actor who is legitimately entitled to read हजेरी must not LOSE
that access merely because capture state is missing — no headcount, no Work Log, no marks,
no capture permission, a no-work day.

WHAT THIS TASK MUST NOT ASSERT: that farm membership alone authorises reading attendance and
stated money. That is a farm access/privacy question, it is out of Labour V2 scope, and the
previous draft of this task wrongly locked it in.

**Deliverable:** an architecture test, in the `LabourAnchorRules.cs:39-56` regex-scan idiom.
Assert that no ledger read path takes a CAPTURE signal as an authorisation input — concretely,
that `GetLabourDataHandler` (and any future ledger read) does not call
`LabourManagementGate.IsAllowedAsync`, which is the WRITE-authority gate. Whatever
access/privacy check the read path already performs stays exactly as it is; this test neither
adds nor removes one.

**This is a preservation task, not a build task.** Server-side the separation already holds:
`GetLabourDataHandler.cs:170-178` denies when `callerRole` is null — an access check, which
stays — and its `HasExplicitGrantAsync` call at :185-186 feeds the FSM's next-actions per the
comment at :179-184 rather than gating the read. The test stops a future executor from wiring
capture authority into the read while building Phase 2.

**Phase 0 must report** (Q8, new): what access/privacy boundary the ledger read enforces
today, stated with file:line, so Phase 2 preserves it rather than inventing one.
```

---

## 9. Replaces: `# Phase 3 — Capture` (Tasks 3.1–3.4)

**Serves corrections 3, 4, 11, and the Correction 2 result surface.**

```markdown
# Phase 3 — Capture (D9.10 items 3 and 4)

### Task 3.1: The labour mic anchor gate

**Deliverable:** the Labour mic activates only with an explicit labour anchor.
**Anchor :=** the owning `DailyLog`'s `CurrentVerificationStatus != VerificationStatus.Draft`
(`Logs/DailyLog.cs:106-111`; `Logs/VerificationStatus.cs:3-10`) AND its `LabourAssignment`
carries a non-null `WorkerCount` (`Farms/LabourAssignment.cs:63`) — i.e. a human confirmed or
accepted the count — **OR** the explicitly-entered no-work-day flow.
**A Draft log carrying a parsed 12 is NOT an anchor.** If Task 0.4 Q5 found that the confirm
screen never shows the farmer the headcount, this deliverable becomes the
`headcount_certainty` + `headcount_spoken_text` pair on `labour_assignments` instead,
mirroring `CostCertainty`/`CostSpokenText` (:130,:133) exactly — the founder rules, not the
executor.

**Test:** a Draft log with `WorkerCount = 12` leaves the mic inactive and renders the
Task 1.2-approved reason; the same log after confirmation activates it.

**Where the gate goes:** `core/navigation/simpleRoutes.tsx:83-89` (`onGoToLog`) sets
`logIntent = 'labour'` and routes to `'main'` with no condition — **that is the door.**
The hero it hangs off is `LabourHub.tsx:325-334`.

**HARD CONSTRAINT (Correction 11):** the gate may disable ONLY the recorder behind the hero.
It may not gate the Labour route, the hub, the हजेरी वही tile, or `HajeriLedger`.
**Test:** with the anchor absent the hero is inactive AND the ledger tile is present and opens.

### Task 3.2: Context carried forward — the four rungs, by field name

**Deliverable:** the labour parse receives farm, date, engagement, plot and reported headcount
as *known*, and is scoped to resolving composition. The ladder is already fully expressible:
each labour event carries `count` (`AgriLogResponseSchema.ts:456`) and `workerNames`
(:465-479, declared so Zod cannot strip it), reaching the server as
`LabourAttendanceDraftDto.Headcount` (`Contracts/Dtos/LabourDataDto.cs:291-305`, `int?`,
0 reserved for genuine no-labour).

| Rung | Condition | Labour asks |
|---|---|---|
| nothing understood | `count == null` | nothing — Labour unavailable (Task 3.1) |
| only 12 understood | `count != null`, `workerNames` empty | WHO |
| 12 + some people | `count != null`, `workerNames.length < count` | only the remainder |
| 12 + full composition | `workerNames.length >= count` | only `बरोबर?` |

**Test:** the parser does not re-ask plot, crop, work, or headcount; a transcript naming only
people still resolves. **Constraint:** rule 15.

### Task 3.3: Headcount disagreement becomes a question

**Deliverable:** if the farmer says 10 where the log said 12, both statements are preserved
and the conflict is surfaced exactly as approved at the Task 1.4 gate.
**Test:** the original 12 is unchanged in storage; a conflict is visible; the owner resolves
it. **Constraint:** rule 1 — no silent overwrite. Both `sourceText` and
`systemInterpretation` survive (spec D9.5).

### Task 3.4a: Delete the labour auto-submit

**Deliverable:** remove the `logIntent === 'labour'` auto-submit effect
(`core/navigation/AppRouter.tsx:214-228`) and its `autoSubmittedLabourDraftRef` guard. A
labour parse lands on `AttendanceResult` and is saved only by the farmer pressing `बरोबर`.

**Test:** after a labour parse, nothing is persisted until the confirm press.

**Precision, so nothing correct is deleted with it:** the *navigation* is unconditional
(`simpleRoutes.tsx:83-89`); the *auto-submit* is already guarded on
`attendance.labour.length !== 0` (:225) and on a once-per-draft ref, and both guards are
doing correct work. **What must change is the door and the destination, not the guards** —
the whole effect goes away because the confirm screen replaces it, not because the guards
were wrong. This is a live violation of trust rule 5 and of the promise still written at
`features/voice/useVoiceRecorder.ts:624`.

### Task 3.4b: The Labour-owned result surface

**Deliverable:** `features/labour/components/AttendanceResult.tsx` — the Task 1.1
panel-2 screen, replacing the `mainView.tsx:481-499` branch that today renders the generic
`ManualEntry` with `attendanceOnly` (:496-497).

**Test:** no Work Log bucket renders on this path; the farmer never lands on generic log
review; `logIntent` still routes him back to Labour on save (`useLogCommands.ts:661-664`).

**Note on scope:** `toAttendanceOnlyDraft` (`attendanceDraft.ts:45-65`) already empties the
other buckets, so the remaining work is **ownership** of the screen, not bucket suppression.

### Task 3.5: The complete attendance write path — offline included

**Added by founder final direction §6. This is the largest genuinely-missing piece, and the
revision found it: persistence exists, the repository port exists, and there is no callable
route. `AttendanceMark` appears in `ShramSafal.Application`/`ShramSafal.Api` in exactly one
file — `Ports/IShramSafalRepository.cs` — with no handler and no endpoint. A table is not a
feature.**

**Deliverable — every link, in the repo's existing patterns, building no second offline system:**

```
Attendance UI
  ↓  offline-capable mutation      (existing queue + SyncMutationCatalog descriptor)
  ↓  server command / use case     (RecordAttendanceMark handler, LabourManagementGate-gated)
  ↓  persistence                   (ssf.attendance_marks — already exists, RLS + grants shipped)
  ↓  sync acknowledgement          (existing push/pull acknowledgement contract)
  ↓  ledger read-back              (Task 4.1)
```

**Trust semantics (settled, §5):** an offline mark is LOCAL INTENT. It becomes DURABLE
SYNCHRONISED TRUTH only on server acknowledgement. The UI must show the weaker state honestly
and must never present an unacknowledged mark as confirmed — doctrine P5, and the exact defect
shape recorded in memory as "success measured one boundary short".

**Acceptance (the whole task passes or fails on this one sentence):** an authorised person marks
attendance from the real UI **with connectivity off**, the mark survives, sync completes, the app
is closed and reopened, and the same fact is visible in हजेरी.

**Tests:**
- offline mark → queued, and the UI does not claim it is confirmed
- reconnect → acknowledged → ledger read-back shows the identical day/night values
- an unauthorised caller is refused server-side by `LabourManagementGate.IsAllowedAsync`,
  not merely hidden in the UI
- revert-proof: deleting the descriptor makes the offline test fail, not silently pass

**Constraints:** follow the existing `SyncMutationDescriptor` / endpoint idiom exactly. Do NOT
invent a parallel queue, a bespoke retry, or an attendance-specific sync protocol. Phase 0
remaining-unknown 3 names the exact route before this task is written at step precision.
```

---

## 10. Replaces: `# Phase 4 — The register` (Tasks 4.1–4.2)

**Serves corrections 5, 6, 8, 9.**

```markdown
# Phase 4 — The register (D9.10 item 8, partly built)

### Task 4.0: The ledger door is not a switch

**Deliverable:** delete `SHOW_LEDGER_TILE` (`LabourHub.tsx:51`) and `SHOW_LEDGER_BUTTON`
(`WeeklyDashboard.tsx:64`, used at :387), and delete the `|| isPreview` escape at
`LabourHub.tsx:342` — **rather than flipping the constants to true.** Correction 5 says the
ledger may never be gated; a constant that can be flipped back is a gate.

**Test:** the हजेरी वही tile renders and the ledger opens with zero attendance marks, zero
work logs, no headcount, and on a declared no-work day. Unknown cells render blank, never zero.

**Scope fence:** `SHOW_ATTENDANCE_TILE` (`LabourHub.tsx:37`) is a CAPTURE gate and is **out of
this task** — see Task 3.1 and Correction 11. Decision 4b (un-hiding means finishing) is
satisfied by Tasks 4.1 and 4.0 landing together, not by 4.0 alone.

### Task 4.1: The ledger reads marks, and never disappears

**Deliverable, backend:** `BuildHajeriLedger`
(`ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs:809`, called at
:713) sources from `AttendanceMark` rather than deriving presence from names and engagement
shift. **Delete the `named.Count == 0` early return at :832-838**, which today returns
`new LabourLedgerDto(weekLabel, [], [], [], manDays)` — a register that vanishes because
nobody was named, which is exactly Correction 5. Also edit the ledger DTO
(`Contracts/Dtos/LabourDataDto.cs:201-230`): `LabourLedgerRowDto.Cells` changes from
`IReadOnlyList<string?>` (:218-224) to a cell record carrying both halves.

**Deliverable, frontend:** `PresenceStatus` (`features/labour/labour.types.ts:47`, today
`'present' | 'half' | 'absent'`) becomes a day/night pair matching `DayMark`/`NightMark`
(`AttendanceMark.cs:165-182`), and `LedgerRow.cells` (:116) follows. Without this the fourth
state silently collapses back into a `null` convention on the wire. `HajeriLedger.tsx` keeps
the grid with blank cells (the empty message moves inside it, or is placed per the Task 1.6
ruling) and implements the D-H3 split cell.

**Tests (binary):**
- a farm-week with zero named people and zero marks renders seven day columns, every cell
  blank — never an empty DTO, never a `–`
- an unmarked day is blank, not absent (rule 4)
- a half comes only from `DayMark.Half`; changing `LabourAssignment.Shift` changes no cell
  (today `:825-830` sets `IsHalf = a.Shift == LabourShift.Half`, so a whole crew's shift
  silently becomes every named person's attendance — and `LabourShift.Night`
  (`Farms/LabourShift.cs:4-9`) currently renders identically to a full day)
- a Full+Night day displays as its **two marks**, not as a summed number
- **no ledger surface renders `AttendanceMark.Value`** (`AttendanceMark.cs:151-158`)
- the ledger query takes no anchor, no headcount and no permission-to-capture as input

**Existing tests that must be rewritten, not deleted:**
`src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs` — 10 cases pin the
current derive-from-names behaviour.

**Constraint (founder ruling b):** the register DISPLAYS money the farmer stated — D-H6,
the register is the wage book. It never CALCULATES one: no rate x days, no derived
settlement total, no inferred week figure. A week with no stated amount renders blank.
**Test:** a stated amount survives to the cell unchanged; a week with no stated amount
renders blank rather than a computed or zero value.

### Task 4.2: No-work-day attendance

**Deliverable:** labour present with no productive work is recordable and appears in the
register, via the route Task 0.3 Q5 settled.

**Named blocker:** `attendanceDraft.ts:60-63` currently sets `disturbance: undefined`,
discarding the reason the day had no work — while the parse does produce it
(`AgriLogResponseSchema.ts:731`). Spec D11 rules that the no-work day reuses the existing
`Disturbance` concept and forbids a second reason taxonomy, so this one line severs the two
halves of the flow. The no-work path must preserve `disturbance`: **attendance says WHO,
disturbance says WHAT blocked the day, and neither collapses into the other.**

**Also verify before scheduling:** `DisturbanceItem` is not a field on
`CreateDailyLogPayload`, so the sync path may not be able to carry it. Confirm in code.

**Test:** the day shows attendance and does **not** cause any surface to conclude work
happened (rules 6 and 7).

### Task 4.3: One person, two works, one farm-day

**Deliverable: no new type, no new column — a test that proves what the schema already
guarantees, plus the one bridge that is genuinely missing.**

**Free by construction:** `FieldOperatorWorkRow`'s grain is person × **engagement** — its own
remarks say "the same person on two engagements on the same date yields two rows"
(`Labour/FieldOperatorWorkRow.cs:21-24`, fields at :61-73) — while `AttendanceMark` carries no
engagement or log reference (`AttendanceMark.cs:67-93`) and is unique on
`(farm_id, field_operator_id, work_date)` (`Migrations/20260831180408_AddAttendanceMarks.cs:41-44`).
Ganesh in grape pruning and cane work is therefore two work rows and exactly one mark,
structurally, with no reconciliation step.

**Build ONLY the genuine-ambiguity case:** the same `FieldOperator` implied Full in one work
context and Half in another produces ONE question to the owner, on that day, and stops.

**CORRECTED by final direction §8 — the unique index is NOT the trigger.** A SQL uniqueness
collision is a LAST-RESORT SAFETY NET that prevents an impossible duplicate canonical mark if
application logic fails. It must not be the product mechanism that discovers ambiguity, and a
database error must never be the thing that decides to ask the farmer a question. Detection is
SEMANTIC and happens BEFORE persistence wherever possible: the application recognises that one
known person now has conflicting day-level implications and asks **एक गोष्ट स्पष्ट करा**
(`[FOUNDER COPY REQUIRED]` — full Marathi wording to be approved in Phase 1). Phase 0 finds
the repo-native place for that pre-persistence check and reports it.

**Test:** two work rows for one `FieldOperatorId` on one date, two different assignments →
one ledger row, one day of presence, and both engagements' `WorkerCount` unchanged; a second
`AttendanceMark.Create` for the same (farm, operator, date) is refused; two work contexts with
consistent marks ask nothing at all.

**Constraint (D9.12):** no reconciliation dashboard, no per-person-per-task screen, no
cross-plot deduplication of anonymous crews. Anonymous stays anonymous.
```

---

## 11. Replaces: `# Phase 5 — The second signature slot` / `### Task 5.1`

**Serves correction 10.**

```markdown
# Phase 5 — The second signature slot

### Task 5.1: An architectural acceptance test, no feature

**Correction 10 locks attachability, not a field — and the repo already proves the pattern
works.** `AttendanceMarkCorrection` is a separate append-only table pointing at a mark by
`AttendanceMarkId` (`Labour/AttendanceMarkCorrection.cs:73`, rationale at :110-114), created
by `Migrations/20260831185516_AddAttendanceMarkCorrections.cs` which alters `attendance_marks`
in no way, and made append-only at the GRANT level (SELECT + INSERT only, :65-77). A future
acknowledgement is that same shape and needs **zero change to `AttendanceMark` today.**

**Deliverable:** one architecture test, in the `LabourAnchorRules.cs:39-56` regex-scan idiom.
Assert that:
(a) `AttendanceMark` carries no acknowledgement, confirmation, verification or signature
    member (its public surface is FarmId, FieldOperatorId, WorkDate, Day, Night,
    RecordedByUserId, RecordedAtUtc, ModifiedAtUtc — `AttendanceMark.cs:67-93`);
(b) its `Id` is a stable, externally-referenceable key that `Amend` does not change
    (`AttendanceMark.cs:127-149` — Amend mutates in place and returns the previous values;
    it never replaces the row);
(c) at least one production type in `ShramSafal.Domain.Labour` references a mark solely by
    `AttendanceMarkId`, with no back-reference on the mark — proving a second-party event can
    attach without replacing, updating or duplicating the attendance event.

**Failure message:** "a worker's future acknowledgement must be able to point AT the mark;
if the mark ever has to change shape to accept one, R1 has closed the door Correction 10
asked us to leave open."

**One caveat to record in the plan text, not to build:** because `Amend` mutates in place, a
future acknowledgement event MUST carry the day/night values it acknowledged, or it will
silently follow a later correction. That is the one thing R1 must not make impossible.

**NOT in R1:** no `AcknowledgementKind` enum, no `direct/proxy/none` field, no channel, no
scoring, no worker app. The dignity intent stays recorded in Appendix A (§8–13, §21).
```

---

# Task ledger

**DELETED (5):**
1. **Task 1.1 "The ledger exception collision"** — the collision was invented by the plan, not found in the code, and money itself STAYS per founder ruling (b) (now Task 1.6 Step 2 and Task 4.1). `HajeriLedger.tsx` renders no money at all (sole "money" match is the comment at :24) and `LedgerRow` (`labour.types.ts:102-117`) has no amount field. It also reopened a screen the plan's own line 46 called approved.
2. **Task 1.3 "Permission Centre"** — the stack is already shipped (`MembershipEndpoints.cs:220-221`, `labourPermissionsClient.ts`, `useLabourPermissions.ts`, `IdentitySection.tsx:492-503`). Folded into new 1.7.
3. **Task 1.4 "Temporary responsibility"** — one control with a duration, not a second screen. Folded into new 1.7.
4. **Task 1.5 "Worker second signature (concept only)"** — R1 builds nothing it describes; Correction 2 ranks it below the four capture states.
5. **Task 5.1's implementation deliverable** — replaced by an architecture test.

**ADDED (10):**
1. **Task 0.1 Step 4** — migration inventory (three additive migrations, none reverted).
2. **Task 0.1 Step 5** — `mkdir -p docs/superpowers/mockups/2026-09-01-labour-r1` (the directory does not exist; every Phase 1 task wrote into it).
3. **Tasks 1.1–1.4** — states A, B, C, D, the four screens Correction 2 names. None existed.
4. **Task 1.5** — the adaptive ladder, all four rungs on one sheet (Correction 4 made visible).
5. **Task 1.6** — the always-available ledger + the Mukadam-wise day (absorbs old 1.2).
6. **Task 2.4** — architecture test preserving capture/memory separation (Correction 11).
7. **Task 3.4a** — delete the labour auto-submit at `AppRouter.tsx:214-228`.
8. **Task 4.0** — delete the ledger gate constants (the largest miss: the plan could execute in full and the ledger would still be unreachable).
9. **Task 4.3** — one person, two works, one farm-day (Correction 8, absent from the plan).
10. **Task 5.1** — the attachability architecture test.

**CONVERTED to Phase 0 investigations (6):**
1. **`LabourCrew.cs`** (was a File-Structure "to create" row) → Task 0.3 Q2, three candidates, D16's version rejected with evidence. Correction 7 requires Phase 0 to *find* it.
2. **`FarmResponsibility.cs`** → deleted outright; Correction 1 forbids a responsibility set.
3. **"Five day realities"** (was a Global Constraint assertion) → Task 0.3 Q4, a founder choice.
4. **Night arithmetic** (was a Task 4.1 test line) → Task 0.3 Q3, `Value` obsoleted pending his ruling.
5. **The anchor definition** (was the undefined phrase "a stated headcount") → Task 0.4 Q5, with the fallback column pair named but not scheduled.
6. **Offline attendance capture** → Task 0.3 Q6, marked UNVERIFIED as an R1 obligation.

---

# Test against the founder's complete flow

| Step | Supported? | By what |
|---|---|---|
| natural main log | **yes, unchanged** | untouched; D9.7 keeps the generic parser unrestricted |
| work truth recorded | **yes** | existing `LabourAssignment` path |
| labour info carried forward | **yes** | Task 3.2, by field name (`count`, `workerNames`, `LabourAttendanceDraftDto.Headcount`) |
| anchor exists | **yes** | Task 3.1 + Task 0.4 Q5 |
| mic available | **yes** | Task 3.1 gates only the recorder behind `LabourHub.tsx:334` |
| ask only WHO | **yes** | Task 1.5 ladder + Task 3.2 |
| labour-owned result | **yes** | Task 1.1 panel 2 → Task 3.4a + 3.4b |
| confirm / correct | **yes** | `बरोबर` is now the only save event (3.4a) |
| one person, two works = one attendance | **yes, free** | Task 4.3; unique index at `Migrations/20260831180408_AddAttendanceMarks.cs:41-44` |
| anonymous stays anonymous | **yes** | Task 0.3 Q2 forbids fabricated rows; Task 1.6 Step 4 forbids eight rows |
| ledger available throughout | **yes** | Task 4.0 (door) + Task 4.1 (empty-register fix) |
| weekly memory | **partly — see gap 2** | |
| future acknowledgement can attach | **yes** | Task 5.1 |

## Steps the revised plan still does NOT support

**Founder final direction (2026-09-01) closed gaps 1, 2, 3, 4, 5 and 6 as PRODUCT questions.**
What survives below is engineering work to be sized in Phase 0 and built in Phases 2–4 — none
of it returns to the founder as a decision.

| Was gap | Status after the final direction |
|---|---|
| 1. "Shankar brought 8" has no home | **SETTLED (§3).** The relationship is required and engagement-scoped. Candidate (a) eliminated. Phase 0 sizes the shape; Task 1.6 panel 2 draws it as approved intent, not speculation. |
| 2. The weekly total is undefined | **SETTLED (§2).** The week is never collapsed into one number. Dimensions are preserved; only the visual treatment is a Phase 1 decision. `LabourLedgerRowDto.Total`/`WeekTotal` must stop summing `present=1/half=0.5/_=0` (`GetLabourDataHandler.cs:877,:901-906`), which collapses Absent into Unmarked and breaks trust rule 3. |
| 3. The write path is not scheduled | **SETTLED (§5, §6).** Offline attendance is R1. Scheduled as new Task 3.5, end to end. |
| 4. Extra time and hours unsupported | **SETTLED (§1).** All five realities are R1; this is a capability to build, not a choice to make. Phase 2 gains the migration task. |
| 5. Marathi copy missing | **SETTLED (§14).** Copy is a UI gate, not a data-model gate. Phase 1 draws the approved visual with `[FOUNDER COPY REQUIRED]` plus the English meaning; the founder supplies Marathi before implementation. Architecture never waits on four strings. |
| 6. Are there approved 390px mockups elsewhere? | **SETTLED (§15).** Stop searching. The existing built हजेरी is the design baseline — the founder has called it one of the clearest UIs built. Phase 1 visually verifies only the newly-required realities (night, extra time, explicit hours, always-visible empty state, Mukadam-wise grouping, stated money, blank/unknown, no-work attendance). Do not redesign the ledger. |

### Remaining engineering unknowns (Phase 0 answers these; none is a founder question)

1. The smallest repo-native shape for the engagement-scoped Labour Mukadam relationship (§3).
2. The smallest repo-native storage for extra time and explicit hours (§1).
3. The repo-native offline write/sync route for attendance (§5) — existing pattern only.
4. The pre-persistence place for semantic conflict detection (§8).
5. The access/privacy boundary the ledger read enforces today (§7), stated with file:line.
6. The exact permission changes required to make owner-controlled Mukadam authority real (§12).

### Superseded — the original gap text, retained for traceability


1. **"Shankar brought 8" has no confirmed home.** Task 0.3 Q2 finds it; it does not build it. If the founder picks candidate (b), a Phase 4 task must be added after the gate. **Until he rules, Task 1.6 panel 2 draws a row (`Shankarसोबत 8`) that no schema can currently produce.** That is deliberate — the mockup is how he rules — but it must not be read as approved capability.

2. **The weekly total is undefined.** `LabourLedgerRowDto.Total` and `WeekTotal` exist and today sum `present=1 / half=0.5 / _=0` (`GetLabourDataHandler.cs:877,:901-906`) — which collapses Absent and Unmarked, failing trust rule 3 inside the one number the register shows. Task 4.1 forbids consuming `AttendanceMark.Value` but **does not say what the week total is**, because Correction 9 withheld that. Task 1.6 Step 5 must ask him: does a week with one Full+Night day total ६.५, does it read "६ दिवस · २ रात्री", or does the total stay silent?

3. **The write path is not scheduled end-to-end.** `RecordAttendanceMark` is listed as to-create, but no task writes the HTTP endpoint on `LabourEndpoints.cs` (no attendance route exists) or the `SyncMutationDescriptor` in `SyncMutationCatalog.cs` (no attendance descriptor exists). Persistence exists; the door to it does not. **Add a Phase 3 task once Task 0.3 Q6 settles whether offline is required** — the two answers give very different work.

4. **Extra time and specific hours remain unsupported.** Three of the five day realities are storable. If the founder rules them into R1 at the Task 0.5 gate, a Phase 2 migration task must be added — none exists in this revision, by design.

5. **The Marathi for four surfaces is missing and must not be invented:** the no-anchor reason (Task 1.2), ladder rung (c) (Task 1.5), a second word for Labour Mukadam if he wants one (Task 1.6), and the Allow-Labour-Management ON/OFF states (Task 1.7 — `IdentitySection.tsx:466-468` records these have shipped in English since Phase 5).

6. **UNVERIFIED: whether approved 390px ledger mockups exist outside this repo.** No `.html` exists under `docs/` on either checkout. The plan asserts the ledger design is approved; Task 1.6 re-approves the *built* screen against Corrections 5, 6 and 9 without reopening D-H1/D-H3 — but if those original mockups exist somewhere, the founder should point at them before 1.6 is drawn.