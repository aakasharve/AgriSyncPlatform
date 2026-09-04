# Phase 5 — Acceptance (implementation precision)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or
> superpowers:subagent-driven-development, task by task, checkbox by checkbox.

**Rewrites:** Phase 5 of `docs/superpowers/plans/2026-09-01-labour-v2-r1-human-execution-layer.md`
(Task 5.1), extended per the 2026-09-02 master-review brief with Task 5.2 (the whole-release
acceptance walk, executable) and Task 5.3 (the two standing questions, encoded as tests).

**Binding authorities, later wins:**
1. `docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md`
2. the plan's Global Constraints (incl. the 2026-09-02 supersession block)
3. `docs/superpowers/plans/2026-09-01-labour-v2-r1-PHASE0-FINDINGS.md` (file:line ground truth)
4. the REVISION-1 fence — nine settled product questions, never reopened here.

**What this phase is:** tests only. No product code, no migration, no farmer-visible change.
Phase 5 runs **LAST** — after Phases 2, 3 and 4 have landed — because every test here either
pins a shape those phases produced or walks the flow they built. Two of its tests
(`CleanRegisterRules`, the farmer-vocabulary scan) are RED against today's tree by design:
they are the acceptance bar the earlier phases must have cleared. If one is still red when
Phase 5 runs, that is the test doing its job — the fix belongs in the owning phase's files,
never in a widened test.

**Hard rules that void this phase if broken (from the brief, restated):** no farmer-facing
permission vocabulary · register clean (no money, no totals column) · never compute money or
day-fractions · blank(unknown) ≠ absent · Domain never references Infrastructure (nothing here
touches production code at all) · the unshipped `20260831180408_AddAttendanceMarks` migration is
verified unshipped by `git log origin/main -- "*AddAttendanceMarks*"` returning empty (re-verified
2026-09-02 on `feat/labour-v2-r1`) — Task 5.1 reads its sibling `20260831185516` as source, and
edits neither.

**Test idioms this phase copies (read them before writing):**
- `src/tests/AgriSync.ArchitectureTests/LabourAnchorRules.cs` — regex source scan over
  `ProductionSourceFiles()`, `StripComments`, `Relative`, FluentAssertions, **no NetArchTest**.
  Its helpers are private; the house rule written in that file is "copy, do not import".
- `src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkTests.cs` — plain xUnit `Assert`,
  static fixture ids.
- `src/clients/mobile-web/src/infrastructure/storage/dexie/__tests__/dexieVersionIntegrity.test.ts`
  — the Vitest source-scan idiom: `process.cwd()` root, comment-strip before matching, a scan
  that asserts its own scope is non-empty so a wrong cwd can never pass vacuously.

---

## Task 5.1: The attachability architecture test (no feature)

**Correction 10 locks attachability, not a field.** `AttendanceMarkCorrection` already proves
the pattern: a separate append-only table pointing at a mark by `AttendanceMarkId`
(`ShramSafal.Domain/Labour/AttendanceMarkCorrection.cs:73`), created by
`Migrations/20260831185516_AddAttendanceMarkCorrections.cs` which alters `attendance_marks` in
no way, append-only at the GRANT (`GRANT SELECT, INSERT` only — verified in that migration's
`Up()`, the `DO $$` block). A future worker acknowledgement is that same shape and needs zero
change to `AttendanceMark`. This test welds that door open.

**Caveat recorded, not built (plan text, carried verbatim):** because `Amend` mutates in place,
a future acknowledgement event MUST carry the day/night values it acknowledged, or it will
silently follow a later correction. R1 must not make that impossible — sub-test (b) is what
keeps the mark's `Id` a stable thing such an event can safely point at.

### Files

| Action | Path |
|---|---|
| **Create** | `src/tests/AgriSync.ArchitectureTests/AttendanceAttachabilityRules.cs` |
| Read-only source | `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs` (surface: FarmId :70, FieldOperatorId :76, WorkDate :79, Day :81, Night :83, RecordedByUserId :86, RecordedAtUtc :88, ModifiedAtUtc :95, Value :151-158; Amend :127-149 — line anchors verified 2026-09-02, pre-Phase-2; Phase 2 Task 2.5 adds HoursWorked/ExtraHours and shifts lines below :79) |
| Read-only source | `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMarkCorrection.cs` (`AttendanceMarkId` at :73) |
| Read-only source | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/20260831185516_AddAttendanceMarkCorrections.cs` (RLS ENABLE+FORCE and the SELECT,INSERT grant block in `Up()`) |

### Interfaces

**Consumes (from Phase 2, Task 2.5 — the post-hours domain shape):**
- `AttendanceMark.Create(Guid id, FarmId farmId, Guid fieldOperatorId, DateOnly workDate, DayMark day, NightMark night, UserId recordedByUserId, DateTime recordedAtUtc, decimal? hoursWorked = null, decimal? extraHours = null, LabourTimeBasis hoursBasis = LabourTimeBasis.Unspecified)` — trailing optionals, so the 8-argument call below compiles before AND after Task 2.5 lands.
- `AttendanceMark.Amend(DayMark day, NightMark night, decimal? hoursWorked, decimal? extraHours, LabourTimeBasis hoursBasis, UserId amendedByUserId, DateTime amendedAtUtc) : AttendanceMarkPreviousValues`
- `record AttendanceMarkPreviousValues(DayMark Day, NightMark Night, decimal? HoursWorked, decimal? ExtraHours, LabourTimeBasis HoursBasis)` (namespace `ShramSafal.Domain.Labour`)
- properties `decimal? HoursWorked`, `decimal? ExtraHours` on `AttendanceMark` (in the reflection allowlist)
- `AttendanceMark.Value` carries `[Obsolete]` (Phase 2 obsoletes it per REVISION-1's resolution table; asserted in Task 5.3, not here)

**Produces (for the checker and for CI):**
- xUnit facts `AttendanceAttachabilityRules.AttendanceMark_carries_no_acknowledgement_member`,
  `.AttendanceMark_id_survives_Amend_and_the_row_is_never_replaced`,
  `.A_second_party_event_attaches_by_AttendanceMarkId_with_no_back_reference`,
  `.The_correction_history_stays_append_only_at_the_GRANT`

### Steps

- [ ] **Step 1 — verify the migration is still unshipped and the sibling grant block still reads as cited** (repo root):
  ```bash
  git log origin/main -- "*AddAttendanceMarks*"        # expected: empty output
  git log origin/main -- "*AddAttendanceMarkCorrections*"   # expected: empty output
  grep -n "GRANT SELECT, INSERT ON ssf.attendance_mark_corrections" \
    src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/20260831185516_AddAttendanceMarkCorrections.cs
  # expected: one hit inside the DO $$ block
  ```
  If either `git log` prints commits, STOP — the edit-in-place premise of Phase 2 is dead and
  this phase must escalate, not adapt.

- [ ] **Step 2 — write the test file**, complete:

  ```csharp
  // src/tests/AgriSync.ArchitectureTests/AttendanceAttachabilityRules.cs
  using System.Reflection;
  using System.Text.RegularExpressions;
  using AgriSync.SharedKernel.Contracts.Ids;
  using FluentAssertions;
  using ShramSafal.Domain.Farms;   // LabourTimeBasis — Amend's basis parameter
  using ShramSafal.Domain.Labour;
  using Xunit;

  namespace AgriSync.ArchitectureTests;

  /// <summary>
  /// spec: 2026-09-01-labour-v2-r1 Task 5.1 (Correction 10) — attachability,
  /// not a field. A future worker acknowledgement (E1/E2, D-H10 "NOT yet
  /// decided") must be able to attach to an attendance mark the way
  /// <see cref="AttendanceMarkCorrection"/> already does: a separate row
  /// pointing at the mark by id, with the mark itself never changing shape.
  ///
  /// R1 BUILDS no acknowledgement. These pins make sure it also FORECLOSES
  /// none. One caveat is recorded here rather than built: because
  /// <c>Amend</c> mutates in place, a future acknowledgement event must
  /// carry the day/night values it acknowledged, or it will silently follow
  /// a later correction.
  /// </summary>
  public sealed class AttendanceAttachabilityRules
  {
      /// <summary>Failure text verbatim from the plan — do not reword.</summary>
      private const string AttachabilityDoor =
          "a worker's future acknowledgement must be able to point AT the mark; " +
          "if the mark ever has to change shape to accept one, R1 has closed the door " +
          "Correction 10 asked us to leave open.";

      private static readonly FarmId Farm = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
      private static readonly UserId Actor = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
      private static readonly UserId OtherActor = new(Guid.Parse("44444444-4444-4444-4444-444444444444"));
      private static readonly Guid Operator = Guid.Parse("33333333-3333-3333-3333-333333333333");
      private static readonly DateOnly WorkDate = new(2026, 9, 2);
      private static readonly DateTime At = new(2026, 9, 2, 6, 0, 0, DateTimeKind.Utc);

      // ── (a) the mark's public surface is closed, and none of it is a
      //        second-signature slot ────────────────────────────────────────

      [Fact]
      public void AttendanceMark_carries_no_acknowledgement_member()
      {
          // The complete permitted surface. Id + DomainEvents come from
          // Entity<Guid>; HoursWorked/ExtraHours land with Phase 2 Task 2.5
          // (allow-listed now so this pin does not fight that task); Value is
          // shipped, obsoleted by Phase 2, and pinned out of read paths by
          // CleanRegisterRules — its existence is not an attachment slot.
          var allowed = new[]
          {
              "Id", "DomainEvents",
              "FarmId", "FieldOperatorId", "WorkDate",
              "Day", "Night", "HoursWorked", "ExtraHours",
              "RecordedByUserId", "RecordedAtUtc", "ModifiedAtUtc",
              "Value",
          };

          var actual = typeof(AttendanceMark)
              .GetProperties(BindingFlags.Public | BindingFlags.Instance)
              .Select(p => p.Name)
              .ToArray();

          actual.Should().BeSubsetOf(allowed, AttachabilityDoor);

          // Belt and braces: even a future edit to the allowlist must never
          // admit a name that smells like a second signature.
          var secondSignature = new Regex(
              "acknowledg|confirm|verif|signature|dispute|witness",
              RegexOptions.IgnoreCase);
          actual.Where(name => secondSignature.IsMatch(name))
              .Should().BeEmpty(AttachabilityDoor);
      }

      // ── (b) the Id is a stable external key: Amend re-rules in place and
      //        never replaces the row ─────────────────────────────────────────

      [Fact]
      public void AttendanceMark_id_survives_Amend_and_the_row_is_never_replaced()
      {
          var mark = AttendanceMark.Create(
              Guid.NewGuid(), Farm, Operator, WorkDate,
              DayMark.Half, NightMark.Unmarked, Actor, At);
          var idBefore = mark.Id;

          var previous = mark.Amend(
              DayMark.Full, NightMark.Worked, null, null, LabourTimeBasis.Unspecified,
              OtherActor, At.AddHours(3));

          mark.Id.Should().Be(idBefore, AttachabilityDoor);
          previous.Day.Should().Be(DayMark.Half,
              "Amend hands back what it changed FROM so the caller writes the correction row");
          previous.Night.Should().Be(NightMark.Unmarked,
              "Amend hands back what it changed FROM so the caller writes the correction row");
      }

      // ── (c) the attach pattern exists in production: at least one Labour
      //        domain type points at a mark by id, and the mark points back at
      //        nothing ──────────────────────────────────────────────────────

      [Fact]
      public void A_second_party_event_attaches_by_AttendanceMarkId_with_no_back_reference()
      {
          var labourTypes = typeof(AttendanceMark).Assembly.GetTypes()
              .Where(t => t.IsPublic
                          && t.Namespace == "ShramSafal.Domain.Labour"
                          && t != typeof(AttendanceMark))
              .ToArray();

          var attachers = labourTypes
              .Where(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                  .Any(p => p.Name == "AttendanceMarkId" && p.PropertyType == typeof(Guid)))
              .ToArray();

          attachers.Should().NotBeEmpty(
              "AttendanceMarkCorrection is the shipped proof that a second-party event can " +
              "point AT a mark by AttendanceMarkId (AttendanceMarkCorrection.cs:73) — " +
              AttachabilityDoor);

          foreach (var property in typeof(AttendanceMark)
              .GetProperties(BindingFlags.Public | BindingFlags.Instance))
          {
              var type = property.PropertyType;
              var constituents = type.IsArray
                  ? new[] { type.GetElementType()! }
                  : type.IsGenericType
                      ? type.GetGenericArguments()
                      : Array.Empty<Type>();

              attachers.Should().NotContain(type,
                  "a back-reference (navigation) on the mark would make the mark's shape " +
                  "depend on its attachers — " + AttachabilityDoor);
              foreach (var constituent in constituents)
              {
                  attachers.Should().NotContain(constituent,
                      "a collection navigation on the mark is a back-reference too — " +
                      AttachabilityDoor);
              }
          }
      }

      // ── E2: the append-only mechanism survives, at the GRANT, in the
      //        creating migration ───────────────────────────────────────────

      [Fact]
      public void The_correction_history_stays_append_only_at_the_GRANT()
      {
          // Migrations/ is excluded from ProductionSourceFiles() by design, so
          // this test names the file directly. GetSolutionRoot() returns
          // <repo>/src (see LabourAnchorRules' path note).
          var migration = Path.Combine(
              TestPathHelper.GetSolutionRoot(),
              "apps", "ShramSafal", "ShramSafal.Infrastructure",
              "Persistence", "Migrations",
              "20260831185516_AddAttendanceMarkCorrections.cs");

          File.Exists(migration).Should().BeTrue(
              "the creating migration is the ONLY carrier of the append-only grant; " +
              "if it moved or was renamed this pin must follow it deliberately, not vanish");

          var source = File.ReadAllText(migration);

          source.Should().Contain(
              "GRANT SELECT, INSERT ON ssf.attendance_mark_corrections",
              "append-only is enforced at the GRANT (SELECT + INSERT only), not by convention — " +
              "a history that can itself be edited answers nothing at all (E2)");

          Regex.IsMatch(
                  source,
                  @"GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*ON\s+ssf\.attendance_mark_corrections")
              .Should().BeFalse(
                  "no grant may ever widen the corrections table beyond SELECT + INSERT (E2)");

          source.Should().Contain("ENABLE ROW LEVEL SECURITY",
              "RLS enabled AND forced is a hard rule for every ssf table");
          source.Should().Contain("FORCE ROW LEVEL SECURITY",
              "enable alone leaves the table owner outside the policy");
      }
  }
  ```

- [ ] **Step 3 — run, expect GREEN on (b), (c), (E2) and on (a) only if Phase 2 landed**
  (repo root):
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj \
    --filter "FullyQualifiedName~AttendanceAttachabilityRules"
  ```
  Expected: **compiles only after Phase 2 Task 2.5** (the seven-argument `Amend` in test (b) is
  the post-2.5 signature). If it does not compile, Phase 2 is not done — stop and report,
  do not water the call down to the four-argument form. When it compiles: 4 passed.

- [ ] **Step 4 — prove the pin bites (red-proof, then revert).** Temporarily add to
  `AttendanceMark.cs`, beside the other properties:
  ```csharp
  public Guid? WorkerAcknowledgementId { get; private set; }
  ```
  Re-run the Step 3 command. Expected: `AttendanceMark_carries_no_acknowledgement_member`
  FAILS, and the failure output contains the verbatim sentence *"R1 has closed the door
  Correction 10 asked us to leave open."* Then revert:
  ```bash
  git checkout -- src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs
  ```
  Re-run: 4 passed.

- [ ] **Step 5 — commit** (pre-commit runs `dotnet format`; if it blocks, format and re-stage):
  ```bash
  git add src/tests/AgriSync.ArchitectureTests/AttendanceAttachabilityRules.cs
  git commit -m "test(arch): attendance-mark attachability pin — Correction 10 stays an open door"
  ```

---

## Task 5.2: The whole-release acceptance walk — executable

The founder's complete flow (REVISION-1 § "Test against the founder's complete flow") becomes
a checklist an executor RUNS, row by row. Every row names the concrete test(s) that prove it —
file + test name + the exact command. Rows whose tests belong to Phases 2–4 CONSUME those
phases' precision docs; the two rows that had no owning test anywhere get theirs **here**
(5.2-G1 below, and Task 5.1 for the last row).

**Consumed test names are contracts.** Where a Phase 2–4 precision doc names its test
differently, the checker reconciles by task number — the ROW→TASK mapping below is the stable
key, the file/test names are this phase's expected bindings.

### Files

| Action | Path |
|---|---|
| **Create** | `src/tests/AgriSync.ArchitectureTests/FieldOperatorSingleProducerRules.cs` (gap test 5.2-G1) |
| Read-only | every test file named in the walk table |

### Interfaces

**Consumes (test bindings from the other precision phases):**

| From | File | Test |
|---|---|---|
| Phase 2 / 2.1 | `src/tests/ShramSafal.Domain.Tests/Labour/LabourManagementPermissionTests.cs` | `A_Mukadam_without_a_grant_is_denied_and_only_the_owners_switch_changes_that` (the inverse rewrite of `A_Mukadam_is_allowed_with_no_grant_at_all`) |
| Phase 2 / 2.2 | `src/tests/ShramSafal.Domain.Tests/Labour/LabourCapabilityGateTests.cs` | `An_expired_grant_denies_forward_and_the_stored_decision_is_untouched` |
| Phase 2 / 2.4 | `src/tests/AgriSync.ArchitectureTests/LabourLedgerReadRules.cs` | `LabourLedgerReadRules.Ledger_and_labour_reads_never_consult_the_write_authority_gate` |
| Phase 3 / 3.1 | `src/clients/mobile-web/src/features/labour/__tests__/labourAnchor.test.ts` + `src/clients/mobile-web/src/features/labour/components/__tests__/LabourHub.test.tsx` | "a Draft log carrying a parsed 12 is NOT an anchor" · "the same log after confirmation IS the anchor, headcount carried forward" · "no anchor: hero inactive, approved reason rendered, ledger tile untouched" |
| Phase 3 / 3.2 | `src/clients/mobile-web/src/features/labour/__tests__/attendanceLadder.test.ts` | four rung cases (`selectLadderRung`) — only the missing facts are asked (rule 15) |
| Phase 3 / 3.3 | `src/tests/ShramSafal.Domain.Tests/Labour/Handlers/RecordAttendanceMarkHandlerTests.cs` | `Two_disagreeing_engagement_facts_return_Contradicted_and_stage_nothing` — both statements preserved, nothing overwritten |
| Phase 3 / 3.4a+3.4b | `src/clients/mobile-web/src/core/navigation/__tests__/labourResultOwnership.test.tsx` | "a labour-intent draft renders AttendanceResult, and handleManualSubmit is NOT called by rendering" — nothing persists until बरोबर |
| Phase 3 / 3.4b | `src/clients/mobile-web/src/features/labour/components/__tests__/AttendanceResult.test.tsx` | "nothing is saved until बरोबर; बरोबर saves exactly once" |
| Phase 3 / 3.5 | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/AttendanceMarkSyncRealPostgresTests.cs` | "an offline mark is reconstructable without the originating device after /sync/push" (P10) |
| Phase 3 / 3.5 | `src/clients/mobile-web/src/features/labour/__tests__/attendanceP10.test.ts` | "a queued mark is `source: 'queue'` — unsynchronised intent, never rendered as saved" |
| Phase 4 / 4.0+4.1 | `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx` (+ `LabourHub.test.tsx` from 3.1) | "the हजेरी वही tile renders on a real farm (no preview, no flag)" · "zero rows still draw the week" |
| Phase 4 / 4.1 | `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs` (rewritten) | "zero named people and zero marks still renders seven blank day columns" · "an unmarked day is blank, not absent" · "a Full+Night day is two marks, never a summed number" |
| Phase 4 / 4.2 | `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs` | "a no-work day shows attendance and asserts no work happened" |
| Phase 4 / 4.3 | `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs` (`TwoWorksOneDayIsOneRowOneCellAndNoCountChanges`) + `src/tests/ShramSafal.Sync.IntegrationTests/Labour/AttendanceMarkUniqueIndexRealPostgresTests.cs` + `Handlers/RecordAttendanceMarkHandlerTests.cs` (`Two_CONSISTENT_facts_ask_nothing`) | one mark per (farm, operator, date): structural proof, the 23505 safety net, and consistent contexts asking nothing |
| Phase 4 / 4.5 | `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriCellDetail.test.tsx` | "reads the week dimensionally and never as one number" |

**Produces:**
- xUnit fact `FieldOperatorSingleProducerRules.FieldOperator_is_constructed_in_exactly_one_production_file`
- the executable walk table below (the release's Founder Acceptance Gate evidence sheet —
  every row's command output is the pointer the founder verifies against).

### The walk — run every row, tick every box

Commands: backend rows from the repo root; frontend rows from `src/clients/mobile-web`.

- [ ] **Row 1 — natural main log (untouched; D9.7 keeps the generic parser unrestricted).**
  ```bash
  cd src/clients/mobile-web && npx vitest run src/core/domain/__tests__/LogFactory.oneEngagementOneQuantity.test.ts && npm run test:voice-pipeline
  ```
  Expected: green, zero source changes under `features/logs/` or the generic prompt in this
  release's diff (`git diff origin/main --stat -- src/clients/mobile-web/src/features/logs src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Prompts/core` — labour-parse additions only; anything touching the generic buckets is drift).
- [ ] **Row 2 — work truth recorded (existing `LabourAssignment` path).**
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj --filter "FullyQualifiedName~LabourAnchorRules"
  ```
  Expected: 2 passed (single-producer pin + WTL A8 pin).
- [ ] **Row 3 — labour info carried forward.** Phase 3/3.2 binding:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/features/labour/__tests__/attendanceLadder.test.ts
  ```
- [ ] **Row 4 — anchor exists** and **Row 5 — mic available.** Phase 3/3.1 binding:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/features/labour/__tests__/labourAnchor.test.ts src/features/labour/components/__tests__/LabourHub.test.tsx
  ```
- [ ] **Row 6 — ask only WHO.** Row 3's ladder file plus 3.4b's `AttendanceResult.test.tsx` — confirm the rung-3 case
  asserts the remainder question only (यांच्याशिवाय अजून कोण होते?) and the rung-4 case asserts
  only हे बरोबर आहे का?.
- [ ] **Row 7 — labour-owned result.** Phase 3/3.4b binding:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/AttendanceResult.test.tsx
  ```
- [ ] **Row 8 — confirm / correct (बरोबर is the only save event).** Phase 3/3.4a+b binding:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/core/navigation/__tests__/labourResultOwnership.test.tsx src/features/labour/components/__tests__/AttendanceResult.test.tsx
  ```
- [ ] **Row 9 — one person, two works = one attendance.** Phase 4/4.3 binding:
  ```bash
  dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~RecordAttendanceMarkHandlerTests|FullyQualifiedName~BuildHajeriLedgerTests.TwoWorksOneDay"
  dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~AttendanceMarkUniqueIndexRealPostgresTests"
  ```
- [ ] **Row 10 — anonymous stays anonymous.** GAP ROW — test added HERE: 5.2-G1 (below):
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj --filter "FullyQualifiedName~FieldOperatorSingleProducerRules"
  ```
- [ ] **Row 11 — ledger available throughout.** Phase 4/4.0+4.1 bindings:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx src/features/labour/components/__tests__/LabourHub.test.tsx
  dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~BuildHajeriLedgerTests"
  ```
- [ ] **Row 12 — weekly memory (dimensional, never one number).** Phase 4/4.5 binding plus this
  phase's contract pin:
  ```bash
  cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/HajeriCellDetail.test.tsx
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj --filter "FullyQualifiedName~CleanRegisterRules"
  ```
- [ ] **Row 13 — future acknowledgement can attach.** This phase, Task 5.1:
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj --filter "FullyQualifiedName~AttendanceAttachabilityRules"
  ```
- [ ] **Whole-suite close:** from the repo root and then from `src/clients/mobile-web`:
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/
  dotnet test src/tests/ShramSafal.Domain.Tests/
  cd src/clients/mobile-web && npm run test
  ```
  Expected: all green. Any red names the owning phase; fix lands there.

### 5.2-G1: anonymous stays anonymous — one production door mints a `FieldOperator`

Row 10's guarantee is structural: no read path, ledger builder, crew display or sync handler
may fabricate a `FieldOperator` out of a bare count or a spoken name (trust rules 10, 11;
D9.12; the `IWorkerRepository.cs:17-29` prohibition). The cheapest weld is the same
single-producer pin `LabourAnchorRules` PIN 1 uses: today exactly ONE production file calls
`FieldOperator.Create(` — verified 2026-09-02:
`src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/CreateFieldOperator/CreateFieldOperatorHandler.cs`
(the only other textual hit is a doc comment in `FieldOperator.cs`, which `StripComments`
removes).

- [ ] **Step 1 — write the failing-proof first.** Create the file below, then before running,
  temporarily plant `var x = FieldOperator.Create(` inside a comment-free line of any other
  production file? **No — do not plant code in production files.** The bite-proof for a
  ContainSingle pin is the inverse: run the test as written (Step 2, expect green), then
  temporarily change `ExpectedProducerPath` to a wrong path and re-run — expect the SECOND
  assertion to fail naming the real handler. Revert the constant.

  ```csharp
  // src/tests/AgriSync.ArchitectureTests/FieldOperatorSingleProducerRules.cs
  using System.Text.RegularExpressions;
  using FluentAssertions;
  using Xunit;

  namespace AgriSync.ArchitectureTests;

  /// <summary>
  /// spec: 2026-09-01-labour-v2-r1, Phase 5 acceptance walk row 10 —
  /// "anonymous stays anonymous" made structural. A FieldOperator is a work
  /// IDENTITY (a name someone actually said); trust rules 10/11 and D9.12
  /// forbid minting one from a crew count, a fuzzy name match, or a ledger
  /// row. One production door creates them, so nothing downstream — ledger
  /// build, crew display, sync, contradiction handling — can fabricate a
  /// person as a side effect. Same idiom as LabourAnchorRules PIN 1.
  /// </summary>
  public sealed class FieldOperatorSingleProducerRules
  {
      private const string ExpectedProducerPath =
          "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/CreateFieldOperator/CreateFieldOperatorHandler.cs";

      [Fact]
      public void FieldOperator_is_constructed_in_exactly_one_production_file()
      {
          var producers = ProductionSourceFiles()
              .Where(path => StripComments(File.ReadAllText(path))
                  .Contains("FieldOperator.Create(", StringComparison.Ordinal))
              .Select(Relative)
              .OrderBy(path => path, StringComparer.Ordinal)
              .ToArray();

          producers.Should().ContainSingle(
              "a FieldOperator is an identity someone stated, never a fabrication — a second " +
              "construction site means some code path can mint a person from a count or a guess " +
              $"(trust rules 10/11, D9.12). Found: [{string.Join(", ", producers)}]");

          producers[0].Should().Be(ExpectedProducerPath,
              "the single construction site must be the create-operator use case, " +
              "not whichever caller got there first");
      }

      // ── copied from LabourAnchorRules (private there; copy, do not import) ──

      private static IEnumerable<string> ProductionSourceFiles()
      {
          var srcRoot = TestPathHelper.GetSolutionRoot();

          return Directory
              .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
              .Where(path =>
                  !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
      }

      private static string Relative(string fullPath) =>
          Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

      private static string StripComments(string source)
      {
          var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
          return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
      }
  }
  ```

- [ ] **Step 2 — run, expect green** (1 passed):
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj \
    --filter "FullyQualifiedName~FieldOperatorSingleProducerRules"
  ```
  **If RED with two producers:** Phase 3's `RecordAttendanceMarkHandler` or Phase 4's ledger
  work added a second `FieldOperator.Create(` call. That is the pin working — the fix is in
  that phase (route creation through the use case), never a widened exclusion.

- [ ] **Step 3 — bite-proof:** change `ExpectedProducerPath` to
  `"apps/ShramSafal/WRONG.cs"`, re-run, expect the exact-path assertion to fail naming
  `CreateFieldOperatorHandler.cs`. Revert the constant, re-run green.

- [ ] **Step 4 — commit:**
  ```bash
  git add src/tests/AgriSync.ArchitectureTests/FieldOperatorSingleProducerRules.cs
  git commit -m "test(arch): one production door mints a FieldOperator — anonymous stays anonymous"
  ```

---

## Task 5.3: The two standing questions, encoded

> **Did ShramSafal remember enough that the farmer had to tell us less than before?**
> **Did we preserve farm reality without inventing certainty?**

Encoded as the two mechanical failures those questions always catch: (a) permission
vocabulary leaking into a farmer's screen (the system making the farmer learn ITS words),
and (b) the register inventing certainty (money or a total nobody stated). Four tests, two
per question side, client and server.

### Files

| Action | Path |
|---|---|
| **Create** | `src/clients/mobile-web/src/features/labour/__tests__/farmerVocabulary.scan.test.ts` |
| **Create** | `src/tests/AgriSync.ArchitectureTests/FarmerFacingVocabularyRules.cs` |
| **Create** | `src/tests/AgriSync.ArchitectureTests/CleanRegisterRules.cs` |
| **Create** | `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx` |
| Read-only | `src/clients/mobile-web/src/features/profile/components/TeamMemberCard.tsx` (**live offender verified 2026-09-02: line 180, JSX text "Comes with their role"**) and `src/clients/mobile-web/src/features/profile/sections/IdentitySection.tsx` (the two authority surfaces D5 re-copies) |

### Interfaces

**Consumes (from Phase 4, Tasks 4.1 + 4.4 — the post-clean-register client contract):**
- `HajeriLedger` default export, props `{ data: LabourData; onToast: (m: string) => void }` (unchanged);
- `labour.types.ts` ledger types WITHOUT totals:
  `LedgerCell { day: 'full' | 'half' | 'absent' | null; night: 'worked' | 'notworked' | null; hours: number | null; extraHours: number | null; ukte: boolean; work: string | null }`,
  `LedgerRow { personId: string; fieldOperatorId: string; name: string; initial: string; tone: AvatarTone; cells: (LedgerCell | null)[] }` — **no `total` member**,
  the `LabourData['ledger']` shape `{ weekLabel: string; days: string[]; rows: LedgerRow[]; crewRows: LedgerCrewRow[] }` — **no `weekTotal`, no `dailyTotals`**;
- DOM contract: `data-testid="ledger-row"` on each person/crew row container and
  `data-testid="ledger-cell"` on each of its seven day cells (ledger-cell already exists;
  **ledger-row is a one-attribute requirement on Phase 4's rebuilt component**);
- backend: `LabourLedgerDto` / `LabourLedgerRowDto` with `Total`, `WeekTotal`, `DailyTotals`
  removed (`Contracts/Dtos/LabourDataDto.cs` — today declared at :202-231, verified);
- `AttendanceMark.Value` carrying `[Obsolete]` (from Phase 2).

**Consumes (from Phase 2, D5 copy):** the approved authority strings replacing the English at
`TeamMemberCard.tsx:178-181` and `IdentitySection.tsx:466-468` — ON state
**कामगारांची जबाबदारी आहे**, flow **जबाबदारी द्या**, chips आज · 2 दिवस · 3 दिवस · तारीख · कायम,
expiry line pattern "…नंतर जबाबदारी आपोआप संपेल".

**Produces:**
- Vitest suite `farmerVocabulary.scan.test.ts` — tests
  `"the scan scope is non-empty"`,
  `"no farmer-facing labour string contains permission vocabulary or a hardcoded English ON/OFF"`;
- xUnit facts `FarmerFacingVocabularyRules.No_farmer_facing_server_string_carries_permission_vocabulary`,
  `CleanRegisterRules.The_ledger_grid_contract_carries_no_money_and_no_totals`,
  `CleanRegisterRules.AttendanceMark_Value_is_obsolete_so_no_new_reader_can_collapse_a_week`;
- Vitest suite `HajeriLedgerClean.test.tsx` — tests
  `"the register renders no ₹ anywhere"`,
  `"every row is name + one cell per day, nothing trailing"`,
  `"no totals row renders"`.

### Steps

- [ ] **Step 1 — the client vocabulary scan (write it, expect RED today).** Farmer-facing =
  (i) every string literal containing Devanagari, plus (ii) every JSX text node, across
  `src/features/labour/**` (tests excluded) and the two authority surfaces. Forbidden:
  `permission/grant/role/claim/policy/access` in Latin (any case, whole word) and a
  hardcoded uppercase `ON`/`OFF`.

  ```ts
  // src/clients/mobile-web/src/features/labour/__tests__/farmerVocabulary.scan.test.ts
  // @vitest-environment node
  /**
   * @license
   * SPDX-License-Identifier: Apache-2.0
   *
   * Phase 5 Task 5.3 (founder master review 2026-09-02, D5): "No farmer-facing
   * permission vocabulary, ever: not permission, grant, role, claim, policy,
   * access." The ON-state reads "कामगारांची जबाबदारी आहे" — never a hardcoded
   * English ON/OFF.
   *
   * Farmer-facing means: any string literal containing Devanagari, and any JSX
   * text node, in the Labour feature and on the two authority surfaces
   * (TeamMemberCard, IdentitySection) that D5 re-copies. Code identifiers,
   * class names, testids and attribute values stay out of scope — the farmer
   * never reads them.
   *
   * Source-scan idiom copied from dexieVersionIntegrity.test.ts: cwd-rooted,
   * comments stripped first, and the scope asserted non-empty so a wrong cwd
   * can never pass vacuously.
   */
  import { describe, it, expect } from 'vitest';
  import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
  import { join } from 'node:path';

  const ROOT = process.cwd(); // vitest root = src/clients/mobile-web
  const LABOUR_DIR = join(ROOT, 'src', 'features', 'labour');
  const AUTHORITY_SURFACES = [
      join(ROOT, 'src', 'features', 'profile', 'components', 'TeamMemberCard.tsx'),
      join(ROOT, 'src', 'features', 'profile', 'sections', 'IdentitySection.tsx'),
  ];

  const PERMISSION_VOCAB = /\b(permissions?|grants?|granted|roles?|claims?|polic(?:y|ies)|access)\b/i;
  const HARDCODED_ON_OFF = /(?<![A-Za-z])(?:ON|OFF)(?![A-Za-z])/; // uppercase only — 'on'/'off' prose stays legal
  const DEVANAGARI = /[ऀ-ॿ]/;

  function collect(dir: string): string[] {
      const out: string[] = [];
      for (const name of readdirSync(dir)) {
          if (name === '__tests__' || name === 'node_modules') continue;
          const full = join(dir, name);
          if (statSync(full).isDirectory()) out.push(...collect(full));
          else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
      }
      return out;
  }

  /** Same caveat as dexieVersionIntegrity: prose must never fail (or pass) a scan. */
  function stripComments(source: string): string {
      return source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[^\S\r\n]*\/\/.*$/gm, '');
  }

  /** (i) Devanagari-bearing string literals; (ii) JSX text nodes. */
  function farmerFacingStrings(source: string): string[] {
      const stripped = stripComments(source);
      const out: string[] = [];

      const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
      for (const m of stripped.matchAll(literal)) {
          const text = m[1] ?? m[2] ?? m[3] ?? '';
          if (DEVANAGARI.test(text)) out.push(text);
      }

      // JSX text: between a closing '>' and the next '<', containing no braces
      // (expressions) — filtered of code-looking captures so `a > b && c < d`
      // fragments can only false-NEGATIVE, never false-positive.
      const jsxText = />([^<>{}]+)</g;
      for (const m of stripped.matchAll(jsxText)) {
          const text = m[1].trim();
          if (text.length > 0 && /[A-Za-zऀ-ॿ]/.test(text) && !/[();=]/.test(text)) {
              out.push(text);
          }
      }
      return out;
  }

  describe('farmer-facing labour vocabulary (D5: no permission words, no English ON/OFF)', () => {
      const files = [...collect(LABOUR_DIR), ...AUTHORITY_SURFACES.filter(existsSync)];

      it('the scan scope is non-empty', () => {
          // A moved directory must break the scan loudly, not hollow it out.
          expect(files.length).toBeGreaterThan(10);
          expect(AUTHORITY_SURFACES.every(existsSync)).toBe(true);
      });

      it('no farmer-facing labour string contains permission vocabulary or a hardcoded English ON/OFF', () => {
          const offenders: string[] = [];
          for (const file of files) {
              for (const text of farmerFacingStrings(readFileSync(file, 'utf8'))) {
                  if (PERMISSION_VOCAB.test(text) || HARDCODED_ON_OFF.test(text)) {
                      offenders.push(`${file.slice(ROOT.length + 1)}: "${text}"`);
                  }
              }
          }
          // The farmer's words are जबाबदारी द्या / कामगारांची जबाबदारी आहे —
          // permission, grant, role, claim, policy, access and hardcoded ON/OFF
          // are OUR words, and they may never reach his screen (founder master
          // review 2026-09-02, D5).
          expect(offenders).toEqual([]);
      });
  });
  ```

- [ ] **Step 2 — run, see the KNOWN failure** (from `src/clients/mobile-web`):
  ```bash
  npx vitest run src/features/labour/__tests__/farmerVocabulary.scan.test.ts
  ```
  Expected **if Phase 2's D5 copy has not yet replaced the shipped English**: RED with the
  offender `src/features/profile/components/TeamMemberCard.tsx: "Comes with their role"`
  (live at :180, verified 2026-09-02). The fix belongs to Phase 2 (the D5 copy set) — report
  it there; do not weaken the scan. Expected **if Phase 2 landed first**: GREEN — then prove
  the scan bites: temporarily change that label's replacement to `Comes with their role`,
  re-run RED, revert, re-run GREEN.

- [ ] **Step 3 — the server-side vocabulary pin** (green today — verified by grep 2026-09-02;
  it exists to stay green when Phase 3's contradiction contract tempts someone to compose a
  farmer sentence server-side — the plan's "no `text` member" rule):

  ```csharp
  // src/tests/AgriSync.ArchitectureTests/FarmerFacingVocabularyRules.cs
  using System.Text.RegularExpressions;
  using FluentAssertions;
  using Xunit;

  namespace AgriSync.ArchitectureTests;

  /// <summary>
  /// Phase 5 Task 5.3 (founder master review 2026-09-02, D5) — the server half.
  /// A Devanagari string literal in ShramSafal production code is farmer-facing
  /// by construction (Marathi exists in this codebase for exactly one reader).
  /// None may carry Latin permission vocabulary or a hardcoded English ON/OFF.
  /// The contradiction contract deliberately has no text member — the server
  /// never composes a farmer-facing sentence; this pin keeps both true.
  /// </summary>
  public sealed class FarmerFacingVocabularyRules
  {
      [Fact]
      public void No_farmer_facing_server_string_carries_permission_vocabulary()
      {
          var stringLiteral = new Regex("\"(?:[^\"\\\\]|\\\\.)*\"");
          var devanagari = new Regex(@"[ऀ-ॿ]");
          var vocabulary = new Regex(
              @"\b(permissions?|grants?|granted|roles?|claims?|polic(?:y|ies)|access)\b",
              RegexOptions.IgnoreCase);
          var hardcodedOnOff = new Regex(@"(?<![A-Za-z])(?:ON|OFF)(?![A-Za-z])");

          var offenders = new List<string>();
          foreach (var path in ProductionSourceFiles()
              .Where(p => Relative(p).StartsWith("apps/ShramSafal/", StringComparison.Ordinal)))
          {
              var source = StripComments(File.ReadAllText(path));
              foreach (Match match in stringLiteral.Matches(source))
              {
                  if (!devanagari.IsMatch(match.Value)) continue;
                  if (vocabulary.IsMatch(match.Value) || hardcodedOnOff.IsMatch(match.Value))
                  {
                      offenders.Add($"{Relative(path)}: {match.Value}");
                  }
              }
          }

          offenders.Should().BeEmpty(
              "the farmer's words are जबाबदारी, not permission/grant/role/claim/policy/access — " +
              "a Marathi string carrying our vocabulary teaches him OUR model instead of " +
              $"remembering his (D5, 2026-09-02). Offenders: [{string.Join(", ", offenders)}]");
      }

      // ── copied from LabourAnchorRules (private there; copy, do not import) ──

      private static IEnumerable<string> ProductionSourceFiles()
      {
          var srcRoot = TestPathHelper.GetSolutionRoot();

          return Directory
              .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
              .Where(path =>
                  !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                  !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
      }

      private static string Relative(string fullPath) =>
          Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

      private static string StripComments(string source)
      {
          var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
          return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
      }
  }
  ```

  Run and expect green (1 passed):
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj \
    --filter "FullyQualifiedName~FarmerFacingVocabularyRules"
  ```

- [ ] **Step 4 — the clean-register contract pin (backend), RED against today's tree by
  design.** Today `LabourLedgerRowDto` carries `Total` and `LabourLedgerDto` carries
  `DailyTotals` + `WeekTotal` (`Contracts/Dtos/LabourDataDto.cs:202-231`, verified) — the
  exact members the 2026-09-02 D4 ruling removes. This test is the acceptance bar Phase 4
  Task 4.4 must clear.

  ```csharp
  // src/tests/AgriSync.ArchitectureTests/CleanRegisterRules.cs
  using System.Reflection;
  using System.Text.RegularExpressions;
  using FluentAssertions;
  using ShramSafal.Application.Contracts.Dtos;
  using ShramSafal.Domain.Labour;
  using Xunit;

  namespace AgriSync.ArchitectureTests;

  /// <summary>
  /// Phase 5 Task 5.3 (founder master review 2026-09-02, D4): "नावाखाली
  /// कोणताही summary, कामाचा मजकूर किंवा पैशांची कळ नाही. नाव + दिवसाचे खूण
  /// एवढेच." The register grid is name + seven day cells — no money in any
  /// cell, no totals column of ANY kind (not days, not people, not money).
  /// Supersedes D-H7's in-grid money and the WeekTotal/Total contract.
  /// Money lives on the Labour home (two cards) and in tap-detail; the
  /// dimensional week read lives in detail. Never-CALCULATE still binds
  /// everywhere.
  /// </summary>
  public sealed class CleanRegisterRules
  {
      private const string CleanRegister =
          "the register is name + seven day cells, nothing trailing — no money in the grid, " +
          "no totals column of any kind (founder master review 2026-09-02, D4). Money is only " +
          "ever DISPLAYED where stated (Labour home, tap-detail), never summed into the grid, " +
          "and a week is never collapsed into one number";

      /// <summary>
      /// Walks the ledger DTO's whole public property graph (within the
      /// Application assembly) so a money or total member can never hide one
      /// record deeper — e.g. on the cell record Task 4.1 introduces.
      /// Substring match on purpose: DTO members are PascalCase, so
      /// "WeekTotal" has no word boundary before "Total".
      /// </summary>
      [Fact]
      public void The_ledger_grid_contract_carries_no_money_and_no_totals()
      {
          var forbidden = new Regex("total|cost|wage|amount|money|rupee|paid",
              RegexOptions.IgnoreCase);
          var assembly = typeof(LabourLedgerDto).Assembly;
          var visited = new HashSet<Type>();
          var queue = new Queue<Type>();
          queue.Enqueue(typeof(LabourLedgerDto));
          var offenders = new List<string>();

          while (queue.Count > 0)
          {
              var type = queue.Dequeue();
              if (!visited.Add(type)) continue;

              foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
              {
                  if (forbidden.IsMatch(property.Name))
                  {
                      offenders.Add($"{type.Name}.{property.Name}");
                  }

                  foreach (var constituent in Constituents(property.PropertyType))
                  {
                      if (constituent.Assembly == assembly) queue.Enqueue(constituent);
                  }
              }
          }

          offenders.Should().BeEmpty(
              CleanRegister + $". Offenders: [{string.Join(", ", offenders)}]");
      }

      /// <summary>
      /// The week is never collapsed into one number, and
      /// <c>AttendanceMark.Value</c> is the one member that could manufacture
      /// the equivalence (Full+Night=2; Unmarked collapses to 0 against its own
      /// doc comment — Phase 0 C12). Phase 2 obsoletes it; this pins the
      /// obsoletion so no NEW reader compiles against it warning-free.
      /// </summary>
      [Fact]
      public void AttendanceMark_Value_is_obsolete_so_no_new_reader_can_collapse_a_week()
      {
          var value = typeof(AttendanceMark).GetProperty("Value");

          value.Should().NotBeNull(
              "deleting Value outright is itself a night-arithmetic decision the founder has " +
              "not made — REVISION-1 resolved obsolete-and-defer, not delete");
          value!.GetCustomAttribute<ObsoleteAttribute>().Should().NotBeNull(
              "night arithmetic is NOT decided; Value must stay out of every R1 read path, " +
              "and [Obsolete] is what makes a new consumption visible at compile time");
      }

      private static IEnumerable<Type> Constituents(Type type)
      {
          if (type.IsArray)
          {
              yield return type.GetElementType()!;
              yield break;
          }

          if (type.IsGenericType)
          {
              foreach (var argument in type.GetGenericArguments())
              {
                  foreach (var constituent in Constituents(argument))
                  {
                      yield return constituent;
                  }
              }

              yield break;
          }

          yield return type;
      }
  }
  ```

- [ ] **Step 5 — run, see the KNOWN failures** (repo root):
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj \
    --filter "FullyQualifiedName~CleanRegisterRules"
  ```
  Expected against a tree where Phase 4.4 / Phase 2 have not landed: RED twice —
  `The_ledger_grid_contract...` naming exactly `LabourLedgerRowDto.Total`,
  `LabourLedgerDto.DailyTotals`, `LabourLedgerDto.WeekTotal`, and
  `AttendanceMark_Value_is_obsolete...` on the missing `[Obsolete]`. Both greens are owed by
  the earlier phases; when Phase 5 runs last, expect 2 passed. Either way the failure list
  must contain ONLY the named members — any extra offender is new drift to escalate.

- [ ] **Step 6 — the clean-register render test (frontend).** Consumes Phase 4's rebuilt
  `HajeriLedger` and post-4.4 types (see Interfaces).

  ```tsx
  // src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx
  // @vitest-environment jsdom
  /**
   * @license
   * SPDX-License-Identifier: Apache-2.0
   *
   * Phase 5 Task 5.3 (founder master review 2026-09-02, D4) — the render half
   * of the clean register: no ₹ anywhere in the grid, no totals column, no
   * totals row. Name + seven day cells, details only on tap.
   *
   * Companion pins that stay where they are: AttendanceDefaultsBlank.test.tsx
   * owns blank(unknown) ≠ absent; CleanRegisterRules.cs owns the DTO contract.
   */
  import React from 'react';
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { render, cleanup } from '@testing-library/react';
  import '@testing-library/jest-dom/vitest';
  import HajeriLedger from '../HajeriLedger';
  import type { LabourData, LedgerCell } from '../../labour.types';
  import { EMPTY_LABOUR_DATA } from '../../labourMock';

  afterEach(() => cleanup());

  const cell = (partial: Partial<LedgerCell>): LedgerCell => ({
      day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...partial,
  });

  /** A week exercising all five stated realities + the उक्ते marker. */
  const FIXTURE: LabourData = {
      ...EMPTY_LABOUR_DATA,
      ledger: {
          weekLabel: '३१ ऑग – ६ सप्टें',
          days: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'],
          crewRows: [],
          rows: [
              {
                  personId: 'w1', fieldOperatorId: 'op-1', name: 'गणेश', initial: 'ग', tone: 'em',
                  cells: [
                      cell({ day: 'full' }),
                      cell({ day: 'half' }),
                      cell({ day: 'absent' }),
                      null, // कुणी माहिती नाही — blank, never '–'
                      cell({ day: 'full', night: 'worked' }), // split cell
                      cell({ day: 'full', extraHours: 2 }),   // +2 जादा
                      cell({ night: 'worked', hours: 3 }),    // 3त, रात्र
                  ],
              },
              {
                  personId: 'w2', fieldOperatorId: 'op-2', name: 'शंकर', initial: 'श', tone: 'or',
                  cells: [
                      cell({ day: 'full', ukte: true }), // violet dot — उक्ते engagement
                      null, null, null, null, null, null,
                  ],
              },
          ],
      },
  } as LabourData;

  describe('HajeriLedger — the clean register (D4, 2026-09-02)', () => {
      it('renders no ₹ anywhere', () => {
          const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
          expect(container.textContent).not.toContain('₹');
      });

      it('every row is name + one cell per day, nothing trailing', () => {
          const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
          const rows = container.querySelectorAll('[data-testid="ledger-row"]');
          expect(rows.length).toBe(FIXTURE.ledger.rows.length);

          rows.forEach((row) => {
              const cells = row.querySelectorAll('[data-testid="ledger-cell"]');
              expect(cells.length).toBe(FIXTURE.ledger.days.length);
              // No totals column: the strip holding the day cells is the row's
              // LAST element — nothing may render after the seventh cell.
              const last = row.lastElementChild;
              expect(last).not.toBeNull();
              expect(last!.contains(cells[cells.length - 1])).toBe(true);
          });
      });

      it('no totals row renders', () => {
          const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
          // The old grid closed with an 'एकूण' row summing every column. The
          // clean register has no bottom line of any kind; day-count reads
          // live in detail views only.
          expect(container.textContent).not.toContain('एकूण');
      });
  });
  ```

- [ ] **Step 7 — run** (from `src/clients/mobile-web`):
  ```bash
  npx vitest run src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx
  ```
  Expected before Phase 4.4: fails to typecheck (`LedgerCell` does not exist yet /
  `LedgerRow` still requires `total`) or fails on `ledger-row` — that failure is the
  acceptance bar and belongs to Phase 4. After Phase 4.4: 3 passed. Bite-proof once green:
  temporarily append `<span>₹0</span>` inside the component's row loop, re-run RED on test 1,
  revert.

- [ ] **Step 8 — commit all four:**
  ```bash
  git add src/clients/mobile-web/src/features/labour/__tests__/farmerVocabulary.scan.test.ts \
          src/tests/AgriSync.ArchitectureTests/FarmerFacingVocabularyRules.cs \
          src/tests/AgriSync.ArchitectureTests/CleanRegisterRules.cs \
          src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx
  git commit -m "test(acceptance): farmer-facing labour strings carry no permission vocabulary; the register stays clean"
  ```

---

## Phase exit

- [ ] All Phase 5 suites green:
  ```bash
  dotnet test src/tests/AgriSync.ArchitectureTests/
  cd src/clients/mobile-web && npx vitest run \
    src/features/labour/__tests__/farmerVocabulary.scan.test.ts \
    src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx
  ```
- [ ] The Task 5.2 walk table fully ticked, each row's command output captured as the
  founder-gate evidence (code-complete ≠ approved; nothing merges without his gate).
- [ ] No production file modified by this phase (`git diff --stat` shows tests + this doc only).

## Interface register (for the checker)

**PRODUCED by Phase 5:**

| Kind | Exact name |
|---|---|
| xUnit | `AgriSync.ArchitectureTests.AttendanceAttachabilityRules` — `AttendanceMark_carries_no_acknowledgement_member()`, `AttendanceMark_id_survives_Amend_and_the_row_is_never_replaced()`, `A_second_party_event_attaches_by_AttendanceMarkId_with_no_back_reference()`, `The_correction_history_stays_append_only_at_the_GRANT()` |
| xUnit | `AgriSync.ArchitectureTests.FieldOperatorSingleProducerRules` — `FieldOperator_is_constructed_in_exactly_one_production_file()` |
| xUnit | `AgriSync.ArchitectureTests.FarmerFacingVocabularyRules` — `No_farmer_facing_server_string_carries_permission_vocabulary()` |
| xUnit | `AgriSync.ArchitectureTests.CleanRegisterRules` — `The_ledger_grid_contract_carries_no_money_and_no_totals()`, `AttendanceMark_Value_is_obsolete_so_no_new_reader_can_collapse_a_week()` |
| Vitest | `src/clients/mobile-web/src/features/labour/__tests__/farmerVocabulary.scan.test.ts` — "the scan scope is non-empty", "no farmer-facing labour string contains permission vocabulary or a hardcoded English ON/OFF" |
| Vitest | `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerClean.test.tsx` — "renders no ₹ anywhere", "every row is name + one cell per day, nothing trailing", "no totals row renders" |
| Doc | the Task 5.2 walk table — the release's Founder Acceptance Gate evidence sheet |

**CONSUMED by Phase 5 (exact signatures; owning phase must produce them):**

| From | Interface |
|---|---|
| Phase 2 / 2.5 | `AttendanceMark.Create(Guid, FarmId, Guid, DateOnly, DayMark, NightMark, UserId, DateTime, decimal? hoursWorked = null, decimal? extraHours = null, LabourTimeBasis hoursBasis = LabourTimeBasis.Unspecified)` |
| Phase 2 / 2.5 | `AttendanceMark.Amend(DayMark, NightMark, decimal?, decimal?, LabourTimeBasis, UserId, DateTime) : AttendanceMarkPreviousValues` |
| Phase 2 / 2.5 | `record AttendanceMarkPreviousValues(DayMark Day, NightMark Night, decimal? HoursWorked, decimal? ExtraHours, LabourTimeBasis HoursBasis)` in `ShramSafal.Domain.Labour` |
| Phase 2 / 2.5 | `decimal? AttendanceMark.HoursWorked`, `decimal? AttendanceMark.ExtraHours` |
| Phase 2 | `[Obsolete]` on `AttendanceMark.Value` |
| Phase 2 / D5 copy | authority-surface strings replaced per D5 (ON state `कामगारांची जबाबदारी आहे`; no Latin permission words; no hardcoded ON/OFF) at `TeamMemberCard.tsx` / `IdentitySection.tsx` |
| Phase 2 / 2.4 | xUnit `LabourLedgerReadRules.Ledger_and_labour_reads_never_consult_the_write_authority_gate` (file `LabourLedgerReadRules.cs`) |
| Phase 3 / 3.1 | Vitest `src/features/labour/__tests__/labourAnchor.test.ts` + `src/features/labour/components/__tests__/LabourHub.test.tsx` (the three walk cases) |
| Phase 3 / 3.2 | Vitest `src/features/labour/__tests__/attendanceLadder.test.ts` |
| Phase 3 / 3.3 + Phase 4 / 4.3 | xUnit `ShramSafal.Domain.Tests.Labour.Handlers.RecordAttendanceMarkHandlerTests` (contradiction preservation; idempotent repeat / amend-through-entity) + `AttendanceMarkUniqueIndexRealPostgresTests` (the 23505 net) |
| Phase 3 / 3.4a+b | Vitest `src/core/navigation/__tests__/labourResultOwnership.test.tsx` (nothing saves on landing) |
| Phase 3 / 3.4b | Vitest `src/features/labour/components/__tests__/AttendanceResult.test.tsx` |
| Phase 3 / 3.5 | xUnit `ShramSafal.Sync.IntegrationTests.Labour.AttendanceMarkSyncRealPostgresTests` (P10 reconstructability) · Vitest `src/features/labour/__tests__/attendanceP10.test.ts` |
| Phase 4 / 4.0+4.1 | Vitest `src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx` (always-available tile, clean grid) · xUnit `BuildHajeriLedgerTests` (rewritten, marks-sourced) |
| Phase 4 / 4.1+4.4 | client types `LedgerCell { day; night: 'worked'|'notworked'|null; hours; extraHours; ukte; work }`, `LedgerRow` (with `fieldOperatorId`) without `total`, ledger `{ weekLabel; days; rows; crewRows }` without `weekTotal`/`dailyTotals` (in `labour.types.ts`); DTOs `LabourLedgerDto`/`LabourLedgerRowDto` without `Total`/`WeekTotal`/`DailyTotals`; DOM `data-testid="ledger-row"` + `data-testid="ledger-cell"` on the rebuilt `HajeriLedger` |
| Phase 4 / 4.5 | Vitest `src/features/labour/components/__tests__/HajeriCellDetail.test.tsx` (dimensional week read) |
