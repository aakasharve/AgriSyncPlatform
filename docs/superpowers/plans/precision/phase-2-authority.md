# Phase 2 — Authority (implementation precision)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans, task-by-task. Steps are binary `- [ ]` checkboxes.
> TDD is mandatory: the failing-test step runs BEFORE the implementation step, with the
> exact command and the expected failure named.

**Authorities, in force, latest wins:**
1. `docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md` (D5 governs this phase)
2. `docs/superpowers/plans/2026-09-01-labour-v2-r1-human-execution-layer.md` (Global Constraints + Tasks 2.1–2.5)
3. `docs/superpowers/plans/2026-09-01-labour-v2-r1-PHASE0-FINDINGS.md` (UNKNOWN 5, UNKNOWN 6, UNKNOWN 2; conflicts C1, C2)
4. `docs/superpowers/plans/2026-09-01-labour-v2-r1-REVISION-1.md` (the fence: settled #3, #4 are FOUNDER DECISIONS — this phase implements them, never re-opens them)

**Every `file:line` below was re-verified in the working tree on 2026-09-02, branch
`feat/labour-v2-r1` @ `2cdaf2e7`.** Verified fresh for this document:
`git log origin/main -- "*AddAttendanceMarks*"` returns **empty** — neither attendance
migration has ever shipped, so `20260831180408_AddAttendanceMarks` and
`20260831185516_AddAttendanceMarkCorrections` may be EDITED in place (Task 2.5).

**FOUNDER RULING carried into this phase (master review, D5):** the model is ONE switch
plus an expiry; **existing Mukadams start OFF — there is NO backfill; the one-token delete
IS the migration behaviour** (explicit step + test in Task 2.1). History survives expiry:
"प्रकाशने काल केलेली नोंद प्रकाशच केली म्हणून कायम दिसेल." **No farmer-facing permission
vocabulary, ever** — not permission, grant, role, claim, policy, access.

**Execution order:** 2.5 → 2.1 → 2.2 → 2.3 → 2.4.
2.5 goes first because `AttendanceMark.Amend` has **zero production callers** today (only
`AttendanceMarkTests.cs:121,141`) — the domain shape must move while the blast radius is
two test lines, and the hours columns must exist before ANY Phase 3 wire contract is
authored (Phase 0 sequencing condition). 2.2 needs 2.1 (the projection edit collides).
2.3 needs 2.2 (chips need the expiry field on the wire). 2.4 is independent but pins the
separation Phase 2's own edits could most plausibly break, so it closes the phase.

---

## Change Surface

- **DB:** YES — (a) three columns added by EDITING the unshipped
  `20260831180408_AddAttendanceMarks` CreateTable (`hours_worked numeric(4,1) NULL`,
  `extra_hours numeric(4,1) NULL`, `hours_basis integer NOT NULL DEFAULT 0`);
  (b) `original_value`/`new_value` become NULLABLE in the unshipped `20260831185516`;
  (c) ONE new migration `AddLabourGrantExpiry` — a bare nullable `AddColumn` on the
  SHIPPED `ssf.farm_memberships` (precedent `20260813081843:94-112`). No new GRANT
  anywhere (all ssf grants are table-level and cover later-added columns), no RLS change
  (policies name tables, not columns), no new index, **no backfill — founder ruling**.
- **Backend:** YES — one token deleted in `LabourManagementPermission.IsCarriedByRole`;
  dead `ResolveAsync`/`LabourManagementDecision` deleted; projection un-lied; clock/expiry
  threaded through `LabourManagementGate` (every call site enumerated in Task 2.2);
  `AttendanceMark`/`AttendanceMarkCorrection` domain surface widened for hours.
- **Frontend:** YES — `MukadamDefault` leaves the union; the switch becomes the
  जबाबदारी द्या presentation with duration chips on the existing `TeamMemberCard`
  surface inside `IdentitySection`; client PUT carries `labourGrantExpiresAtUtc`.
- **Cross-cutting:** YES — one architecture test (ledger reads never consult the
  write-authority gate); `ErasureWorker` disposition comments updated by hand (nothing
  enforces them — `ErasureManifestCoverageTests.cs:85-87` scans table names only).

**Founder Acceptance Gate:** this phase merges nothing to `main` and deploys nothing.
Work lands as commits on `feat/labour-v2-r1`; the founder's gate happens at the R1
review (his instruction: "fold these into the plan, then start building" — building on
the branch is authorised, merging is not).

---

## Interfaces this phase PRODUCES (other phases build against these — exact)

```csharp
// Domain — the rule (Task 2.1)
static bool LabourManagementPermission.IsCarriedByRole(AppRole role)   // owner-tier ONLY after 2.1
static bool LabourManagementPermission.IsAllowed(AppRole? role, bool hasExplicitGrant)   // unchanged
static bool LabourManagementPermission.IsRedundantGrantTarget(AppRole role)              // unchanged body

// Application — THE gate every Phase 3/4/5 write asks (Task 2.2 signature)
static Task<bool> LabourManagementGate.IsAllowedAsync(
    IShramSafalRepository repository, Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
static Task<bool> LabourManagementGate.HasExplicitGrantAsync(
    IShramSafalRepository repository, Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
// LabourManagementGate.ResolveAsync and LabourManagementDecision are DELETED (zero callers).

// Port (Task 2.2)
Task<bool> IShramSafalRepository.GetLabourManagementGrantAsync(
    Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)  // default body: false

// Domain — membership (Task 2.2)
DateTime? FarmMembership.LabourGrantExpiresAtUtc { get; }
bool FarmMembership.HasEffectiveLabourGrant(DateTime nowUtc)
bool FarmMembership.SetLabourRecordManagement(bool allowed, DateTime? expiresAtUtc, DateTime utcNow)

// Wire (Task 2.2)
record LabourPermissionDto(Guid UserId, string Role, string Status, bool CanManageLabourRecords,
    bool HasExplicitGrant, string Source, bool IsGrantEditable, DateTime? LabourGrantExpiresAtUtc)
record SetLabourPermissionCommand(FarmId FarmId, UserId TargetUserId, bool CanManageLabourRecords,
    UserId CallerUserId, string ClientAppVersion, string AuditDeviceId, string AuditIpHash,
    DateTime? LabourGrantExpiresAtUtc)
record SetLabourPermissionRequest(bool CanManageLabourRecords, DateTime? LabourGrantExpiresAtUtc = null)
static LabourPermissionDto LabourPermissionProjection.From(FarmMembership membership, DateTime nowUtc)

// Domain — the mark (Task 2.5). Phase 3's RecordAttendanceMark and Phase 4's ledger read build on THESE.
static AttendanceMark AttendanceMark.Create(
    Guid id, FarmId farmId, Guid fieldOperatorId, DateOnly workDate,
    DayMark day, NightMark night, UserId recordedByUserId, DateTime recordedAtUtc,
    decimal? hoursWorked = null, decimal? extraHours = null,
    LabourTimeBasis hoursBasis = LabourTimeBasis.Unspecified)
decimal? AttendanceMark.HoursWorked { get; }
decimal? AttendanceMark.ExtraHours { get; }
LabourTimeBasis AttendanceMark.HoursBasis { get; }
AttendanceMarkPreviousValues AttendanceMark.Amend(
    DayMark day, NightMark night, decimal? hoursWorked, decimal? extraHours,
    LabourTimeBasis hoursBasis, UserId amendedByUserId, DateTime amendedAtUtc)
sealed record AttendanceMarkPreviousValues(
    DayMark Day, NightMark Night, decimal? HoursWorked, decimal? ExtraHours, LabourTimeBasis HoursBasis)

// Domain — the correction (Task 2.5)
const string AttendanceMarkCorrection.HoursWorkedField = "hours_worked"
const string AttendanceMarkCorrection.ExtraHoursField  = "extra_hours"
static string AttendanceMarkCorrection.FormatHours(decimal hours, LabourTimeBasis basis) // "3.5|Explicit"
static AttendanceMarkCorrection AttendanceMarkCorrection.Create(
    Guid id, Guid attendanceMarkId, FarmId farmId, string changedField,
    string? originalValue, string? newValue, UserId correctedByUserId, DateTime correctedAtUtc)

// DB columns other phases read (Task 2.5, edited-in-place unshipped migrations)
ssf.attendance_marks.hours_worked  numeric(4,1) NULL
ssf.attendance_marks.extra_hours   numeric(4,1) NULL
ssf.attendance_marks.hours_basis   integer NOT NULL DEFAULT 0   -- LabourTimeBasis
ssf.attendance_mark_corrections.original_value / new_value  -> varchar(32) NULL
ssf.farm_memberships.labour_grant_expires_at_utc  timestamptz NULL   -- Task 2.2, NEW migration

// Frontend (Tasks 2.2/2.3)
setLabourPermission(farmId: string, targetUserId: string, canManageLabourRecords: boolean,
    labourGrantExpiresAtUtc?: string | null): Promise<LabourPermission>
LabourPermission.labourGrantExpiresAtUtc: string | null
type LabourPermissionSource = 'OwnerTier' | 'ExplicitGrant' | 'NotGranted'   // MukadamDefault DELETED
useLabourPermissions(...).setPermission(targetUserId: string, canManageLabourRecords: boolean,
    labourGrantExpiresAtUtc?: string | null): Promise<void>
// features/profile/components/responsibilityDuration.ts
type ResponsibilityDurationChip = 'today' | 'twoDays' | 'threeDays' | 'date' | 'permanent'
const DURATION_CHIPS: ReadonlyArray<{ chip: ResponsibilityDurationChip; label: string }>
function expiryUtcForChip(chip, now: Date, pickedIsoDate?: string): string | null
function responsibilityEndLine(expiresAtUtc: string | null): string
// features/labour/marathiDate.ts
const MARATHI_MONTHS_FULL: string[]
```

## Interfaces this phase CONSUMES

```csharp
enum LabourTimeBasis { Unspecified = 0, Assumed = 1, Explicit = 2 }   // ShramSafal.Domain/Farms/LabourTime.cs:18-23, reused NOT extended
interface IClock { DateTime UtcNow { get; } }                          // AgriSync.BuildingBlocks/Abstractions/IClock.cs
AttendanceMark / AttendanceMarkCorrection                              // built 2026-08-31, unshipped
DailyLog / VerificationStateMachine / VerifyLogAuthorizer              // untouched — FSM edges are NOT edited here
```
Phase 3 consumes `LabourManagementGate.IsAllowedAsync(repository, farmId, userId, nowUtc, ct)`
verbatim in `RecordAttendanceMarkHandler`. Phase 4's `BuildHajeriLedger` rework consumes
`HoursWorked`/`ExtraHours`/`HoursBasis` and may NOT consume `AttendanceMark.Value`
(Global Constraints; conflict C12). Phase 1's approved surface `07-allow-labour-management.html`
plus the D5 harvested copy are the ONLY farmer-facing strings Task 2.3 may render.

---
---

# Task 2.5 — Hours provenance in the creating migration (FIRST)

**Why first:** `AttendanceMark` has zero production consumers beyond plumbing and
`Amend()` has no production caller at all (verified: only `AttendanceMarkTests.cs:121`
and `:141`). Do the domain shape now, while the cost is two test lines. The columns must
exist before any wire contract freezes a three-of-five shape (Phase 0 sequencing
condition; conflict C2).

**One deliberate supersession, stated:** Phase 0's UNKNOWN 2 recommended bare `numeric`
and NO basis column. The plan's Task 2.5 — written AFTER the founder's 2026-09-02 master
review ("hours provenance column ships now… recorded time and stated time stay
distinguishable") — specifies `numeric(4,1)` plus `hours_basis` reusing
`LabourTimeBasis`. Later founder direction wins. Phase 0's supporting analysis
(nullability = "nobody said"; edit-in-place; per-field correction nullability; the
`ErasureWorker` comment duty; no GRANT/RLS/index work) all still binds.

**Basis rule on THIS table:** the mark's recorder is *"Who made this ruling. Never the
app."* (`AttendanceMark.cs:83`), so the only storable basis with hours present is
`Explicit`. `Assumed` exists so the SERVER can invent a duration
(`LabourTime.ServerDefaultHours`/`ServerAssumed()`, `LabourTime.cs:33,67`) — refused
here; a device-recorded work session (Phase 7 timer) attaches to the ENGAGEMENT, never
to attendance (master review, Timer section). `Unspecified` pairs exactly with "no hours
stated". The column carries the full enum so Phase 7 never needs a schema change.

## Files

| Action | Path | Anchor (verified) |
|---|---|---|
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs` | ctor :46-65, props :79-81, `Create` :95-125, guard :112-121, `Amend` :132-149, `Value` :151-158 (UNTOUCHED) |
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMarkCorrection.cs` | consts :46-49, ctor :53-71, props :78-88, `Create` :95-144, two-field `if` :116-121, blank check :123-130 |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AttendanceMarkConfiguration.cs` | after `Night` block :36-38 |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AttendanceMarkCorrectionConfiguration.cs` | `.IsRequired()` at :33-41 |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/20260831180408_AddAttendanceMarks.cs` | CreateTable columns :19-27 (RLS :51-75 and GRANTs :82-94 stay byte-identical) |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/20260831185516_AddAttendanceMarkCorrections.cs` | columns :23-24 (RLS :47-54, append-only GRANT :65-77 stay byte-identical) |
| Modify | both `.Designer.cs` files + `ShramSafalDbContextModelSnapshot.cs` | AttendanceMark block :3353-3400; Correction block :3402+ |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Privacy/ErasureWorker.cs` | marks disposition ~:197-207 ("two enums"), corrections disposition ~:224-227 ("the enum NAMES") |
| Modify | `src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkTests.cs` | Amend call sites :121, :141 + new facts |
| Modify | `src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkCorrectionTests.cs` | new facts; :77-81 message survives |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourCapabilityGrantRealPostgresTests.cs` | one additive schema fact (harness already applies the migration chain to a scratch DB) |

## Interfaces

- **Produces:** `AttendanceMark.Create(...)` widened trailing-optional (repo idiom
  `LabourAssignment.cs:142-144`), `HoursWorked`/`ExtraHours`/`HoursBasis`,
  `Amend(day, night, hoursWorked, extraHours, hoursBasis, amendedByUserId, amendedAtUtc)`
  → `AttendanceMarkPreviousValues`; `AttendanceMarkCorrection.HoursWorkedField`/
  `ExtraHoursField`/`FormatHours`; the three DB columns; nullable correction values.
- **Consumes:** `LabourTimeBasis` (existing, `ShramSafal.Domain.Farms`), the two
  unshipped migrations, `LabourCorrection`'s `CorrectableFields` idiom
  (`LabourCorrection.cs:78-85, :166-172`) and its composite value idiom
  (`FieldDurationHours`: *"Values carry their basis: `"8|Assumed"`"*, :66-67).

## Steps

- [ ] **2.5.0 — verify the edit-in-place licence yourself.** Run
  `git log origin/main -- "*AddAttendanceMarks*"` and
  `git log origin/main -- "*AddAttendanceMarkCorrections*"`. Both MUST be empty. If either
  is not, STOP — the migration shipped and this whole task becomes a new migration
  instead. (Also note: any LOCAL dev database that already applied `20260831180408` must
  be dropped and re-migrated after this task — the integration suites are immune, they
  build fresh scratch DBs via `IntegrationMigrationChain`.)

- [ ] **2.5.1 — write the failing domain tests.** In
  `src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkTests.cs`, add
  `using ShramSafal.Domain.Farms;` and append inside the class:

```csharp
    // ── The five day-realities: hours land on the mark (final direction §1) ──

    /// <summary>
    /// Task 2.5 acceptance, verbatim from the plan: "गणेश रात्री 3 तास होता"
    /// persists Night=Worked AND Hours=3 with basis=Explicit — and NOTHING
    /// converts hours into day fractions.
    /// </summary>
    [Fact]
    public void StatedNightHoursPersistBesideTheNightMarkAndConvertToNothing()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Worked,
            Actor, At, hoursWorked: 3m, hoursBasis: LabourTimeBasis.Explicit);

        Assert.Equal(NightMark.Worked, mark.Night);
        Assert.Equal(3m, mark.HoursWorked);
        Assert.Equal(LabourTimeBasis.Explicit, mark.HoursBasis);

        var without = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Worked, Actor, At);
        Assert.Equal(without.Value, mark.Value); // hours never fold into day-worth (C12 stays pinned)
    }

    /// <summary>The widened emptiness guard: hours alone are now a statement.</summary>
    [Fact]
    public void AnHoursOnlyRulingIsAMarkNowNotARefusal()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Unmarked,
            Actor, At, hoursWorked: 4m, hoursBasis: LabourTimeBasis.Explicit);
        Assert.Equal(4m, mark.HoursWorked);
    }

    /// <summary>"+2 जादा" is a distinct fact beside Full — never an invented 1.25 days.</summary>
    [Fact]
    public void ExtraHoursRideBesideAFullDayNeverInsideIt()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, extraHours: 2m, hoursBasis: LabourTimeBasis.Explicit);
        Assert.Equal(DayMark.Full, mark.Day);
        Assert.Equal(2m, mark.ExtraHours);
        Assert.Equal(1m, mark.Value);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NonPositiveHoursAreRefused(int hours)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: hours, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>
    /// The recorder is "never the app" (AttendanceMark.cs). Hours on a mark are
    /// somebody's WORDS: basis must be Explicit — Assumed is the server inventing
    /// a duration, which belongs to the engagement, never here.
    /// </summary>
    [Theory]
    [InlineData(LabourTimeBasis.Unspecified)]
    [InlineData(LabourTimeBasis.Assumed)]
    public void HoursWithoutExplicitProvenanceAreRefused(LabourTimeBasis basis)
    {
        Assert.Throws<ArgumentException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3m, hoursBasis: basis));
    }

    [Fact]
    public void ABasisWithNoHoursIsRefused()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>numeric(4,1) would silently round a second decimal; stored must equal stated (P4).</summary>
    [Fact]
    public void ASecondDecimalPlaceIsRefusedSoStoredEqualsStated()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3.25m, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>
    /// The guard nuance Phase 0 demanded be decided in the domain shape:
    /// Amend may RESTATE stated hours, never silently blank them — "nobody said"
    /// has no value name a correction row could record, so a quiet null here
    /// would be an unrecorded deletion.
    /// </summary>
    [Fact]
    public void AmendMayRestateHoursButNeverSilentlyDropThem()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3m, hoursBasis: LabourTimeBasis.Explicit);

        Assert.Throws<ArgumentException>(() => mark.Amend(
            DayMark.Full, NightMark.Unmarked, null, null, LabourTimeBasis.Unspecified,
            Actor, At.AddHours(1)));

        var previous = mark.Amend(
            DayMark.Full, NightMark.Unmarked, 3.5m, null, LabourTimeBasis.Explicit,
            Actor, At.AddHours(2));
        Assert.Equal(3m, previous.HoursWorked);
        Assert.Equal(LabourTimeBasis.Explicit, previous.HoursBasis);
        Assert.Equal(3.5m, mark.HoursWorked);
    }
```

  In the SAME file, update the two existing `Amend` call sites to the new signature
  (their intent is untouched):
  - `:121` becomes:
```csharp
        var previous = mark.Amend(
            DayMark.Full, NightMark.Worked, null, null, LabourTimeBasis.Unspecified, otherActor, later);

        Assert.Equal(DayMark.Half, previous.Day);
        Assert.Equal(NightMark.Unmarked, previous.Night);
```
  (and the two subsequent asserts keep using `mark.Day` / `mark.Value` unchanged).
  - `:141` becomes:
```csharp
            () => mark.Amend(DayMark.Unmarked, NightMark.Unmarked, null, null,
                LabourTimeBasis.Unspecified, Actor, At.AddHours(1)));
```

- [ ] **2.5.2 — run and see them fail.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~AttendanceMarkTests"`
  Expected: **compile errors** (`AttendanceMark.Create` has no `hoursWorked` parameter;
  `Amend` takes 4 arguments, not 7; `AttendanceMarkPreviousValues` does not exist). A
  compile failure IS the red step for a signature change.

- [ ] **2.5.3 — implement the domain shape.** In `AttendanceMark.cs`:
  add `using ShramSafal.Domain.Farms;` at the top; widen the private ctor (:46-65) with
  three parameters after `night` (`decimal? hoursWorked, decimal? extraHours,
  LabourTimeBasis hoursBasis`) assigning the three new auto-properties; add after
  `Night` (:81):

```csharp
    /// <summary>
    /// Stated hours — "गणेश 4 तास होता". Stored AS STATED and never converted
    /// into a day fraction (final direction §1): 4 hours is 4 hours, not 0.5 of
    /// anything. Null = nobody said — the same silence the enums spell Unmarked.
    /// </summary>
    public decimal? HoursWorked { get; private set; }

    /// <summary>
    /// Stated EXTRA hours beyond the marked day — "+2 जादा". Independent of
    /// <see cref="HoursWorked"/>: Full plus two extra is (Full, +2), never an
    /// invented 1.25 days.
    /// </summary>
    public decimal? ExtraHours { get; private set; }

    /// <summary>
    /// Provenance of the hours (founder master review 2026-09-02: recorded time
    /// and stated time stay distinguishable, and the column ships NOW — added
    /// after hours start being recorded it is unrecoverable for every earlier
    /// row). Reuses <see cref="LabourTimeBasis"/>. On THIS table the only
    /// storable basis beside hours is <see cref="LabourTimeBasis.Explicit"/> —
    /// the recorder is "never the app", so Assumed (the server inventing a
    /// duration, <c>LabourTime.ServerAssumed</c>) is refused; a device-recorded
    /// work session (Phase 7 timer) attaches to the ENGAGEMENT, never to
    /// attendance. Unspecified pairs exactly with both hours being null.
    /// </summary>
    public LabourTimeBasis HoursBasis { get; private set; }
```

  Replace `Create` (:95-125) with:

```csharp
    public static AttendanceMark Create(
        Guid id,
        FarmId farmId,
        Guid fieldOperatorId,
        DateOnly workDate,
        DayMark day,
        NightMark night,
        UserId recordedByUserId,
        DateTime recordedAtUtc,
        decimal? hoursWorked = null,
        decimal? extraHours = null,
        LabourTimeBasis hoursBasis = LabourTimeBasis.Unspecified)
    {
        if (fieldOperatorId == Guid.Empty)
        {
            throw new ArgumentException(
                "A mark must be about somebody — an empty operator id would be a ruling with no subject.",
                nameof(fieldOperatorId));
        }

        if (day == DayMark.Unmarked && night == NightMark.Unmarked
            && hoursWorked is null && extraHours is null)
        {
            // Nothing was said. A row asserting nothing is worse than no row:
            // it occupies the slot that "nobody has ruled yet" is expressed by,
            // and every reader would have to re-derive the distinction.
            throw new ArgumentException(
                "A mark must state something. All four facts absent is the absence of a mark, "
                + "which is represented by having no row at all.",
                nameof(day));
        }

        ValidateHours(hoursWorked, extraHours, hoursBasis);

        return new AttendanceMark(
            id, farmId, fieldOperatorId, workDate, day, night,
            hoursWorked, extraHours, hoursBasis, recordedByUserId, recordedAtUtc);
    }

    private static void ValidateHours(
        decimal? hoursWorked, decimal? extraHours, LabourTimeBasis hoursBasis)
    {
        var anyHours = hoursWorked is not null || extraHours is not null;

        if (!anyHours && hoursBasis != LabourTimeBasis.Unspecified)
        {
            throw new ArgumentException(
                "A basis with no hours is provenance for a statement nobody made.",
                nameof(hoursBasis));
        }

        if (anyHours && hoursBasis != LabourTimeBasis.Explicit)
        {
            // Assumed exists so the SERVER can invent a duration
            // (LabourTime.ServerAssumed). This table's recorder is "never the
            // app": hours land here only because a human said them, so their
            // basis is Explicit or they do not land at all.
            throw new ArgumentException(
                "Hours on a mark are somebody's words. Basis must be Explicit.",
                nameof(hoursBasis));
        }

        Validate(hoursWorked, nameof(hoursWorked));
        Validate(extraHours, nameof(extraHours));

        static void Validate(decimal? value, string name)
        {
            if (value is not decimal hours)
            {
                return;
            }

            if (hours <= 0)
            {
                throw new ArgumentOutOfRangeException(name, hours, "Stated hours must be positive.");
            }

            if (hours != decimal.Round(hours, 1))
            {
                // numeric(4,1) would silently round a second decimal place, and
                // stored must equal stated (P4 — what the farmer said must not
                // silently change). Refuse rather than round.
                throw new ArgumentOutOfRangeException(
                    name, hours, "Stated hours carry at most one decimal place.");
            }

            if (hours > 999.9m)
            {
                throw new ArgumentOutOfRangeException(name, hours, "Beyond numeric(4,1).");
            }
        }
    }
```

  Replace `Amend` (:132-149) with:

```csharp
    /// <summary>
    /// Re-rules this person-day. Returns the PREVIOUS values so the caller can
    /// write the append-only correction rows — this type will not let a change
    /// happen quietly, but it is not this type's job to write those rows.
    /// A NAMED record, not a tuple: four positional values of two nullable
    /// types transpose silently.
    /// </summary>
    public AttendanceMarkPreviousValues Amend(
        DayMark day,
        NightMark night,
        decimal? hoursWorked,
        decimal? extraHours,
        LabourTimeBasis hoursBasis,
        UserId amendedByUserId,
        DateTime amendedAtUtc)
    {
        if (day == DayMark.Unmarked && night == NightMark.Unmarked
            && hoursWorked is null && extraHours is null)
        {
            throw new ArgumentException(
                "An amendment must state something. To un-say a mark, delete the row and record "
                + "the deletion — silently blanking it would erase the fact that it was ever made.",
                nameof(day));
        }

        // Null-ing a PRESENT hours value would blank a stated fact with no name
        // for the blanking — "nobody said" has no value a correction row can
        // record as the new side. Deletion of a stated fact is a different act
        // from restating it, and R1 ships no un-say path. Refuse.
        if (HoursWorked is not null && hoursWorked is null)
        {
            throw new ArgumentException(
                "This mark holds stated hours. An amendment may restate them, never silently drop them.",
                nameof(hoursWorked));
        }

        if (ExtraHours is not null && extraHours is null)
        {
            throw new ArgumentException(
                "This mark holds stated extra hours. An amendment may restate them, never silently drop them.",
                nameof(extraHours));
        }

        ValidateHours(hoursWorked, extraHours, hoursBasis);

        var previous = new AttendanceMarkPreviousValues(Day, Night, HoursWorked, ExtraHours, HoursBasis);
        Day = day;
        Night = night;
        HoursWorked = hoursWorked;
        ExtraHours = extraHours;
        HoursBasis = hoursBasis;
        RecordedByUserId = amendedByUserId;
        ModifiedAtUtc = amendedAtUtc;
        return previous;
    }
```

  `Value` (:151-158) stays byte-identical — hours must never fold into it (C12). At the
  bottom of the file, before the enums, add:

```csharp
/// <summary>
/// What a mark said before <see cref="AttendanceMark.Amend"/> re-ruled it.
/// </summary>
public sealed record AttendanceMarkPreviousValues(
    DayMark Day,
    NightMark Night,
    decimal? HoursWorked,
    decimal? ExtraHours,
    LabourTimeBasis HoursBasis);
```

- [ ] **2.5.4 — run and see green.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~AttendanceMarkTests"`
  Expected: all pass, including the untouched arithmetic/fourth-state facts.

- [ ] **2.5.5 — failing correction tests.** In `AttendanceMarkCorrectionTests.cs` add
  `using ShramSafal.Domain.Farms;` and append:

```csharp
    /// <summary>
    /// Unlike day/night — where Unmarked is a real value name — "nobody said"
    /// has NO name for the hours fields. So for them a null side is legal
    /// (first-ever statement), and the both-required rule keeps holding for the
    /// two enum halves.
    /// </summary>
    [Theory]
    [InlineData(AttendanceMarkCorrection.HoursWorkedField)]
    [InlineData(AttendanceMarkCorrection.ExtraHoursField)]
    public void AFirstEverHoursStatementRecordsNullToValue(string field)
    {
        var c = AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, field,
            null, AttendanceMarkCorrection.FormatHours(3.5m, LabourTimeBasis.Explicit), Actor, At);

        Assert.Null(c.OriginalValue);
        Assert.Equal("3.5|Explicit", c.NewValue);
    }

    [Fact]
    public void DayAndNightStillRequireBothSides()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, AttendanceMarkCorrection.DayField,
            null, "Full", Actor, At));
    }

    [Fact]
    public void ANullToNullHoursCorrectionIsRefused()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, AttendanceMarkCorrection.HoursWorkedField,
            null, null, Actor, At));
    }

    [Theory]
    [InlineData(AttendanceMarkCorrection.HoursWorkedField)]
    [InlineData(AttendanceMarkCorrection.ExtraHoursField)]
    public void TheHoursFieldsAreCorrectable(string field)
    {
        var c = AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, field,
            AttendanceMarkCorrection.FormatHours(3m, LabourTimeBasis.Explicit),
            AttendanceMarkCorrection.FormatHours(4m, LabourTimeBasis.Explicit), Actor, At);
        Assert.Equal(field, c.ChangedField);
    }
```

- [ ] **2.5.6 — run and see fail.** Same filter with `AttendanceMarkCorrectionTests`:
  compile errors (`HoursWorkedField`/`FormatHours` missing; `Create` refuses `null`).

- [ ] **2.5.7 — implement the correction widening.** In `AttendanceMarkCorrection.cs`,
  add `using ShramSafal.Domain.Farms;` and, beside the two constants (:46-49):

```csharp
    /// <summary>Stated hours. Values carry their basis, mirroring
    /// <see cref="LabourCorrection.FieldDurationHours"/>: <c>"3.5|Explicit"</c>.</summary>
    public const string HoursWorkedField = "hours_worked";

    /// <summary>Stated extra hours. Values carry their basis, as above.</summary>
    public const string ExtraHoursField = "extra_hours";

    /// <summary>
    /// The CLOSED set of correctable mark facts — the same idiom as
    /// <c>LabourCorrection.CorrectableFields</c>. Widening it is a scope
    /// change, not a fix.
    /// </summary>
    private static readonly HashSet<string> CorrectableFields = new(StringComparer.Ordinal)
    {
        DayField,
        NightField,
        HoursWorkedField,
        ExtraHoursField,
    };

    /// <summary>ONE way to write an hours value into a correction row.</summary>
    public static string FormatHours(decimal hours, LabourTimeBasis basis) =>
        $"{hours.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture)}|{basis}";

    private static bool IsHoursField(string changedField) =>
        changedField is HoursWorkedField or ExtraHoursField;
```

  Make `OriginalValue`/`NewValue` nullable (drop the `= string.Empty` initialisers,
  types become `string?`; update the private ctor parameter types to `string?`; update
  the `OriginalValue` doc to add: *"Null = absent on this side of the change — legal
  ONLY for the two hours fields, where 'nobody said' has no value name."*). Replace the
  two-field `if` (:116-121) and the blank check (:123-130) in `Create` (whose
  `originalValue`/`newValue` parameters become `string?`) with:

```csharp
        if (!CorrectableFields.Contains(changedField))
        {
            throw new ArgumentException(
                $"'{changedField}' is not a correctable mark fact: "
                + $"'{DayField}', '{NightField}', '{HoursWorkedField}' or '{ExtraHoursField}'.",
                nameof(changedField));
        }

        var original = string.IsNullOrWhiteSpace(originalValue) ? null : originalValue.Trim();
        var updated = string.IsNullOrWhiteSpace(newValue) ? null : newValue.Trim();

        if (IsHoursField(changedField))
        {
            if (original is null && updated is null)
            {
                throw new ArgumentException(
                    "A correction must state at least one side of the change.", nameof(originalValue));
            }
        }
        else if (original is null || updated is null)
        {
            // A correction that cannot say what it changed FROM is not a record
            // of a change, it is the change happening quietly — the exact thing
            // this entity exists to prevent. Day and night always HAVE a name
            // (Unmarked is a real value), so both sides stay mandatory for them.
            throw new ArgumentException(
                "A correction must state both the original and the new value.", nameof(originalValue));
        }
```

  and keep the non-change refusal, now on the trimmed values:

```csharp
        if (original == updated)
        {
            throw new ArgumentException(
                "Nothing changed — a correction row must record an actual change.",
                nameof(newValue));
        }

        return new AttendanceMarkCorrection(
            id, attendanceMarkId, farmId, changedField, original, updated,
            correctedByUserId, correctedAtUtc);
```

- [ ] **2.5.8 — run and see green.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~AttendanceMark"`
  Expected: all green — including the surviving refusal fact `:77-81`
  (`headcount` is still not correctable) and `:44-52` (day corrections still require
  both sides).

- [ ] **2.5.9 — EF configs.** `AttendanceMarkConfiguration.cs`: add
  `using ShramSafal.Domain.Farms;` and, after the `Night` block (:36-38):

```csharp
        // Founder master review 2026-09-02 — hours provenance ships in the
        // CREATING migration; added after rows exist it is unrecoverable for
        // every earlier row. numeric(4,1) matches the STATED grain (one
        // decimal); the domain guard refuses finer, so stored == stated.
        builder.Property(x => x.HoursWorked)
            .HasColumnName("hours_worked")
            .HasColumnType("numeric(4,1)");

        builder.Property(x => x.ExtraHours)
            .HasColumnName("extra_hours")
            .HasColumnType("numeric(4,1)");

        builder.Property(x => x.HoursBasis)
            .HasColumnName("hours_basis")
            .HasDefaultValue(LabourTimeBasis.Unspecified)
            .IsRequired();
```

  `AttendanceMarkCorrectionConfiguration.cs`: delete `.IsRequired()` from BOTH the
  `OriginalValue` (:33-36) and `NewValue` (:38-41) blocks (keep `HasMaxLength(32)` —
  the longest composite, `"999.9|Unspecified"`, is 17 chars; the `a7784b18` width
  incident is why this is stated rather than assumed).

- [ ] **2.5.10 — edit the unshipped migrations in place.**
  `20260831180408_AddAttendanceMarks.cs`, inside the CreateTable columns (:19-27), after
  the `night_mark` line:

```csharp
                    hours_worked = table.Column<decimal>(type: "numeric(4,1)", nullable: true),
                    extra_hours = table.Column<decimal>(type: "numeric(4,1)", nullable: true),
                    hours_basis = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
```

  `20260831185516_AddAttendanceMarkCorrections.cs` (:23-24): change both `original_value`
  and `new_value` to `nullable: true`. **Touch nothing else in either file** — RLS
  (ENABLE **and** FORCE), the tenant + user-select policies, and the grants (SELECT+INSERT
  append-only on corrections) already satisfy every hard rule and must stay byte-identical.
  No GRANT for the new columns: Postgres table-level grants cover later-added columns —
  one-line comment, no causal story (Phase 0 §4).

- [ ] **2.5.11 — regenerate the snapshot honestly, then sync the Designers.**
  1. `dotnet ef migrations add TempHoursCheck --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext --configuration Release`
  2. Open the generated `*_TempHoursCheck.cs`: its `Up` must contain ONLY three
     `AddColumn` on `ssf.attendance_marks` and two `AlterColumn` on
     `ssf.attendance_mark_corrections`. Anything else = your entity/config edit drifted — STOP and fix.
  3. Delete `*_TempHoursCheck.cs` **and** `*_TempHoursCheck.Designer.cs` by hand (do NOT
     `dotnet ef migrations remove` — that would also revert the snapshot, which is now
     correct).
  4. Copy the regenerated `ShramSafalDbContextModelSnapshot.cs` blocks for
     `AttendanceMark` and `AttendanceMarkCorrection` into
     `20260831180408_AddAttendanceMarks.Designer.cs` and
     `20260831185516_AddAttendanceMarkCorrections.Designer.cs` respectively (each
     Designer mirrors the model AS OF its migration — the corrections Designer gets both
     blocks, the marks Designer only its own).
  5. Verify: `dotnet ef migrations has-pending-model-changes --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext --configuration Release`
     Expected output: `No changes have been made to the model since the last migration.`

- [ ] **2.5.12 — the schema proof on real Postgres.** Append to
  `LabourCapabilityGrantRealPostgresTests.cs` (its `InitializeAsync` already applies the
  full migration chain — including the edited files — to a fresh scratch DB):

```csharp
    /// <summary>
    /// Task 2.5 — the edited-in-place CreateTable actually lands the three
    /// hours columns with the declared types. information_schema, superuser
    /// read: a data check, not an RLS proof.
    /// </summary>
    [Fact]
    public async Task The_attendance_hours_columns_exist_with_the_declared_types()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        await using var cmd = read.CreateCommand();
        cmd.CommandText = """
            SELECT column_name, data_type,
                   COALESCE(numeric_precision::text, ''), COALESCE(numeric_scale::text, ''),
                   is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'attendance_marks'
              AND column_name IN ('hours_worked', 'extra_hours', 'hours_basis')
            ORDER BY column_name
            """;
        var rows = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(string.Join("|", Enumerable.Range(0, 5).Select(reader.GetString)));
        }

        rows.Should().Equal(
            "extra_hours|numeric|4|1|YES",
            "hours_basis|integer|32|0|NO",
            "hours_worked|numeric|4|1|YES");
    }
```

  Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~LabourCapabilityGrantRealPostgresTests.The_attendance_hours_columns"`
  (skips cleanly when no local Postgres; on the runner with :5433 it must pass).

- [ ] **2.5.13 — the privacy comments, by hand.** In `ErasureWorker.cs`:
  - marks passage (~:200): replace `farm_id, field_operator_id, work_date, two enums, a
    recorder id and two timestamps` with
    `farm_id, field_operator_id, work_date, two enums, two numeric(4,1) hour counts plus
    an integer basis (quantities, not text — no PII), a recorder id and two timestamps`.
  - corrections passage (~:225): replace `the enum NAMES either side of the change
    ("Half" -> "Full")` with `the enum NAMES or hours values either side of the change
    ("Half" -> "Full", null -> "3.5|Explicit") — still names nobody`.
  Nothing enforces this (`ErasureManifestCoverageTests.cs:85-87` captures table names via
  a `CreateTable(` regex and never sees a column) — which is exactly why it is a checked
  step and NOT a free-text "spoken hours" column (that would give the table its first PII
  column while a signed disposition swears it has none).

- [ ] **2.5.14 — full green + commit.**
  `dotnet build src/AgriSync.sln` then
  `dotnet test src/tests/ShramSafal.Domain.Tests/` and
  `dotnet test src/tests/AgriSync.ArchitectureTests/` (the erasure-coverage and anchor
  rules must stay green). Commit:
  `feat(labour): hours provenance lands in the unshipped attendance migration`

---
---

# Task 2.1 — One switch, and the owner can turn it off

**The change is one token** (Phase 0, UNKNOWN 6): delete ` or AppRole.Mukadam` from
`LabourManagementPermission.IsCarriedByRole` (`LabourManagementPermission.cs:85-86`).
Every other decision point delegates to that predicate, so the single deletion
simultaneously (a) grant-gates the four labour-EDIT actions for a Mukadam
(`LabourManagementGate.cs:74`), (b) makes the owner's PUT stop returning 409
(`IsRedundantGrantTarget` is literally `=> IsCarriedByRole(role)` at :117, consumed at
`SetLabourPermissionHandler.cs:110-113` — the refusal survives for
PrimaryOwner/SecondaryOwner only, with zero handler edits), and (c) makes the frontend
switch interactive (`LabourPermissionProjection` → `IdentitySection.tsx:492-503` →
`TeamMemberCard.tsx:149`).

**Two deliberate behaviour decisions, stated so they are decisions and not accidents:**

1. **OFF also removes Draft→Confirmed.** `VerifyLogAuthorizer` routes *every*
   `verify_log_v2` through `EnsureCanVerify` regardless of TargetStatus, and
   `ShramSafalAuthorizationEnforcer.cs:170` refuses on the gate — so an OFF Mukadam
   loses confirm as well as approve. This matches how an ungranted Worker is already
   treated (`LabourCapabilityGateTests` "bare Worker" fact) and matches D5's ONE-switch
   model: the responsibility is whole, on or off. The FSM itself is NOT edited
   (`VerificationStateMachine.cs:199-200` still opens Confirmed→Verified on the stored
   grant — unchanged, zero FSM edits).
2. **"No membership" and "member without the responsibility" both answer
   `ShramSafal.Forbidden` on the enforcer path.** On the real Postgres sync path the
   stranger is still refused EARLIER as `ShramSafal.DailyLogNotFound` (FORCE-RLS hides
   the row — `OwnerCanApproveAMukadamsLogRealPostgresTests` proof 3b, unchanged), so the
   distinction that matters for probing survives. No new error code is minted — a
   distinct "member but not responsible" code would be permission vocabulary on the wire
   for no consumer.

**FOUNDER RULING, explicit step (2.1.7): existing Mukadams start OFF — NO backfill.**
`can_manage_labour_records` is `NOT NULL DEFAULT false` (`20260813081843:96-102`) and no
Mukadam can hold `true` today (the handler refused every attempt with 409). The
one-token delete IS the entire migration behaviour: on deploy, every existing Mukadam's
untouched `false` row starts meaning OFF. No data migration file may exist in this task.

## Files

| Action | Path | Anchor (verified) |
|---|---|---|
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourManagementPermission.cs` | :85-86 token; prose :5-21, :48-83, :105-116 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/Services/LabourManagementGate.cs` | delete :129-150 (`ResolveAsync`) + :153-171 (`LabourManagementDecision`); prose :39-43, :90-102 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Memberships/SetLabourPermission/LabourPermissionProjection.cs` | :29-35 switch |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourPermissionDto.cs` | :40-47 docs |
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Farms/FarmMembership.cs` | :63-80 doc (claims "Mukadam is allowed by default") |
| Modify | `src/clients/mobile-web/src/features/profile/data/labourPermissionsClient.ts` | :57-65 union; :21-28, :88-99 comments |
| Modify | `src/tests/ShramSafal.Domain.Tests/Labour/LabourManagementPermissionTests.cs` | :24-25 array; :82-89 replaced by inverse |
| Modify | `src/tests/ShramSafal.Domain.Tests/Labour/LabourCapabilityGateTests.cs` | :60-73, :151-171, :315-332, :339-364 |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourCapabilityGrantRealPostgresTests.cs` | :368-372 flips; + no-backfill fact |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourPermissionEndpointTests.cs` | :157-183 inverted |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/OwnerCanApproveAMukadamsLogRealPostgresTests.cs` | error codes ~:358, ~:426; stale note ~:363-384 |
| Modify | `src/tests/ShramSafal.Domain.Tests/**/VerificationStateMachineTests.cs` | comment :204-207 only |
| Modify | `src/clients/mobile-web/src/features/profile/__tests__/labourPermissionsClient.test.ts` | :48-50, :81-91 |
| Modify | `src/clients/mobile-web/src/features/profile/__tests__/useLabourPermissions.test.ts` | :47-49 |

**Untouched, on purpose** (Phase 0's "unaffected" list): `IsAllowed` (:94-95),
`CanGrantOrRevoke` (:102-103), `VerificationStateMachine` code,
`SetLabourPermissionHandler` code, `RejectionPolicy.ts` (`FORBIDDEN` is already in
`PERMANENT_REJECTION_CODES`, `RejectionPolicy.ts:121` area — the frontend-sync task Phase 0
proposed is DELETED), `ExitMembershipRealPostgresTests.cs:257`,
`LabourCapabilityMigrationRealPostgresTests`, `FarmMembershipAuthorizationBaselineTests:75/109`,
`GetMeContextHandler.cs:106` (fourth copy of the rule — already false for an ungranted
Mukadam, no render path consumes it; LOGGED here, not fixed).

## Interfaces

- **Produces:** `IsCarriedByRole` = owner-tier only; the projection's honest `Source`
  (`"NotGranted"`/`"ExplicitGrant"` for a Mukadam); `LabourPermissionSource` union without
  `'MukadamDefault'`.
- **Consumes:** nothing new — this is a deletion.

## Steps

- [ ] **2.1.1 — write the failing inverse of the rule's prose test.** In
  `LabourManagementPermissionTests.cs`: change :24-25 to

```csharp
    /// <summary>The two roles that carry the capability outright — owner-tier ONLY
    /// (founder master review 2026-09-02, D5; supersedes O-4's Mukadam entry).</summary>
    private static readonly AppRole[] CarriedByRole =
        [AppRole.PrimaryOwner, AppRole.SecondaryOwner];
```

  and REPLACE (never delete) `A_Mukadam_is_allowed_with_no_grant_at_all` (:82-89) —
  the only test stating the rule in prose — with its inverse:

```csharp
    /// <summary>
    /// THE 2026-09-02 inversion, and the only test stating the rule in prose.
    /// O-4 put the Mukadam in the carried set; the founder's master review (D5)
    /// takes him out: ONE switch, owner-controlled, and existing Mukadams start
    /// OFF. "The owner may keep him as mukadam with the authority OFF" — which
    /// the shipped code made impossible — is now the rule.
    /// </summary>
    [Fact]
    public void A_Mukadam_without_a_grant_is_denied_and_only_the_owners_switch_changes_that()
    {
        LabourManagementPermission.IsAllowed(AppRole.Mukadam, hasExplicitGrant: false)
            .Should().BeFalse(
                "D5: the owner decides once whether a person may manage labour on this farm — "
                + "the Mukadam ROLE no longer smuggles that authority in");

        LabourManagementPermission.IsAllowed(AppRole.Mukadam, hasExplicitGrant: true)
            .Should().BeTrue("the same one switch that admits any other member admits him");
    }
```

- [ ] **2.1.2 — run and see fail.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourManagementPermissionTests"`
  Expected: `A_Mukadam_without_a_grant_is_denied…` fails (`Expected … to be false, but
  found True`), and the three theories driven by `CarriedByRole` fail for
  `role: Mukadam`. Everything else green.

- [ ] **2.1.3 — delete the token.** `LabourManagementPermission.cs:85-86` becomes:

```csharp
    public static bool IsCarriedByRole(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;
```

  Rewrite the prose that states the old rule as fact — it must not survive to mislead the
  next reader (Phase 0: ":5-45, :48-84, :105-116 state the old rule as fact"):
  - Header table (:9-14) becomes:

```
/// PrimaryOwner / SecondaryOwner        -> always allowed
/// any other role — Mukadam included    -> allowed ONLY if explicitly granted
/// not a member                         -> denied
```

  with one added paragraph:

```
/// <para><b>SUPERSESSION, 2026-09-02 (founder master review, D5).</b> O-4 placed
/// Mukadam in the carried set; D5 removes him: ONE owner-held switch
/// ("जबाबदारी"), optionally time-bounded, governs every non-owner — a Mukadam
/// included. Existing Mukadams start OFF; there is NO backfill — the deletion
/// of the role carry IS the migration behaviour. History made while authorised
/// is untouched: expiry and revocation deny forward, never rewrite backward.</para>
```

  - `IsCarriedByRole`'s own summary (:48-83): keep the fifteen-days correction story
    (it is true history), delete the "Mukadam is in this set BY FOUNDER DECISION" claim
    and the closing code block's `the four labour-EDIT actions -> this set applies; a
    Mukadam needs no grant` line; state instead: *"Owner-tier only. For every other role
    — Mukadam included — the stored `can_manage_labour_records` grant (plus its expiry,
    Task 2.2) is the whole answer, for all five governed actions."*
  - `IsRedundantGrantTarget` doc (:105-116): the example becomes an owner:
    *"An owner switching the responsibility OFF for a SecondaryOwner would store `false`
    and the co-owner would carry right on — a control that looks functional and does
    nothing. The handler rejects that request with a distinct error instead. A Mukadam is
    NOT a redundant target any more — his switch is real."*

- [ ] **2.1.4 — run and see green.** Same command as 2.1.2 — all
  `LabourManagementPermissionTests` pass.

- [ ] **2.1.5 — stop the projection lying + delete the third copy.**
  - `LabourPermissionProjection.cs:29-35`: remove the Mukadam arm — the switch becomes:

```csharp
        var source = membership.Role switch
        {
            AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner
                or AgriSync.SharedKernel.Contracts.Roles.AppRole.SecondaryOwner => "OwnerTier",
            _ => hasExplicitGrant ? "ExplicitGrant" : "NotGranted",
        };
```

    (`carriedByRole`, `hasExplicitGrant`, `IsGrantEditable` at :22, :27, :45 self-correct
    through the predicate — no further edit.)
  - `LabourManagementGate.cs`: delete `ResolveAsync` (:129-150) and
    `LabourManagementDecision` (:153-171) — **zero callers repo-wide** (verified by Phase
    0 and enforced by the compiler in the next build); :143 was a third read of the role
    predicate. Rewrite the "Why not ResolveAsync either" paragraph (:98-102) to:
    *"`ResolveAsync` and `LabourManagementDecision` were deleted 2026-09-02: zero
    callers, and a third copy of the rule. The read surface projects via
    `LabourPermissionProjection.From`."* Fix the ordering paragraph (:39-43): *"The role
    is read first and answers the question on its own for owner-tier"* (drop "and
    Mukadam").
  - `LabourPermissionDto.cs:40-47`: `Source` doc loses `"MukadamDefault"`;
    `IsGrantEditable` doc becomes *"`false` for owner-tier — the switch renders
    permanently on and non-interactive. `true` for every other role, a Mukadam
    included."*
  - `FarmMembership.cs:63-80`: doc paragraph *"a `AppRole.Mukadam` is allowed by
    default, so for those roles this flag is IRRELEVANT"* becomes *"owner-tier is always
    allowed, so for those two roles this flag is irrelevant and stays `false`; for every
    other role — Mukadam included (D5, 2026-09-02) — this flag IS the decision."*
  - Frontend `labourPermissionsClient.ts:57-65`:

```ts
export type LabourPermissionSource =
    /** Owner tier — carries the capability by role. Not editable. */
    | 'OwnerTier'
    /** An owner granted it explicitly. Editable. */
    | 'ExplicitGrant'
    /** No grant, and the role does not carry it. Editable. */
    | 'NotGranted';
```

    and fix the two comments claiming a Mukadam carries by role (:21-28 header point 1
    and the `hasExplicitGrant`/`isGrantEditable` docs :88-99): owner-tier only.

- [ ] **2.1.6 — rewrite the dependent tests, intent preserved.** Every rewrite below
  keeps the original protected property and says why it flipped:
  - `LabourCapabilityGateTests.cs:60-73` — split
    `Owner_and_Mukadam_are_allowed_without_the_grant_ever_being_read` into two facts:

```csharp
    [Fact]
    public async Task An_owner_is_allowed_without_the_grant_ever_being_read()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, OwnerA)).Should().BeTrue();

        repo.GrantReads.Should().Be(0,
            "the role answers on its own for owner-tier; reaching for the grant would mean a "
            + "database round trip on the dominant path, and would let a bad grant read deny an owner");
    }

    [Fact]
    public async Task An_ungranted_Mukadam_is_denied_and_the_denial_comes_from_the_grant_being_read()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, AppRole.Mukadam);

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeFalse(
            "founder master review 2026-09-02 (D5): one switch, owner-controlled — the Mukadam "
            + "role no longer carries labour authority, and existing Mukadams start OFF");
        repo.GrantReads.Should().Be(1,
            "his answer now genuinely depends on the stored grant, so it IS read — a denial "
            + "without the read would pass identically against code that ignores the switch");

        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam).SetLabourRecordManagement(true, Now);
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeTrue(
            "the same grant that admits a Worker admits him — one switch, no second permission model");
    }
```

  - `:151-171` — `A_Mukadam_can_now_approve_and_verify_the_logs_they_already_could_correct`
    inverts (its protected property — "the five actions agree" — survives; what flipped is
    which answer they agree ON):

```csharp
    /// <summary>
    /// Inverted 2026-09-02 (founder master review, D5). O-4 let the role carry
    /// the labour surface; D5 makes it the owner's switch. An UNGRANTED Mukadam
    /// is refused at the enforcer — same layer, same predicate as an ungranted
    /// Worker. DELIBERATE consequence, decided in Task 2.1: OFF also removes
    /// Draft→Confirmed, because VerifyLogAuthorizer routes every verify_log_v2
    /// through EnsureCanVerify. The five actions still agree — that is the
    /// property this fact has always pinned.
    /// </summary>
    [Fact]
    public async Task An_ungranted_Mukadam_is_refused_by_the_enforcer_and_a_granted_one_is_admitted()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, AppRole.Mukadam);
        var log = NewLog(FarmA, MukadamA);
        repo.AddLog(log);
        var enforcer = new ShramSafalAuthorizationEnforcer(repo, new TenantContext());

        (await enforcer.EnsureCanVerify(new UserId(MukadamA), log.Id)).IsSuccess.Should().BeFalse(
            "an ungranted foreman cannot sign off his own day — and the refusal now happens one "
            + "layer earlier, at the shared gate, exactly as for an ungranted Worker");

        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam).SetLabourRecordManagement(true, Now);
        (await enforcer.EnsureCanVerify(new UserId(MukadamA), log.Id)).IsSuccess.Should().BeTrue(
            "the owner's switch is the one thing that changes the answer");
    }
```

  - `:315-332` — `Toggling_the_grant_on_a_role_that_already_carries_it_is_refused_not_silently_stored`
    becomes the P5 guard on owner-tier PLUS the new Mukadam round-trip (the founder's
    sentence made executable):

```csharp
    [Fact]
    public async Task Toggling_owner_tier_is_refused_and_a_Mukadam_toggle_now_works()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, OwnerA, AppRole.PrimaryOwner);
        var coOwner = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var coOwnerMembership = repo.AddMembership(FarmA, coOwner, AppRole.SecondaryOwner);
        var mukadam = repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        // Owner-tier: the P5 refusal survives — that role genuinely carries it.
        var refused = await handler.HandleAsync(Set(FarmA, coOwner, false, OwnerA));
        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("ShramSafal.LabourManagementCarriedByRole");
        coOwnerMembership.CanManageLabourRecords.Should().BeFalse("nothing was stored");

        // Mukadam: the refusal is GONE — this is the owner's switch now (D5).
        var granted = await handler.HandleAsync(Set(FarmA, MukadamA, true, OwnerA));
        granted.IsSuccess.Should().BeTrue();
        granted.Value!.Source.Should().Be("ExplicitGrant");
        granted.Value!.IsGrantEditable.Should().BeTrue();
        mukadam.CanManageLabourRecords.Should().BeTrue();

        var revoked = await handler.HandleAsync(Set(FarmA, MukadamA, false, OwnerA));
        revoked.IsSuccess.Should().BeTrue(
            "'the owner may keep him as mukadam with the authority OFF' — the exact sentence "
            + "the shipped code made impossible");
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeFalse(
            "denied by the gate, not merely hidden in a UI");
    }
```

  - Roster fact (:339-364): the four Mukadam assertions flip to
    `Source == "NotGranted"`, `CanManageLabourRecords == false`,
    `IsGrantEditable == true` (reason string: *"the switch is real for a Mukadam now —
    the server will honour a move, so it must render interactive"*),
    `HasExplicitGrant == false`. Owner and granted-Worker rows unchanged.
  - `LabourCapabilityGrantRealPostgresTests.cs:368-372` — the redundant-toggle half
    flips:

```csharp
        // 2026-09-02 (D5): the P5 refusal now protects owner-tier ONLY. A
        // Mukadam toggle is a real decision. Re-stating OFF on an already-OFF
        // row converges idempotently and writes no history.
        var mukadamOff = await SetPermissionAsync(FarmA, OwnerA, mukadam, false);
        mukadamOff.IsSuccess.Should().BeTrue();
        (await IsAllowedAsync(FarmA, mukadam)).Should().BeFalse(
            "an ungranted Mukadam is denied — existing Mukadams start OFF, no backfill (founder ruling)");
```

    (evidence `output.WriteLine` lines updated to match).
  - `LabourPermissionEndpointTests.cs:157-183` — replace
    `Toggling_a_Mukadam_gets_409_with_a_code_the_client_can_branch_on` with:

```csharp
    /// <summary>
    /// Inverted 2026-09-02 (D5): a Mukadam's switch is real at the wire now.
    /// The P5 409 survives for owner-tier only (covered by the theory above).
    /// </summary>
    [Fact]
    public async Task Switching_a_Mukadam_lands_and_the_roster_reports_an_editable_switch()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-4", "req-perm-4", farmId, "Permission Farm 4");
        await harness.SeedFarmMembershipAsync(farmId, MukadamUserId, AppRole.Mukadam);

        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{MukadamUserId}",
            new { canManageLabourRecords = true });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.Equal("ExplicitGrant", doc.RootElement.GetProperty("source").GetString());

        var get = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour-permissions");
        using var roster = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        var mukadam = FindMember(roster.RootElement, MukadamUserId);
        Assert.True(mukadam.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.True(mukadam.GetProperty("isGrantEditable").GetBoolean());
        Assert.Equal("ExplicitGrant", mukadam.GetProperty("source").GetString());
    }
```

    If that file has an owner-tier 409 case already, keep it; if the Mukadam case was the
    ONLY 409 pin, add a sibling fact targeting a seeded `SecondaryOwner` asserting the
    409 + `ShramSafal.LabourManagementCarriedByRole` body — the P5 guard must not lose
    its wire-level pin.
  - `OwnerCanApproveAMukadamsLogRealPostgresTests` — **error code only**, proofs
    unchanged: at ~:358 (proof 2) and ~:426 (proof 3) the expectation becomes
    `"ShramSafal.Forbidden"` with this replacement comment at both sites:

```csharp
        // ── 2026-09-02: THE LAYER MOVED AGAIN. THE REFUSAL STILL DID NOT. ──────
        // D5 removed the Mukadam from the role-carried set, so an ungranted
        // Mukadam is now refused one layer EARLIER — by
        // ShramSafalAuthorizationEnforcer.EnsureCanVerify on
        // LabourManagementGate.IsAllowedAsync — before the FSM is consulted.
        // "Forbidden" here means "no labour responsibility on this farm", and it
        // is in the client's PERMANENT_REJECTION_CODES (RejectionPolicy.ts), so
        // the device parks it for user review instead of retry-looping.
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");
```

    and DELETE the stale "OPEN, AND NOT MINE TO CLOSE" block (~:363-384) — its premise
    (the device retry-looping `VerificationTransitionNotAllowedForRole`) no longer
    applies to the code now emitted, and `FORBIDDEN` is already permanent
    (`RejectionPolicy.ts`, green test) — record one line in its place: *"resolved
    2026-09-02: the emitted code is Forbidden, which RejectionPolicy already parks."*
    The surviving proofs (Draft stays Draft, ledger stays EMPTY, ring counts nothing)
    are the intent and are untouched. Proof 3b (`DailyLogNotFound` for a stranger)
    is untouched — the stranger/member distinction survives on the real path.
  - `VerificationStateMachineTests` comment :204-207 — reword to: *"Mukadam still holds
    the Draft→Confirmed edge INSIDE the FSM; since 2026-09-02 an ungranted Mukadam never
    reaches it, because the enforcer refuses on the shared gate first. The FSM is the
    second lock, not the door."* (assertions untouched).
  - Frontend fixtures: `labourPermissionsClient.test.ts:48-50` Mukadam row becomes
    `canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted',
    isGrantEditable: true`; the :81-91 assertions flip identically;
    `useLabourPermissions.test.ts:47-49` same. (The fixtures mirror the server; a
    fixture that still claims `MukadamDefault` would no longer typecheck — the union
    change makes vitest/tsc the enforcement.)

- [ ] **2.1.7 — FOUNDER RULING as an explicit step: no backfill, and the test that pins
  it.** Confirm `git status`/`git diff --name-only` for this task shows **no file under
  `Migrations/`** — the deletion is the migration behaviour. Then append to
  `LabourCapabilityGrantRealPostgresTests.cs`:

```csharp
    /// <summary>
    /// FOUNDER RULING (master review 2026-09-02, D5): existing Mukadams start
    /// OFF, NO backfill — the one-token delete IS the whole migration
    /// behaviour. Both halves pinned: the pre-existing row is untouched (read
    /// below the app), and the gate reads that untouched row as OFF.
    /// </summary>
    [Fact]
    public async Task An_existing_Mukadam_row_is_untouched_and_reads_as_OFF_no_backfill()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var mukadam = Guid.Parse("c9d66666-6666-6666-6666-666666666666");
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedMembershipAsync(seed, FarmA, mukadam, AccountA, "Mukadam");
        }

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var stored = Convert.ToBoolean(await ScalarAsync(read,
            "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", mukadam)));
        stored.Should().BeFalse(
            "no backfill exists, by founder ruling — the row keeps its NOT NULL DEFAULT false");

        (await IsAllowedAsync(FarmA, mukadam)).Should().BeFalse(
            "the untouched row now MEANS off: an existing Mukadam starts OFF on deploy day");
    }
```

- [ ] **2.1.8 — run the sweep and see green.**
  `dotnet build src/AgriSync.sln` (the `ResolveAsync` deletion must produce zero errors —
  that IS the zero-callers proof), then
  `dotnet test src/tests/ShramSafal.Domain.Tests/`,
  `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~Labour"`
  (Postgres facts run on :5433; skip cleanly elsewhere),
  `dotnet test src/tests/AgriSync.ArchitectureTests/`, and frontend:
  `cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/profile/__tests__/labourPermissionsClient.test.ts src/features/profile/__tests__/useLabourPermissions.test.ts`.

- [ ] **2.1.9 — commit.**
  `fix(labour): mukadam labour authority is the owner's switch, not the role's`

---
---

# Task 2.2 — Time-bounded authority

**One nullable column, TWO evaluation sites** (Phase 0, UNKNOWN 6 — the correction this
task exists to honour): the gate's SQL predicate (`ShramSafalRepository.cs:1673-1685`)
AND `LabourPermissionProjection` (:27, :41-42), which computes the roster answer straight
off the entity flag via `GetLabourPermissionsHandler.cs:63` and
`SetLabourPermissionHandler.cs:167` and never touches the predicate. An SQL-only expiry
makes the owner's own roster report an expired grant as live — the same "control that
lies" defect as the projection bug 2.1 fixed. Both sites therefore evaluate through ONE
domain method, `FarmMembership.HasEffectiveLabourGrant(DateTime nowUtc)`, with the SQL
predicate as its translated twin.

**Design, stated:** the gate takes `DateTime nowUtc` (sourced from each caller's
already-injected `IClock`), not an `IClock` parameter — a moment is data, a clock is a
dependency, and every call site but two already injects the clock. Expiry **denies
forward, never rewrites backward**: no audit row, correction, mark or verification event
is touched when a grant lapses; only future answers change ("प्रकाशने काल केलेली नोंद
प्रकाशच केली म्हणून कायम दिसेल").

## Every call site touched (the compiler enforces this list — a 3-arg call no longer compiles)

**Production — 10:**

| # | Site | Change |
|---|---|---|
| 1 | `AttachFieldOperatorHandler.cs:93` | `IsAllowedAsync(repository, …, clock.UtcNow, ct)` |
| 2 | `CorrectLabourHandler.cs:163` | same |
| 3 | `CreateFieldOperatorHandler.cs:41` | same |
| 4 | `RenameFieldOperatorHandler.cs:54` | same |
| 5 | `ShramSafalAuthorizationEnforcer.cs:170` | same — AND the primary ctor (:91-93) gains `IClock clock` (the only production caller lacking one; DI resolves it, `ShramSafal.Infrastructure/DependencyInjection.cs` — no registration edit needed) |
| 6 | `LogsEndpoints.cs:215` | `HasExplicitGrantAsync(repository, …, clock.UtcNow, ct)` — the minimal-API lambda gains an `IClock clock` parameter (precedent: `FinanceEndpoints.cs:237`) |
| 7 | `GetLabourDataHandler.cs:185` | `HasExplicitGrantAsync(…, clock.UtcNow, ct)` (clock already injected, :138) |
| 8 | `VerifyLogHandler.cs:98` | same (clock already injected, :44) |
| 9 | `GetLabourPermissionsHandler.cs:63` | projection gains `nowUtc`; ctor gains `IClock clock` |
| 10 | `SetLabourPermissionHandler.cs` | `SetLabourRecordManagement(allowed, command.LabourGrantExpiresAtUtc, now)`; projection call :167 gains `now`; new `catch (ArgumentException)`; audit payload gains the expiry |

**Port + implementations — 4:** `IShramSafalRepository.cs:1037` (default body keeps
returning `false`); `ShramSafalRepository.cs:1673` (predicate gains the expiry term);
overriders `StubShramSafalRepository.cs:156` and the gate tests' `FakeRepo` (~:529).

**Tests — every expression the compiler will flag:** `LabourCapabilityGateTests.cs`
:66, :67, :80, :99, :111, :120, :331 plus the facts added in 2.1; enforcer construction
sites `LabourCapabilityGateTests.cs:164, :176, :193` and
`FarmMembershipAuthorizationBaselineTests.cs:53` (each gains `new FixedClock(Now)` /
the suite's clock); `GetLabourPermissionsHandler` constructions in the gate tests
(roster facts, 3) and `LabourCapabilityGrantRealPostgresTests` helpers
(`SetPermissionAsync`, `GetPermissionsAsync`, `IsAllowedAsync` at ~:462-478);
`ExitMembershipRealPostgresTests.cs:511`; `SetLabourRecordManagement` 2-arg callers
(gate tests roster fact :345 and the 2.1-added facts). After the sweep:
`grep -rn "IsAllowedAsync(repo" src/ | grep -v nowUtc` must return nothing —
but the real check is `dotnet build src/AgriSync.sln` exiting 0.

## Files

| Action | Path | Anchor (verified) |
|---|---|---|
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Farms/FarmMembership.cs` | prop after :81; mutator :305-321 |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/FarmMembershipConfiguration.cs` | after :114 |
| Create | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/<stamp>_AddLabourGrantExpiry.cs` | generated |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/Services/LabourManagementGate.cs` | :55-80, :107-121 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs` | :1037-1038 |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs` | :1673-1685 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Memberships/SetLabourPermission/LabourPermissionProjection.cs` | whole `From` |
| Modify | `…/SetLabourPermission/SetLabourPermissionCommand.cs` + `SetLabourPermissionHandler.cs` | append param; apply/catch/audit/projection |
| Modify | `…/GetLabourPermissions/GetLabourPermissionsHandler.cs` | ctor + :60-64 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourPermissionDto.cs` | append param |
| Modify | `src/apps/ShramSafal/ShramSafal.Api/Endpoints/MembershipEndpoints.cs` | request record ~:385; PUT body ~:256-290 |
| Modify | `src/apps/ShramSafal/ShramSafal.Api/Endpoints/LogsEndpoints.cs` | :215 + lambda params |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Auth/ShramSafalAuthorizationEnforcer.cs` | ctor :91-93; :170 |
| Modify | the seven production gate callers listed above | one line each |
| Modify | `src/clients/mobile-web/src/features/profile/data/labourPermissionsClient.ts` | type + PUT body |
| Modify | `src/clients/mobile-web/src/features/profile/hooks/useLabourPermissions.ts` | `setPermission` signature |
| Create | `src/tests/ShramSafal.Domain.Tests/Labour/LabourGrantExpiryTests.cs` | new |
| Modify | the test files enumerated in the call-site table | sweep |

## Interfaces

- **Produces:** everything in the phase-level PRODUCES block tagged Task 2.2. Phase 3's
  `RecordAttendanceMarkHandler` MUST call
  `LabourManagementGate.IsAllowedAsync(repository, farmId, userId, clock.UtcNow, ct)` —
  the same predicate, no attendance-specific flag (Task 2.1's constraint).
- **Consumes:** `IClock` (existing), `FarmMembership` (2.1 state).

## Steps

- [ ] **2.2.1 — failing domain tests.** Create
  `src/tests/ShramSafal.Domain.Tests/Labour/LabourGrantExpiryTests.cs`:

```csharp
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// R1 Task 2.2 (founder master review 2026-09-02, D5) — जबाबदारी with an end
/// date. Expiry DENIES FORWARD, never rewrites backward: the stored decision
/// and everything done under it keep their history.
/// </summary>
public sealed class LabourGrantExpiryTests
{
    private static readonly DateTime Now = new(2026, 9, 2, 9, 0, 0, DateTimeKind.Utc);

    private static FarmMembership NewMembership() => FarmMembership.Create(
        Guid.NewGuid(),
        new FarmId(Guid.Parse("aa000000-0000-0000-0000-0000000000a1")),
        new UserId(Guid.Parse("33333333-3333-3333-3333-333333333333")),
        AppRole.Worker, Now);

    [Fact]
    public void A_grant_with_a_future_expiry_answers_until_the_moment_and_not_after()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now).Should().BeTrue();

        m.HasEffectiveLabourGrant(Now.AddDays(1)).Should().BeTrue("inside the window");
        m.HasEffectiveLabourGrant(Now.AddDays(2)).Should().BeFalse(
            "जबाबदारी आपोआप संपेल — the boundary instant is already outside");
        m.CanManageLabourRecords.Should().BeTrue(
            "expiry denies FORWARD only; the stored decision is not rewritten");
    }

    [Fact]
    public void A_permanent_grant_has_no_end()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, null, Now);
        m.HasEffectiveLabourGrant(Now.AddYears(10)).Should().BeTrue("कायम");
    }

    [Fact]
    public void A_past_expiry_is_refused_not_stored()
    {
        var m = NewMembership();
        var act = () => m.SetLabourRecordManagement(true, Now.AddMinutes(-1), Now);
        act.Should().Throw<ArgumentException>(
            "an already-expired grant is a switch that looks ON and answers OFF — P5");
        m.CanManageLabourRecords.Should().BeFalse();
    }

    [Fact]
    public void Revoking_clears_the_expiry_so_it_cannot_outlive_the_grant()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(false, Now.AddDays(9), Now).Should().BeTrue();
        m.LabourGrantExpiresAtUtc.Should().BeNull("a revoke has no end date");
    }

    [Fact]
    public void Restating_the_same_grant_and_expiry_is_not_a_change()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now.AddMinutes(5)).Should().BeFalse(
            "a re-sent toggle is not a decision (P3) and must not appear in history as one");
    }

    [Fact]
    public void Moving_only_the_expiry_is_a_real_change()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(true, Now.AddDays(5), Now.AddMinutes(5)).Should().BeTrue(
            "3 दिवस instead of आज is a different decision and audits as one");
    }
}
```

- [ ] **2.2.2 — run and see fail.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourGrantExpiryTests"`
  Expected: compile errors — `SetLabourRecordManagement` takes 2 arguments,
  `HasEffectiveLabourGrant`/`LabourGrantExpiresAtUtc` do not exist.

- [ ] **2.2.3 — domain.** In `FarmMembership.cs`, after `CanManageLabourRecords` (:81):

```csharp
    /// <summary>
    /// R1 Task 2.2 (founder master review 2026-09-02, D5) — when the explicit
    /// labour grant STOPS answering. <c>null</c> = कायम, no end date.
    ///
    /// <para><b>Expiry denies forward, never rewrites backward.</b> What the
    /// person did while responsible keeps its history — "प्रकाशने काल केलेली
    /// नोंद प्रकाशच केली म्हणून कायम दिसेल." Nothing here touches audit rows,
    /// corrections or marks; only future answers change.</para>
    ///
    /// <para>Meaningless without the grant: <see cref="SetLabourRecordManagement"/>
    /// clears it on revoke, so an expiry can never outlive the decision it
    /// bounds.</para>
    /// </summary>
    public DateTime? LabourGrantExpiresAtUtc { get; private set; }

    /// <summary>
    /// The stored decision evaluated at a moment: granted AND not yet expired.
    /// BOTH readers of the grant answer through this rule — the SQL twin in
    /// <c>GetLabourManagementGrantAsync</c> for the gate, this method for the
    /// projection. A roster reading the bare flag while the gate reads
    /// flag+expiry is a control that lies.
    /// </summary>
    public bool HasEffectiveLabourGrant(DateTime nowUtc) =>
        CanManageLabourRecords
        && (LabourGrantExpiresAtUtc is null || nowUtc < LabourGrantExpiresAtUtc);
```

  Replace the body of `SetLabourRecordManagement` (:305-321) with the three-parameter
  version (keep and extend its doc comment — add: *"The expiry travels WITH the grant:
  cleared on revoke, refused when already past."*):

```csharp
    public bool SetLabourRecordManagement(bool allowed, DateTime? expiresAtUtc, DateTime utcNow)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException(
                $"Cannot change labour-record management on a {Status} membership.");
        }

        var effectiveExpiry = allowed ? expiresAtUtc : null;

        if (allowed && effectiveExpiry is not null && effectiveExpiry <= utcNow)
        {
            throw new ArgumentException(
                "An expiry in the past grants nothing — refusing rather than storing a switch "
                + "that looks ON and answers OFF.", nameof(expiresAtUtc));
        }

        if (CanManageLabourRecords == allowed && LabourGrantExpiresAtUtc == effectiveExpiry)
        {
            return false;
        }

        CanManageLabourRecords = allowed;
        LabourGrantExpiresAtUtc = effectiveExpiry;
        ModifiedAtUtc = utcNow;
        return true;
    }
```

- [ ] **2.2.4 — run 2.2.1's tests green** (same filter; the rest of the solution does
  not compile yet — that is expected and is the sweep's to-do list).

- [ ] **2.2.5 — EF + migration.** `FarmMembershipConfiguration.cs`, after the
  `CanManageLabourRecords` block (:110-114):

```csharp
        // R1 Task 2.2 (founder master review 2026-09-02, D5) — when the grant
        // stops answering. Nullable, no default, NO BACKFILL: every pre-existing
        // grant means "no end date", which is exactly what was decided when it
        // was given. Same no-index / no-RLS reasoning as the grant column above:
        // read only beside (farm_id, user_id), covered by
        // ix_farm_memberships_farm_user_nonterminal; policies name tables and
        // rows, not columns. No GRANT needed — privileges are per-table.
        builder.Property(x => x.LabourGrantExpiresAtUtc)
            .HasColumnName("labour_grant_expires_at_utc");
```

  Generate:
  `dotnet ef migrations add AddLabourGrantExpiry --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext --configuration Release`
  Verify the generated `Up` is EXACTLY one `AddColumn<DateTime>` (`nullable: true`,
  `type: "timestamp with time zone"`, schema `ssf`, table `farm_memberships`) and `Down`
  one `DropColumn` — the `20260813081843` precedent shape. Anything else = STOP.
  (This table SHIPPED — a new migration is correct here; only the two attendance
  migrations may be edited in place.)

- [ ] **2.2.6 — the gate, the port, the predicate.** `LabourManagementGate.cs`:

```csharp
    public static async Task<bool> IsAllowedAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        DateTime nowUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        var role = await repository.GetUserRoleForFarmAsync(farmId, userId, ct);
        if (role is null)
        {
            return false;
        }

        if (LabourManagementPermission.IsCarriedByRole(role.Value))
        {
            return true;
        }

        return await repository.GetLabourManagementGrantAsync(farmId, userId, nowUtc, ct);
    }
```

  `HasExplicitGrantAsync` identically gains `DateTime nowUtc` before `ct` and forwards
  it. Doc addition on both: *"`nowUtc` comes from the caller's `IClock` — expiry is
  evaluated HERE and in the projection, never on `IsCarriedByRole` (a role is not a
  grant and has no end date)."*

  `IShramSafalRepository.cs:1037`:

```csharp
    Task<bool> GetLabourManagementGrantAsync(
        Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
        => Task.FromResult(false);
```

  (doc gains: *"`nowUtc` bounds the grant: a row whose
  `labour_grant_expires_at_utc` is at or before it does not count."*)

  `ShramSafalRepository.cs:1673-1685` — the predicate gains one term (a PARAMETER, so
  EF translates it as a parameterised comparison — the real-Postgres fact in 2.2.10 is
  the translation proof Phase 0 demanded):

```csharp
        return await db.FarmMemberships
            .AsNoTracking()
            .AnyAsync(m => m.FarmId == typedFarmId
                && m.UserId == typedUserId
                && m.Status != MembershipStatus.Revoked
                && m.Status != MembershipStatus.Exited
                && m.CanManageLabourRecords
                && (m.LabourGrantExpiresAtUtc == null || m.LabourGrantExpiresAtUtc > nowUtc), ct);
```

- [ ] **2.2.7 — the second evaluation site.** `LabourPermissionProjection.cs` — the whole
  `From` becomes (this is the site Phase 0 caught reading the bare flag):

```csharp
    public static LabourPermissionDto From(FarmMembership membership, DateTime nowUtc)
    {
        var carriedByRole = LabourManagementPermission.IsCarriedByRole(membership.Role);

        // For a role-carried capability the stored flag is not consulted at all;
        // for everyone else the flag counts ONLY while unexpired — the SAME rule
        // the gate's SQL predicate applies, via the same domain method.
        var hasEffectiveGrant = !carriedByRole && membership.HasEffectiveLabourGrant(nowUtc);

        var source = membership.Role switch
        {
            AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner
                or AgriSync.SharedKernel.Contracts.Roles.AppRole.SecondaryOwner => "OwnerTier",
            _ => hasEffectiveGrant ? "ExplicitGrant" : "NotGranted",
        };

        return new LabourPermissionDto(
            UserId: membership.UserId.Value,
            Role: membership.Role.ToString(),
            Status: membership.Status.ToString(),
            CanManageLabourRecords: LabourManagementPermission.IsAllowed(
                membership.Role, hasEffectiveGrant),
            HasExplicitGrant: hasEffectiveGrant,
            Source: source,
            IsGrantEditable: !carriedByRole,
            LabourGrantExpiresAtUtc: hasEffectiveGrant ? membership.LabourGrantExpiresAtUtc : null);
    }
```

  `LabourPermissionDto` appends `DateTime? LabourGrantExpiresAtUtc` (param doc: *"The
  instant the responsibility ends, `null` for कायम — and `null` once lapsed: an expired
  grant reports as NotGranted with no ghost date."*).
  `GetLabourPermissionsHandler` ctor becomes
  `(IShramSafalRepository repository, IClock clock)` (add
  `using AgriSync.BuildingBlocks.Abstractions;`); in `HandleAsync` capture
  `var now = clock.UtcNow;` and change :63 to `.Select(m => LabourPermissionProjection.From(m, now))`.

- [ ] **2.2.8 — write path + wire.** `SetLabourPermissionCommand` appends
  `DateTime? LabourGrantExpiresAtUtc` (param doc: *"End of the responsibility window,
  UTC; `null` = कायम. Ignored (cleared) on a revoke."*). In
  `SetLabourPermissionHandler.HandleAsync`:
  - apply: `changed = membership.SetLabourRecordManagement(command.CanManageLabourRecords, command.LabourGrantExpiresAtUtc, now);`
  - add below the existing `catch (InvalidOperationException)`:

```csharp
        catch (ArgumentException)
        {
            // A past expiry grants nothing; refusing keeps the switch honest
            // (P5). Shape error, not an authorisation one.
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);
        }
```

  - audit payload gains `labourGrantExpiresAtUtc = command.LabourGrantExpiresAtUtc,`
    after `canManageLabourRecords` (a duration IS part of the decision; P3).
  - final projection: `LabourPermissionProjection.From(membership, now)`.

  `MembershipEndpoints.cs`: the request record (~:385) becomes

```csharp
public sealed record SetLabourPermissionRequest(
    bool CanManageLabourRecords,
    DateTime? LabourGrantExpiresAtUtc = null);
```

  and the PUT lambda's command construction adds
  `request?.LabourGrantExpiresAtUtc` as the final argument.

- [ ] **2.2.9 — the sweep.** Run `dotnet build src/AgriSync.sln` and fix EVERY error the
  compiler lists — it must reproduce the call-site table above (production sites get
  `clock.UtcNow`; the enforcer ctor gains `IClock clock`; `LogsEndpoints`' lambda gains
  `IClock clock`; test doubles' `GetLabourManagementGrantAsync` overrides gain `DateTime
  nowUtc` — the gate-tests `FakeRepo` override must HONOUR it:

```csharp
        public override Task<bool> GetLabourManagementGrantAsync(
            Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
        {
            GrantReads++;

            var membership = _memberships.FirstOrDefault(
                m => m.FarmId == new FarmId(farmId) && m.UserId == new UserId(userId));
            if (membership is not null)
            {
                return Task.FromResult(membership.HasEffectiveLabourGrant(nowUtc));
            }

            return Task.FromResult(_grants.Contains((farmId, userId)));
        }
```

  while `StubShramSafalRepository.cs:156` just widens its signature). Test call sites
  pass `Now` (their fixed instant) or `DateTime.UtcNow` (integration helpers). The
  grant-PG helpers become:

```csharp
    private Task<Result<LabourPermissionDto>> SetPermissionAsync(
        Guid farmId, Guid caller, Guid target, bool allowed, DateTime? expiresAtUtc = null)
        => RunUnderScopeAsync(farmId, caller, sp => new SetLabourPermissionHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(new SetLabourPermissionCommand(
                new FarmId(farmId), new UserId(target), allowed, new UserId(caller),
                "test", "device-test", "sha256:test", expiresAtUtc)));

    private Task<Result<IReadOnlyList<LabourPermissionDto>>> GetPermissionsAsync(Guid farmId, Guid caller)
        => RunUnderScopeAsync(farmId, caller, sp => new GetLabourPermissionsHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(new GetLabourPermissionsQuery(new FarmId(farmId), new UserId(caller))));

    private Task<bool> IsAllowedAsync(Guid farmId, Guid userId, DateTime? nowUtc = null)
        => RunUnderScopeAsync(farmId, userId, sp => LabourManagementGate.IsAllowedAsync(
            sp.GetRequiredService<IShramSafalRepository>(), farmId, userId,
            nowUtc ?? DateTime.UtcNow));
```

  Build must exit 0; then the full backend suite:
  `dotnet test src/tests/ShramSafal.Domain.Tests/` — green.

- [ ] **2.2.10 — the failing-then-green proofs that expiry works end to end.**
  (a) Gate-level, deterministic — append to `LabourCapabilityGateTests`:

```csharp
    [Fact]
    public async Task An_expired_grant_denies_forward_and_the_stored_decision_is_untouched()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        var membership = repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        membership.SetLabourRecordManagement(true, Now.AddHours(6), Now);

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA, Now.AddHours(1)))
            .Should().BeTrue("inside the window the grant answers");
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA, Now.AddHours(7)))
            .Should().BeFalse("जबाबदारी आपोआप संपेल — past the end the SAME row answers OFF");

        membership.CanManageLabourRecords.Should().BeTrue(
            "expiry denies FORWARD only: nothing the person did while responsible is rewritten");
    }

    [Fact]
    public async Task The_roster_never_reports_an_expired_grant_as_live()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, WorkerA, AppRole.Worker)
            .SetLabourRecordManagement(true, Now.AddDays(1), Now);

        var later = new GetLabourPermissionsHandler(repo, new FixedClock(Now.AddDays(2)));
        var result = await later.HandleAsync(
            new GetLabourPermissionsQuery(new FarmId(FarmA), new UserId(OwnerA)));

        var row = result.Value!.Single(r => r.UserId == WorkerA);
        row.CanManageLabourRecords.Should().BeFalse(
            "the projection evaluates the SAME clocked rule as the gate — Phase 0's second "
            + "evaluation site, fixed rather than inherited");
        row.Source.Should().Be("NotGranted");
        row.LabourGrantExpiresAtUtc.Should().BeNull("no ghost date on a lapsed grant");
    }
```

  Run them RED first if you wrote them before 2.2.7 (recommended); green after.
  (b) Real Postgres — the EF-translation proof, append to
  `LabourCapabilityGrantRealPostgresTests`:

```csharp
    [Fact]
    public async Task An_expired_grant_is_denied_by_the_real_SQL_predicate_and_nothing_is_rewritten()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var granted = await SetPermissionAsync(FarmA, OwnerA, WorkerBoth, allowed: true,
            expiresAtUtc: DateTime.UtcNow.AddHours(1));
        granted.IsSuccess.Should().BeTrue();
        granted.Value!.LabourGrantExpiresAtUtc.Should().NotBeNull();

        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeTrue(
            "inside the window — and this executes the expiry predicate on real Postgres, "
            + "which is the translation check the clock-threading decision was sized on");
        (await IsAllowedAsync(FarmA, WorkerBoth, DateTime.UtcNow.AddHours(2))).Should().BeFalse(
            "past the end the SAME stored row answers OFF");

        var (rowA, _) = await ReadGrantRowsAsync();
        rowA.Should().BeTrue("expiry denies forward; the stored decision is not rewritten backward");
    }
```

  Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~LabourCapabilityGrantRealPostgresTests"`.
  (c) Wire round-trip — append to `LabourPermissionEndpointTests`:

```csharp
    [Fact]
    public async Task A_duration_bounded_grant_round_trips_through_the_wire()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-5", "req-perm-5", farmId, "Permission Farm 5");
        await harness.SeedFarmMembershipAsync(farmId, MukadamUserId, AppRole.Mukadam);

        var end = DateTime.UtcNow.AddDays(2);
        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{MukadamUserId}",
            new { canManageLabourRecords = true, labourGrantExpiresAtUtc = end });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.Equal(end, doc.RootElement.GetProperty("labourGrantExpiresAtUtc").GetDateTime(),
            TimeSpan.FromSeconds(1));
    }
```

- [ ] **2.2.11 — frontend type + PUT.** `labourPermissionsClient.ts`: add to
  `LabourPermission`:

```ts
    /**
     * ISO instant the responsibility ends, or null for कायम. Null once lapsed —
     * the server never reports an expired window as a live one.
     */
    labourGrantExpiresAtUtc: string | null;
```

  and:

```ts
export async function setLabourPermission(
    farmId: string,
    targetUserId: string,
    canManageLabourRecords: boolean,
    labourGrantExpiresAtUtc: string | null = null,
): Promise<LabourPermission> {
    const response = await agriSyncClient.http.put<LabourPermission>(
        labourPermissionPath(farmId, targetUserId),
        { canManageLabourRecords, labourGrantExpiresAtUtc },
    );
    return response.data;
}
```

  `useLabourPermissions.ts`: `setPermission` signature (interface :71 and
  implementation) becomes
  `(targetUserId: string, canManageLabourRecords: boolean, labourGrantExpiresAtUtc?: string | null) => Promise<void>`,
  forwarding `labourGrantExpiresAtUtc ?? null`. Update the two test fixtures to carry
  `labourGrantExpiresAtUtc: null` (tsc enforces).
  `cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/profile/__tests__/` — green.

- [ ] **2.2.12 — full green + commit.** `dotnet build src/AgriSync.sln`;
  `dotnet test src/tests/ShramSafal.Domain.Tests/`;
  `dotnet test src/tests/AgriSync.ArchitectureTests/`; integration filter as above.
  Commit: `feat(labour): time-bounded labour authority — labour_grant_expires_at_utc, evaluated at both sites`

---
---

# Task 2.3 — Server-side denial proof + the जबाबदारी द्या presentation

**Surface:** the EXISTING switch surface — `IdentitySection.tsx:474-523` feeding
`TeamMemberCard.tsx`'s `labourAccess` block (:124-190). No new screen (the founder
approved the Task 1.7 mockup `07-allow-labour-management.html`; D5 re-presents it).
**Copy:** ONLY the D5 harvested set — **जबाबदारी द्या** · **प्रकाशला किती दिवस?**
(name-templated) · **कामगारांची जबाबदारी आहे** · **जबाबदारी आपोआप संपेल** · chips
**आज / 2 दिवस / 3 दिवस / तारीख / कायम** · confirmation pattern
"4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल". **Zero permission vocabulary** — the
pre-existing collapsed-card label `प्रवेश ठरवा` ("decide access") violates D5 and becomes
`जबाबदारी ठरवा` (composed strictly of his approved word). The English placeholders
("Fix labour records", "Can change attendance, hours and names", "Comes with their
role") are REPLACED by approved copy — the founder-copy hold that kept them English is
lifted by the master review ("Marathi copy gaps are CLOSED").

**One flagged extrapolation (surface at the gate, do not hide):** the confirmation line
needs full month names; his file supplies **सप्टेंबर** verbatim. The other eleven are
standard dictionary full forms added as `MARATHI_MONTHS_FULL` — flagged in the code
comment and in the phase's founder note, because `marathiDate.ts`'s header says
expanding month forms is a founder decision. Error strings in
`LABOUR_PERMISSION_MESSAGES` stay English — D5 harvested no error copy, and inventing
farmer-facing Marathi is still forbidden.

**Timezone semantics, stated once and tested:** durations count the FARMER'S local days
and include today. आज → next local midnight; N दिवस → local midnight + N days; a picked
तारीख runs THROUGH that date (expiry = following local midnight); कायम → `null`. The
server stores and compares the UTC instant (strict `now < expiresAt`, Task 2.2).

## Files

| Action | Path | Anchor (verified) |
|---|---|---|
| Create | `src/clients/mobile-web/src/features/profile/components/responsibilityDuration.ts` | new |
| Create | `src/clients/mobile-web/src/features/profile/components/__tests__/responsibilityDuration.test.ts` | new |
| Create | `src/clients/mobile-web/src/features/profile/components/__tests__/TeamMemberCard.responsibility.test.tsx` | new |
| Modify | `src/clients/mobile-web/src/features/labour/marathiDate.ts` | append `MARATHI_MONTHS_FULL` |
| Modify | `src/clients/mobile-web/src/features/profile/components/TeamMemberCard.tsx` | `LabourAccessView` iface (~:56-75); labourAccess block :124-190; `प्रवेश ठरवा` :118 |
| Modify | `src/clients/mobile-web/src/features/profile/sections/IdentitySection.tsx` | :490-499 mapping |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourCapabilityGrantRealPostgresTests.cs` | + denial-proof fact |

## Interfaces

- **Produces:** `DURATION_CHIPS`, `expiryUtcForChip`, `responsibilityEndLine`,
  `MARATHI_MONTHS_FULL`; the widened `LabourAccessView`
  (`expiresAtUtc: string | null`, `onChange(next: boolean, expiresAtUtc: string | null)`).
- **Consumes:** Task 2.2's `setPermission(targetUserId, canManage, expiresAtUtc?)` and
  `LabourPermission.labourGrantExpiresAtUtc`; `parseIsoDate` from `marathiDate.ts`;
  D5 approved copy.

## Steps

- [ ] **2.3.1 — failing tests for the duration module.** Create
  `responsibilityDuration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    DURATION_CHIPS,
    expiryUtcForChip,
    responsibilityEndLine,
} from '../responsibilityDuration';

// A fixed local moment: 2 Sep 2026, 14:30 local.
const now = new Date(2026, 8, 2, 14, 30);

describe('expiryUtcForChip', () => {
    it('renders the five approved chips, verbatim, in order', () => {
        expect(DURATION_CHIPS.map(c => c.label)).toEqual(['आज', '2 दिवस', '3 दिवस', 'तारीख', 'कायम']);
    });

    it('आज ends at the next local midnight', () => {
        expect(expiryUtcForChip('today', now)).toBe(new Date(2026, 8, 3).toISOString());
    });

    it('N दिवस counts local days INCLUDING today', () => {
        expect(expiryUtcForChip('twoDays', now)).toBe(new Date(2026, 8, 4).toISOString());
        expect(expiryUtcForChip('threeDays', now)).toBe(new Date(2026, 8, 5).toISOString());
    });

    it('a picked तारीख runs THROUGH that date', () => {
        expect(expiryUtcForChip('date', now, '2026-09-04')).toBe(new Date(2026, 8, 5).toISOString());
    });

    it('कायम is null — and a bad picked date must NEVER become कायम', () => {
        expect(expiryUtcForChip('permanent', now)).toBeNull();
        expect(() => expiryUtcForChip('date', now, 'not-a-date')).toThrow();
        expect(() => expiryUtcForChip('date', now)).toThrow();
    });
});

describe('responsibilityEndLine', () => {
    it('names the day the responsibility runs THROUGH, in the approved pattern', () => {
        // Expiry at local midnight 5 Sep => runs through 4 Sep — the founder's own example.
        const line = responsibilityEndLine(new Date(2026, 8, 5).toISOString());
        expect(line).toBe('4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल');
    });

    it('कायम has no end line', () => {
        expect(responsibilityEndLine(null)).toBe('');
    });

    it('never uses permission vocabulary', () => {
        const line = responsibilityEndLine(new Date(2026, 8, 5).toISOString());
        expect(line).not.toMatch(/permission|grant|role|claim|policy|access/i);
    });
});
```

- [ ] **2.3.2 — run and see fail.**
  `cd src/clients/mobile-web && npx vitest run src/features/profile/components/__tests__/responsibilityDuration.test.ts`
  Expected: module-not-found failure (`../responsibilityDuration` does not exist).

- [ ] **2.3.3 — implement.** Append to `marathiDate.ts`:

```ts
/**
 * Full Marathi month forms, for sentence copy. The D5 confirmation line
 * ("4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल", founder master review
 * 2026-09-02) writes the month in full — सप्टेंबर is the founder's own
 * spelling; the other eleven are the standard dictionary full forms of the
 * months abbreviated above, surfaced at the Task 2.3 founder gate rather than
 * silently invented. The abbreviated set stays the register/date-header
 * vocabulary.
 */
export const MARATHI_MONTHS_FULL = [
    'जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून',
    'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर',
];
```

  Create `responsibilityDuration.ts`:

```ts
/**
 * जबाबदारी द्या — duration chips and their end instants (founder master review
 * 2026-09-02, D5). Approved copy, verbatim: आज · 2 दिवस · 3 दिवस · तारीख ·
 * कायम; ON-state "कामगारांची जबाबदारी आहे"; end-line pattern
 * "4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल".
 *
 * NO PERMISSION VOCABULARY, EVER — not permission, grant, role, claim, policy,
 * access — in any string this module produces.
 *
 * Durations count the FARMER'S local days and include today: आज ends at
 * tonight's local midnight; "2 दिवस" at the midnight after tomorrow; a picked
 * तारीख runs THROUGH that date (ends at the following local midnight); कायम
 * has no end. The server stores and compares the UTC instant (strict
 * now < expiresAt).
 */
import { MARATHI_MONTHS_FULL, parseIsoDate } from '../../labour/marathiDate';

export type ResponsibilityDurationChip = 'today' | 'twoDays' | 'threeDays' | 'date' | 'permanent';

export const DURATION_CHIPS: ReadonlyArray<{ chip: ResponsibilityDurationChip; label: string }> = [
    { chip: 'today', label: 'आज' },
    { chip: 'twoDays', label: '2 दिवस' },
    { chip: 'threeDays', label: '3 दिवस' },
    { chip: 'date', label: 'तारीख' },
    { chip: 'permanent', label: 'कायम' },
];

const localMidnightPlusDays = (from: Date, days: number): Date =>
    new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);

/**
 * The UTC instant a chip's responsibility ends, or null for कायम.
 * THROWS on a missing/unparseable picked date rather than returning null —
 * null MEANS कायम, and a bad date must never silently become "forever".
 */
export function expiryUtcForChip(
    chip: ResponsibilityDurationChip,
    now: Date,
    pickedIsoDate?: string,
): string | null {
    switch (chip) {
        case 'today': return localMidnightPlusDays(now, 1).toISOString();
        case 'twoDays': return localMidnightPlusDays(now, 2).toISOString();
        case 'threeDays': return localMidnightPlusDays(now, 3).toISOString();
        case 'date': {
            const picked = pickedIsoDate ? parseIsoDate(pickedIsoDate) : null;
            if (!picked) {
                throw new Error('a तारीख chip needs a valid picked date — null here would mean कायम');
            }
            return localMidnightPlusDays(picked, 1).toISOString();
        }
        case 'permanent': return null;
    }
}

/**
 * "4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल" — names the day the
 * responsibility runs THROUGH (the expiry instant is the following local
 * midnight, so the named day is expiry − 1 day). Latin digits for the day
 * number, exactly as the founder's own line writes "4" (numerals convention).
 * Returns '' for कायम — no end, no line — and '' for an unparseable instant
 * rather than a fabricated date.
 */
export function responsibilityEndLine(expiresAtUtc: string | null): string {
    if (!expiresAtUtc) return '';
    const expiry = new Date(expiresAtUtc);
    if (Number.isNaN(expiry.getTime())) return '';
    const through = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate() - 1);
    return `${through.getDate()} ${MARATHI_MONTHS_FULL[through.getMonth()]}पर्यंत · नंतर जबाबदारी आपोआप संपेल`;
}
```

- [ ] **2.3.4 — run 2.3.1 green.** Same vitest command — all pass.

- [ ] **2.3.5 — failing card test.** Create `TeamMemberCard.responsibility.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TeamMemberCard from '../TeamMemberCard';

const member = { id: 'user-1', name: 'प्रकाश', role: 'worker' };

const renderCard = (labourAccess: {
    canManage: boolean; isEditable: boolean; saving: boolean;
    expiresAtUtc: string | null;
    onChange: (next: boolean, expiresAtUtc: string | null) => void;
}) => render(
    <TeamMemberCard
        member={member as never}
        labourAccess={labourAccess}
        onToggleCap={() => {}}
        onDelete={() => {}}
    />,
);

const openCard = () => fireEvent.click(screen.getByText('जबाबदारी ठरवा'));

describe('जबाबदारी द्या (D5)', () => {
    it('OFF state offers जबाबदारी द्या and picking कायम grants with no end', () => {
        const onChange = vi.fn();
        renderCard({ canManage: false, isEditable: true, saving: false, expiresAtUtc: null, onChange });
        openCard();

        fireEvent.click(screen.getByText('जबाबदारी द्या'));
        expect(screen.getByText('प्रकाशला किती दिवस?')).toBeTruthy();
        for (const label of ['आज', '2 दिवस', '3 दिवस', 'तारीख', 'कायम']) {
            expect(screen.getByText(label)).toBeTruthy();
        }

        fireEvent.click(screen.getByText('कायम'));
        expect(onChange).toHaveBeenCalledWith(true, null);
    });

    it('a day chip grants until the computed local midnight', () => {
        const onChange = vi.fn();
        renderCard({ canManage: false, isEditable: true, saving: false, expiresAtUtc: null, onChange });
        openCard();
        fireEvent.click(screen.getByText('जबाबदारी द्या'));
        fireEvent.click(screen.getByText('2 दिवस'));

        expect(onChange).toHaveBeenCalledTimes(1);
        const [next, iso] = onChange.mock.calls[0];
        expect(next).toBe(true);
        const now = new Date();
        expect(iso).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString());
    });

    it('ON state states the responsibility and its end, and tapping revokes', () => {
        const onChange = vi.fn();
        const end = new Date(2026, 8, 5).toISOString();
        renderCard({ canManage: true, isEditable: true, saving: false, expiresAtUtc: end, onChange });
        openCard();

        expect(screen.getByText('कामगारांची जबाबदारी आहे')).toBeTruthy();
        expect(screen.getByText('4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल')).toBeTruthy();

        fireEvent.click(screen.getByText('कामगारांची जबाबदारी आहे'));
        expect(onChange).toHaveBeenCalledWith(false, null);
    });

    it('renders no permission vocabulary anywhere', () => {
        const { container } = renderCard({
            canManage: true, isEditable: false, saving: false, expiresAtUtc: null, onChange: vi.fn(),
        });
        openCard();
        expect(container.textContent).not.toMatch(/permission|grant|\brole\b|claim|policy|access/i);
    });
});
```

- [ ] **2.3.6 — run and see fail.**
  `npx vitest run src/features/profile/components/__tests__/TeamMemberCard.responsibility.test.tsx`
  Expected: `जबाबदारी ठरवा` / `जबाबदारी द्या` not found (the card still says
  `प्रवेश ठरवा` and "Fix labour records").

- [ ] **2.3.7 — implement the card.** In `TeamMemberCard.tsx`:
  - `LabourAccessView` gains `expiresAtUtc: string | null;` and `onChange` becomes
    `(next: boolean, expiresAtUtc: string | null) => void;` (doc: *"null = कायम"*).
  - :118: `प्रवेश ठरवा` → `जबाबदारी ठरवा` (D5 bans access vocabulary; ठरवा is retained,
    प्रवेश is replaced with his approved word).
  - Add imports:
    `import { DURATION_CHIPS, expiryUtcForChip, responsibilityEndLine } from './responsibilityDuration';`
    and local state `const [choosingDuration, setChoosingDuration] = useState(false);`
    plus `const [pickedDate, setPickedDate] = useState('');`.
  - Replace the entire `{labourAccess.isEditable ? (…) : (…)}` block (:150-188) with:

```tsx
                            {labourAccess.isEditable ? (
                                labourAccess.canManage ? (
                                    /* ON — the responsibility is stated, with its end.
                                       Tapping revokes: PUT(false), no second control,
                                       no new copy needed. */
                                    <button
                                        type="button"
                                        data-testid={`labour-access-${member.id}`}
                                        onClick={() => labourAccess.onChange(false, null)}
                                        disabled={labourAccess.saving}
                                        aria-pressed={true}
                                        aria-busy={labourAccess.saving}
                                        className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left shadow-sm shadow-emerald-100 transition-all active:scale-[0.98] disabled:opacity-60"
                                    >
                                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                                            <ClipboardList size={18} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-bold text-slate-800">कामगारांची जबाबदारी आहे</span>
                                            {responsibilityEndLine(labourAccess.expiresAtUtc) !== '' && (
                                                <span className="block text-[11px] leading-snug text-slate-500">
                                                    {responsibilityEndLine(labourAccess.expiresAtUtc)}
                                                </span>
                                            )}
                                        </span>
                                        <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-emerald-500">
                                            <span className="absolute left-0.5 top-0.5 h-5 w-5 translate-x-5 rounded-full bg-white shadow-sm" />
                                        </span>
                                    </button>
                                ) : choosingDuration ? (
                                    /* Duration chips — the D5 flow: pick the person is
                                       done (this card), pick the duration, done. */
                                    <div
                                        data-testid={`labour-access-${member.id}`}
                                        className="rounded-xl border border-emerald-200 bg-white p-3"
                                    >
                                        <p className="mb-2 text-sm font-bold text-slate-800">
                                            {`${member.name}ला किती दिवस?`}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {DURATION_CHIPS.map(({ chip, label }) => (
                                                <button
                                                    key={chip}
                                                    type="button"
                                                    disabled={labourAccess.saving}
                                                    onClick={() => {
                                                        if (chip === 'date') return; // the input below submits
                                                        labourAccess.onChange(true, expiryUtcForChip(chip, new Date()));
                                                        setChoosingDuration(false);
                                                    }}
                                                    className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-800 transition-all active:scale-95 disabled:opacity-60"
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            type="date"
                                            aria-label="तारीख"
                                            value={pickedDate}
                                            onChange={(e) => {
                                                const iso = e.target.value;
                                                setPickedDate(iso);
                                                if (iso) {
                                                    labourAccess.onChange(true, expiryUtcForChip('date', new Date(), iso));
                                                    setChoosingDuration(false);
                                                }
                                            }}
                                            className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm"
                                        />
                                    </div>
                                ) : (
                                    /* OFF — the door: जबाबदारी द्या. */
                                    <button
                                        type="button"
                                        data-testid={`labour-access-${member.id}`}
                                        onClick={() => setChoosingDuration(true)}
                                        disabled={labourAccess.saving}
                                        aria-pressed={false}
                                        aria-busy={labourAccess.saving}
                                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60"
                                    >
                                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                            <ClipboardList size={18} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-bold text-slate-800">जबाबदारी द्या</span>
                                        </span>
                                        <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-slate-300">
                                            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm" />
                                        </span>
                                    </button>
                                )
                            ) : (
                                /* Owner-tier — permanently on, non-interactive (P5). */
                                <div
                                    data-testid={`labour-access-${member.id}`}
                                    className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left"
                                >
                                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                                        <ClipboardList size={18} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold text-slate-800">कामगारांची जबाबदारी आहे</span>
                                    </span>
                                    <span className="flex-shrink-0 text-emerald-600"><CheckCircle2 size={22} /></span>
                                </div>
                            )}
```

  - Update the block's leading comment: the "ENGLISH ONLY, by founder ruling" paragraph
    is superseded — replace with *"COPY: the D5 approved set, verbatim (master review
    2026-09-02). No permission vocabulary anywhere on this surface."*
  - `IdentitySection.tsx` (:490-499): the mapping gains the two fields:

```tsx
                                        return {
                                            canManage: row.canManageLabourRecords,
                                            isEditable: row.isGrantEditable,
                                            saving: labourPermissions.savingUserId === row.userId,
                                            expiresAtUtc: row.labourGrantExpiresAtUtc,
                                            onChange: (next: boolean, expiresAtUtc: string | null) =>
                                                void labourPermissions.setPermission(row.userId, next, expiresAtUtc),
                                        };
```

- [ ] **2.3.8 — run green.**
  `npx tsc --noEmit && npx vitest run src/features/profile/` — the new card tests and
  every pre-existing profile test pass.

- [ ] **2.3.9 — the server-side denial proof (failing first on pre-2.1 code, green
  now — write it regardless; it is THE Task 2.3 acceptance).** Append to
  `LabourCapabilityGrantRealPostgresTests`:

```csharp
    /// <summary>
    /// Task 2.3 acceptance: a Mukadam with the switch OFF is REFUSED by
    /// LabourManagementGate.IsAllowedAsync on the server, driving a REAL labour
    /// handler as him under his own scope — not merely hidden in the UI.
    /// </summary>
    [Fact]
    public async Task Switching_a_Mukadam_off_denies_his_next_labour_write_server_side()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var mukadam = Guid.Parse("c9d77777-7777-7777-7777-777777777777");
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedMembershipAsync(seed, FarmA, mukadam, AccountA, "Mukadam");
        }

        // Round-trip the owner's switch: ON, then OFF — he stays a Mukadam throughout.
        (await SetPermissionAsync(FarmA, OwnerA, mukadam, allowed: true)).IsSuccess.Should().BeTrue();
        (await SetPermissionAsync(FarmA, OwnerA, mukadam, allowed: false)).IsSuccess.Should().BeTrue(
            "the owner may keep him as Mukadam with the responsibility OFF");

        var refused = await RunUnderScopeAsync(FarmA, mukadam, sp =>
            new CreateFieldOperatorHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IIdGenerator>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(new CreateFieldOperatorCommand(
                new FarmId(FarmA), "गणेश", null, new UserId(mukadam))));

        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("ShramSafal.Forbidden",
            "denied by the shared gate on the server — Forbidden, never NotFound, so a forged "
            + "farm id cannot probe existence");
    }
```

  (add `using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;` to the file's
  usings). Run the integration filter — green on :5433.

- [ ] **2.3.10 — commit.**
  `feat(labour): जबाबदारी द्या — duration chips on the team card, denial proven server-side`

---
---

# Task 2.4 — Ledger reads never consult the write-authority gate (a test, not a build)

**Scope, exactly as the plan narrowed it:** an actor entitled to read हजेरी must not lose
that access because capture state is missing. This task asserts ONE structural fact — no
ledger/labour read path takes `LabourManagementGate.IsAllowedAsync` (the WRITE-authority
gate) as an authorisation input. It does NOT assert that membership alone authorises
reading attendance or money — the read path's existing boundary (Phase 0 UNKNOWN 5,
answered with file:line: `LabourEndpoints.cs:66` → `CallerFarmTenantScope.cs:99-108`,
plus `GetLabourDataHandler.cs:173-177`'s null-role denial) **stays exactly as it is;
this test neither adds nor removes it.** `HasExplicitGrantAsync` is deliberately
permitted: `GetLabourDataHandler.cs:185` feeds it to the verification FSM as a
next-actions input (:179-184's own comment), not a read gate.

## Files

| Action | Path |
|---|---|
| Create | `src/tests/AgriSync.ArchitectureTests/LabourLedgerReadRules.cs` |

## Interfaces

- **Produces:** the pin itself — Phase 4's ledger rework and Phase 3's read surfaces are
  built under it.
- **Consumes:** the `LabourAnchorRules.cs` regex-scan idiom (:39-56, helpers :121-149 —
  which say of themselves "copy, do not import").

## Steps

- [ ] **2.4.1 — write the test.** Create `LabourLedgerReadRules.cs`:

```csharp
using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// R1 Task 2.4 (final direction §7, narrowed by the 2026-09-01 plan) — the
/// हजेरी ledger must not lose an entitled reader because capture state is
/// missing, so NO ledger/labour read path may take the labour WRITE-authority
/// gate as an authorisation input.
///
/// <para>Regex source scan in the <c>LabourAnchorRules</c> style; no
/// NetArchTest. This pin neither adds nor removes the access check the read
/// path performs today (caller is the declared owner OR holds a non-terminal
/// membership — pre-existing, repo-wide, out of Labour V2's scope to redesign).
/// It only stops a future executor wiring capture/write authority into the
/// read while building Phase 2+.</para>
///
/// <para><b><c>HasExplicitGrantAsync</c> is deliberately NOT banned:</b>
/// <c>GetLabourDataHandler</c> feeds it to the verification FSM to compute
/// which next-actions to render — an FSM input, not a read gate.</para>
/// </summary>
public sealed class LabourLedgerReadRules
{
    private const string WriteAuthorityToken = "LabourManagementGate.IsAllowedAsync(";

    private const string ShippedLedgerRead =
        "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs";

    [Fact]
    public void Ledger_and_labour_reads_never_consult_the_write_authority_gate()
    {
        // Read-path candidates: every production Get*Handler under
        // UseCases/Labour, plus any production file that builds or names the
        // ledger. Matched on the src-relative path, forward slashes.
        var candidates = ProductionSourceFiles()
            .Where(path =>
            {
                var relative = Relative(path);
                var fileName = Path.GetFileName(relative);

                var isLabourReadHandler =
                    relative.Contains("/UseCases/Labour/", StringComparison.Ordinal)
                    && fileName.StartsWith("Get", StringComparison.Ordinal)
                    && fileName.EndsWith("Handler.cs", StringComparison.Ordinal);

                var namesTheLedger =
                    fileName.Contains("Ledger", StringComparison.Ordinal)
                    || StripComments(File.ReadAllText(path))
                        .Contains("BuildHajeriLedger", StringComparison.Ordinal);

                return isLabourReadHandler || namesTheLedger;
            })
            .ToArray();

        // Vacuity guard: the one shipped ledger read must be inside the scan,
        // or this pin pins nothing.
        candidates.Select(Relative).Should().Contain(ShippedLedgerRead,
            "if GetLabourDataHandler moved, update ShippedLedgerRead — never delete this guard");

        var offenders = candidates
            .Where(path => StripComments(File.ReadAllText(path))
                .Contains(WriteAuthorityToken, StringComparison.Ordinal))
            .Select(Relative)
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToArray();

        offenders.Should().BeEmpty(
            "IsAllowedAsync answers 'may this caller REWRITE labour truth'. A ledger read asking it "
            + "would make the register vanish for a member whose capture authority is off — the exact "
            + "gating final direction §7 forbids. The read path's own access check stays as it is. "
            + $"Offenders: [{string.Join(", ", offenders)}]");
    }

    // ── copied from LabourAnchorRules (private static there; copy, do not import) ──

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

- [ ] **2.4.2 — prove the tripwire trips (the red step for a pin).** Temporarily add to
  `GetLabourDataHandler.HandleAsync` (anywhere after :185):
  `_ = LabourManagementGate.IsAllowedAsync(repository, query.FarmId.Value, query.CallerUserId.Value, clock.UtcNow, ct);`
  Run `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~LabourLedgerReadRules"`
  Expected: **FAIL**, offender list names exactly
  `apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs`.

- [ ] **2.4.3 — revert the tripwire line, run again, see green.** Same command — pass.
  Also run the whole project: `dotnet test src/tests/AgriSync.ArchitectureTests/` (the
  vacuity guard must hold alongside the existing rules).

- [ ] **2.4.4 — commit.**
  `test(arch): ledger reads never consult the labour write-authority gate`

---
---

## Phase-exit checklist

- [ ] `dotnet build src/AgriSync.sln` — zero warnings introduced, zero errors.
- [ ] `dotnet test src/tests/ShramSafal.Domain.Tests/` — green.
- [ ] `dotnet test src/tests/AgriSync.ArchitectureTests/` — green (Definition of Done requires this project explicitly).
- [ ] `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~Labour|FullyQualifiedName~OwnerCanApprove"` on a machine with Postgres :5433 — green (facts skip cleanly elsewhere; a skipped security proof is NOT a passed one — run them before the founder gate).
- [ ] `cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run` — green.
- [ ] `git log origin/main -- "*AddAttendanceMarks*"` still empty at merge time (if it stops being empty mid-work, Task 2.5's edits must be re-issued as a new migration — STOP and escalate).
- [ ] No new migration exists for Task 2.1 (no backfill — founder ruling), exactly one for Task 2.2 (`AddLabourGrantExpiry`), zero for 2.3/2.4.
- [ ] Founder note for the gate (surface, don't bury): (1) `MARATHI_MONTHS_FULL` extrapolates eleven dictionary month spellings from his approved "सप्टेंबर" pattern; (2) `प्रवेश ठरवा` → `जबाबदारी ठरवा` composed from his approved word; (3) `LABOUR_PERMISSION_MESSAGES` remain English — no approved Marathi error copy exists; (4) OFF removes Draft→Confirmed too (one-switch consequence, pinned by test).
- [ ] Nothing merged to `main`; nothing deployed. Code-complete ≠ approved; approved ≠ deployed.
