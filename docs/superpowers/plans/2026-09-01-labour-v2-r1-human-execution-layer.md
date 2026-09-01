# Labour V2 R1 — The Human-Execution Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ShramSafal able to record, correct and read back *who was present on a farm-day* — as a trust layer on the existing multi-user farm architecture, never as a parallel attendance product.

**Architecture:** Attendance is a **third kind of fact** beside work and money. Authority comes from the farm-membership model that already exists; work identity comes from `FieldOperator`, which already exists without requiring an account; the mark itself is new because no existing entity can carry a ruling about a person on a day. The capture experience reuses the one microphone shell the app already has, but the invoking feature owns the meaning and owns the result screen.

**Tech Stack:** .NET 10 (Domain / Application / Infrastructure / Api), EF Core + PostgreSQL 16 (schema `ssf`, RLS enabled *and* forced), React 19 + TypeScript + Vite + Dexie, Vitest, xUnit.

**Specs (all three bind; later supersedes earlier on conflict):**
1. `2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md` (D1–D16) — on branch `task/labour-v2-spec-and-husky-fix`, commit `b6940af9`. **Not reachable from `main` or from `feat/labour-v2-r1`. Task 0.1 fixes that.**
2. `docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md` (D-H1–D-H10) — currently only in the main checkout, uncommitted to this branch.
3. **Founder conceptual lock, 2026-09-01** (this conversation) — reproduced in Appendix A because it exists nowhere else.

---

## Global Constraints

Every task's requirements implicitly include these. A change that violates one has drifted, however elegant.

**The fifteen trust rules (founder, verbatim):**

1. What farmer said must not silently change.
2. Naming never changes counting.
3. Unknown is not zero.
4. Untouched is not absent.
5. AI draft is not confirmed truth.
6. No work is not no attendance.
7. Attendance is not proof that work happened.
8. Actor and subject are different.
9. One human must not be duplicated merely because roles change.
10. Two same names must never be automatically merged.
11. Anonymous workers remain anonymous until real identity exists.
12. Farm data remains farm-isolated.
13. Half-day is attendance evidence, not automatically half wage.
14. Offline/local intent must not be represented as server-confirmed truth before acknowledgment.
15. Do not make the farmer answer questions only because the database wants fields.

**Additional locks from 2026-09-01:**

- **Owner-authorised, not owner-involved.** The owner decides *once* whether a person may manage labour on this farm. He does not approve each action. (Supersedes any reading of D2 that implies per-action approval.)
- **Role ≠ authority.** Being a Mukadam describes what someone does; permission decides what he may do. Attendance authority is owner-granted.
- **Temporary delegation is pilot scope, not an enterprise feature.** "Today only" / "until Sunday" must work.
- **All five day realities in R1:** full · half · extra time · night · specific hours.
- **The हजेरी ledger UI is not reopened.** It is approved. Only if an implementation constraint genuinely prevents expressing a reality do we return with visual alternatives (Task 1.1).
- **Farm Mukadam ≠ Labour Mukadam.** Farm authority and crew organisation are different relationships and may be different people.
- **Worker second signature is designed-for, not built.** R1 leaves the slot; R1 does not build channels, scoring, or a worker app.
- **Labour mic is a verification instrument, not a discovery instrument.** No explicit labour anchor → no Labour mic.
- **The invoking feature owns the result surface.** After a labour parse the farmer returns to Labour, never to the generic Work Log review.

**Out of scope for R1 (founder §25, restated):** wage calculation · payroll · settlement · reputation · worker scoring · permanent crew identities · marketplace · attendance prediction · biometric attendance · mandatory worker accounts · per-person-per-task timesheets as a farmer workflow · generic RBAC redesign.

---

## File Structure

**Already exists — reuse, do not duplicate:**

| File | Responsibility |
|---|---|
| `ShramSafal.Domain/Farms/FarmMembership.cs` | who a human is *on this farm*; carries `CanManageLabourRecords`, the persisted owner grant |
| `ShramSafal.Domain/Farms/LabourManagementPermission.cs` | the effective allow decision (owner-tier / role / grant) |
| `ShramSafal.Application/Services/LabourManagementGate.cs` | the shared predicate every labour write already asks |
| `ShramSafal.Domain/Labour/FieldOperator.cs` | work identity **without** an account — name alone is enough |
| `ShramSafal.Domain/Labour/FieldOperatorWorkRow.cs` | attribution overlay: this person worked this engagement |
| `ShramSafal.Domain/Labour/LabourCorrection.cs` | append-only history for engagements |
| `ShramSafal.Domain/Labour/AttendanceMark.cs` | **built 2026-08-31** — the D-H3 ruling about a person on a farm-day |
| `ShramSafal.Domain/Labour/AttendanceMarkCorrection.cs` | **built 2026-08-31** — append-only, enforced by grant |
| `features/labour/components/HajeriLedger.tsx` | the approved register UI |
| `features/logs/attendanceDraft.ts` | keeps a labour parse out of the Work Log's buckets |

**To create (subject to Phase 0 verification):**

| File | Responsibility |
|---|---|
| `docs/superpowers/mockups/2026-09-01-labour-r1/` | the five approval screens (Phase 1) |
| `ShramSafal.Domain/Labour/LabourCrew.cs` | the Labour Mukadam relationship and its anonymous accompanying count |
| `ShramSafal.Domain/Farms/FarmResponsibility.cs` | a grantable, optionally time-bounded responsibility |
| `ShramSafal.Application/UseCases/Labour/RecordAttendanceMark/` | command, handler, result |
| `features/labour/components/AttendanceResult.tsx` | the Labour-owned parse result surface |

---

# Phase 0 — Cross-verify this plan against the repo

**Nothing here writes product code. Every task's output is a written finding that either confirms a claim above or corrects it.** A plan that assumes wrongly wastes the founder's review time on screens built over a false floor.

### Task 0.1: Make the governing specs reachable

**Files:**
- Create: `docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md`
- Create: `docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md`

**Why this is Task 0.1 and not an afterthought:** the entire drift this plan corrects happened because the governing spec sat on an unmerged branch nobody opened. Executors read the plan *and the spec*; the spec must be beside the plan.

- [ ] **Step 1: Recover the locked decisions from the unmerged branch**

```bash
git show b6940af9:docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md \
  > docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md
```

- [ ] **Step 2: Copy the हजेरी design decisions from the main checkout**

```bash
cp "e:/APPS/Running App Versions/AgriSyncPlatform/docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md" \
   docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md
```

- [ ] **Step 3: Verify both are non-empty and carry their decision headings**

```bash
grep -c "^## D[0-9]" docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md
grep -c "^## D-H" docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md
```

Expected: non-zero for both.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/handoffs docs/superpowers/specs
git commit -m "docs(labour): bring the governing specs onto the working branch"
```

### Task 0.2: Verify the permission floor

**Files:**
- Read: `ShramSafal.Domain/Farms/FarmMembership.cs`, `LabourManagementPermission.cs`, `Services/LabourManagementGate.cs`
- Create: `docs/superpowers/plans/2026-09-01-labour-r1-VERIFICATION.md`

**Questions this task must answer with file:line evidence:**

1. Is `CanManageLabourRecords` genuinely persisted, owner-settable, and revocable? Name the endpoint or handler that sets it, or state that none exists.
2. Does `LabourManagementPermission.IsAllowed` grant Mukadam authority **by role**, ignoring the flag? Quote the code.
3. Is there *any* expiry concept on membership or permission? (Expected: no.)
4. Does any existing surface let an owner see and change who may do what? (The §5 permission centre.)

- [ ] **Step 1: Answer all four in the verification document, each with file:line**
- [ ] **Step 2: For each, mark `CONFIRMS PLAN` or `CORRECTS PLAN`, and for corrections say what the plan must change**
- [ ] **Step 3: Commit the verification document**

### Task 0.3: Verify the identity and crew floor

**Questions, with evidence:**

1. Can `FieldOperator` be created with a name and nothing else? (Expected: yes.)
2. Is there any existing representation of "Shankar brought 8" — a crew, an aggregate, a mukadam link? Check `LabourAssignment.WorkerCount` and whether an engagement can carry both a named attribution *and* an anonymous remainder.
3. Does anything today distinguish **Farm** Mukadam (`AppRole.Mukadam`) from **Labour** Mukadam (crew organiser)?
4. Does `AttendanceMark` (already built) have anywhere to record a second party's acknowledgement? (Expected: no — this is the §8 slot.)

- [ ] **Step 1: Answer all four with file:line, mark CONFIRMS/CORRECTS, commit**

### Task 0.4: Verify the capture floor

**Questions, with evidence:**

1. Where exactly does the labour hero send the farmer today, and does anything gate it on a headcount anchor? (Expected: no gate — this is a known drift to correct.)
2. After a labour parse, which component renders the result? (Expected: the generic `ManualEntry` with buckets hidden — which is *hiding*, not *owning*.)
3. Does `logIntent` survive the whole voice lifecycle — launch, record, transcribe, parse, review, return?
4. Does the AI parse response carry a headcount that could serve as the anchor?

- [ ] **Step 1: Answer all four with file:line, mark CONFIRMS/CORRECTS, commit**

### Task 0.5: Founder gate — verification review

- [ ] **Step 1: Present the four verification documents' `CORRECTS PLAN` findings only**
- [ ] **Step 2: STOP. The founder decides which corrections change the plan before any screen is drawn.**

---

# Phase 1 — UI mockups and founder approval

**No product code in this phase.** Output is screens the founder judges by eye. Each ends in an explicit gate.

### Task 1.1: The ledger exception collision

**The only open ledger question.** D-H7 established that a cell shows marks normally and surfaces the *unusual* — proven by mockup, and it rejected an amount in every cell at 8.5px. Extra time and specific hours are exceptions by the same logic. **The collision:** one day that is both paid differently *and* had specific hours needs two exceptions in one cell — which is exactly what D-H3 rejected when it threw out corner badges ("two badges collide").

**Files:** Create `docs/superpowers/mockups/2026-09-01-labour-r1/01-ledger-collision.html`

- [ ] **Step 1: Draw the approved ledger unchanged, at real size, with a real week**
- [ ] **Step 2: Add a day carrying full + night; a day carrying half; a day with extra time; a day with explicit hours; a blank unmarked day; a no-work day**
- [ ] **Step 3: Draw 2–3 treatments of the collision day (money AND hours), each at true rendered size**
- [ ] **Step 4: FOUNDER GATE — he picks one, or rules that the collision cannot occur in R1**

### Task 1.2: Two Mukadams on one day

**Files:** Create `.../02-two-mukadams.html`

- [ ] **Step 1: Draw a real day: Farm Mukadam Ganesh; Labour Mukadam Shankar with 8; Shankar's own presence shown separately and blank**
- [ ] **Step 2: Show the eight as one aggregate row — never eight rows, never invented names (rule 11)**
- [ ] **Step 3: Show the same screen the next day, with the eight NOT carried forward (no anonymous continuity)**
- [ ] **Step 4: FOUNDER GATE — does this read correctly without explaining the data model?**

### Task 1.3: Permission Centre

**Files:** Create `.../03-permission-centre.html`

- [ ] **Step 1: Draw the farm team as people, each with plain-language responsibilities (farm operations · attendance · expenses · approvals)**
- [ ] **Step 2: Show a Mukadam with attendance ON and another with it OFF, making clear the second is still the Mukadam**
- [ ] **Step 3: Use no word from: role, claim, policy, grant, ACL, permission model, membership**
- [ ] **Step 4: FOUNDER GATE — can he answer "who can do what on my farm?" in one look?**

### Task 1.4: Temporary responsibility

**Files:** Create `.../04-temporary-responsibility.html`

- [ ] **Step 1: Draw granting attendance to Prakash for today only, and until Sunday**
- [ ] **Step 2: Draw what the farm team looks like while it is active, and after it lapses**
- [ ] **Step 3: Show that history keeps saying Prakash acted, after the authority ends (accountability survives expiry)**
- [ ] **Step 4: FOUNDER GATE**

### Task 1.5: Worker second signature (concept only)

**Files:** Create `.../05-worker-confirmation.html`

- [ ] **Step 1: Draw the worker's slice ONLY — his day, his work, his hours. No farm finances, no other workers, no observations (§21)**
- [ ] **Step 2: `हे बरोबर आहे?` with `[ हो ]` and `[ काहीतरी चुकलं आहे ]` — never framed as disputing an employer (§13)**
- [ ] **Step 3: Show the farm-side view of the same event with: confirmed · proxy-confirmed · not yet confirmed — and make plain that not-confirmed is NOT absent (§10, §18)**
- [ ] **Step 4: FOUNDER GATE — does this feel dignified? Channel decisions stay out of R1.**

### Task 1.6: Founder confirmation of the whole set

- [ ] **Step 1: Present all five approved screens together as one flow**
- [ ] **Step 2: STOP. Implementation begins only after this gate.**

---

# Phase 2 — Authority (D9.10 items 3 and 5 depend on it)

**Step-level code for Phases 2–5 is written after Task 1.6, deliberately.** The screens decide the shape; writing exact handlers now would either be fiction or would pre-empt the founder's approval. Each task below states its deliverable, its test, and the constraint it must not violate — enough for an executor to size it and for the founder to see what he is approving.

### Task 2.1: Attendance as its own responsibility

**Deliverable:** attendance authority separable from the single `CanManageLabourRecords` flag, so a Mukadam can hold one and not the other.
**Test:** a member with labour-record management but *not* attendance cannot mark; the reverse also holds.
**Constraint:** extend the existing gate. Do **not** create a second permission system (founder §2, §4).
**Open until Task 0.2:** whether this is a new column, a small responsibility set, or a use of something already present.

### Task 2.2: Time-bounded authority

**Deliverable:** a grant that expires — today only, or until a date.
**Test:** an expired grant denies the action; the historical record of what the person did while authorised is unchanged.
**Constraint:** expiry must **deny forward**, never rewrite backward. Accountability survives the authority.

### Task 2.3: The permission surface

**Deliverable:** the approved Task 1.3 screen, wired.
**Test:** turning attendance off for a Mukadam actually denies the mark server-side, not only in the UI.

---

# Phase 3 — Capture (D9.10 items 3 and 4)

### Task 3.1: The labour mic anchor gate

**Deliverable:** the Labour mic activates only with an explicit labour anchor — a stated headcount on the engagement, or the explicitly-entered no-work-day flow.
**Test:** a work log with no headcount leaves the mic inactive and explains why; one with a headcount activates it.
**Constraint:** this **corrects a live drift** — the hero currently opens the mic unconditionally and auto-saves.

### Task 3.2: Context carried forward

**Deliverable:** the labour parse receives farm, date, engagement, plot and reported headcount as *known*, and is scoped to resolving composition.
**Test:** the parser does not re-ask plot, crop, work, or headcount; a transcript naming only people still resolves.
**Constraint:** rule 15 — never ask because a field is empty.

### Task 3.3: Headcount disagreement becomes a question

**Deliverable:** if the farmer says 10 where the log said 12, both statements are preserved and the conflict is surfaced.
**Test:** the original 12 is unchanged in storage; a conflict is visible; the owner resolves it (founder §7).
**Constraint:** rule 1 — no silent overwrite.

### Task 3.4: The Labour-owned result surface

**Deliverable:** `AttendanceResult.tsx` — after a labour parse the farmer sees the interpretation in Labour's own UI and returns to Labour.
**Test:** no Work Log bucket renders on this path; the farmer never lands on generic log review.
**Constraint:** replaces today's hide-the-buckets approach, which is hiding rather than owning.

---

# Phase 4 — The register (D9.10 item 8, already partly built)

### Task 4.1: The ledger reads marks

**Deliverable:** `BuildHajeriLedger` sources from `AttendanceMark` rather than deriving presence from names and engagement shift.
**Test:** an unmarked day is blank, not absent (rule 4); a half is 0.5; day+night sums above 1.
**Constraint:** the approved UI does not change (Phase 1 settles any exception treatment).

### Task 4.2: No-work-day attendance

**Deliverable:** labour present with no productive work is recordable and appears in the register.
**Test:** the day shows attendance and does **not** cause any surface to conclude work happened (rules 6 and 7).

---

# Phase 5 — The second signature slot

### Task 5.1: A place for the worker's acknowledgement

**Deliverable:** `AttendanceMark` can carry an independent second-party acknowledgement — direct, proxy, or none — without R1 building any channel.
**Test:** absence of acknowledgement is distinguishable from a worker saying "wrong" and from a worker saying "yes"; none of the three is absence of the worker.
**Constraint:** §10 — confirmation changes evidence strength, never whether the event exists. §12 — never a wage gate. §19 — no score.

---

## Appendix A — The 2026-09-01 founder lock

Reproduced because it governs this plan and exists in no committed document. Sections referenced above by number: §1 five day realities · §2 ledger is a primary surface · §3 two Mukadam meanings · §4 attendance authority is owner-granted · §5 permission centre · §6 temporary responsibility is pilot scope · §7 owner resolves contradictions · §8–10 worker confirmation as a second signature on the same event · §11 direct/proxy/none stay distinct · §12 never a wage gate · §13 disagreement without accusation · §14 correctable never silently editable · §16 no account required · §17 no fake persistent people · §18 partial coverage is legitimate · §19 no trust score in R1 · §21 smallest meaningful slice · §22 three layers: authority, subject, verification.

**North stars:**
> Labour V2 is not "attendance software"; it is the human-execution layer of ShramSafal's shared farm memory.

> The mic is universal; the conversation is contextual.

> Main Log discovers. Labour verifies.
