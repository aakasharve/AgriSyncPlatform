# Phase 4 — The Register (हजेरी वही), at implementation precision

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Work on branch `feat/labour-v2-r1`. Nothing merges to
> `main` without the founder's gate.

**Goal:** The हजेरी वही reads `AttendanceMark` rows, renders the founder's APPROVED CLEAN grid
(name + day cells only — no money, no totals column, no bottom line), never disappears, resolves
D-H8's three views in the read path, preserves the no-work day's disturbance, and puts the two
money truths (रोजंदारी नोंदलेली / उक्ते ठरलेली) on the Labour home — never combined.

**Architecture:** The register's cells move from the engagement plane (derive-from-names, shipped
2026-08-31) to the mark plane (`AttendanceMark`, one ruling per person per farm-day). Engagement
data keeps exactly two register jobs: the उक्ते dot (a mark-cell's person-day work rows point at an
engagement whose `ContractUnit` is stated) and the crew aggregate rows (engagements engaged-through
a Labour Mukadam, per-day stated counts). Money never enters the grid; it moves to the Labour home
(owner view only) and tap-detail. All display, zero arithmetic: nothing multiplies, nothing
converts hours to day-fractions, nothing turns silence into zero.

**Tech Stack:** .NET 10 (xUnit, FluentAssertions in integration tests / plain `Assert` in
`ShramSafal.Domain.Tests`), EF Core + PostgreSQL 16, React 19 + TypeScript + Vite, Vitest.

**Spec:**
`docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md`
(BINDING, wins over everything) ·
`docs/superpowers/plans/2026-09-01-labour-v2-r1-human-execution-layer.md` (Global Constraints +
Phase 4 tasks + 2026-09-02 additions) ·
`docs/superpowers/plans/2026-09-01-labour-v2-r1-PHASE0-FINDINGS.md` (file:line ground truth) ·
`docs/superpowers/plans/2026-09-01-labour-v2-r1-REVISION-1.md` (the nine-question fence — SETTLED,
never re-opened here).

---

## Phase-level constraints (verbatim consequences of the 2026-09-02 master review)

- **The register is CLEAN.** "नावाखाली कोणताही summary, कामाचा मजकूर किंवा पैशांची कळ नाही. नाव +
  दिवसाचे खूण एवढेच." No ₹ in any cell, no row-end money, no bottom line, **no totals column of
  any kind — not days, not people, not money**. `LabourLedgerRowDto.Total`, `LabourLedgerDto.
  WeekTotal` and `LabourLedgerDto.DailyTotals` leave the grid contract. Day-count reads live in
  detail views. This supersedes D-H7 and the money-display half of ruling (b). Never-CALCULATE
  still binds everywhere.
- **Approved cell vocabulary:** ✓ पूर्ण · ½ अर्धा · – अनुपस्थित · blank dashed = कुणी माहिती नाही ·
  split day/night (◾ रात्र) · +N जादा तास · Nत stated hours · violet dot top-right = उक्ते
  engagement. Crew aggregate row carries per-day **counts** in violet cells, blank when unknown,
  never folded into the mukadam's own row. All stated facts, no derived arithmetic.
- **NIGHT never renders as a full-day tick** (kills the live defect at
  `GetLabourDataHandler.cs:827` / `:865`).
- **The ledger is never gated by capture state.** No flag, no `named.Count == 0` early return, no
  empty-DTO vanishing act. Unknown renders blank — never zero, never `–`.
- **D-H8 three views bind the read path** — owner (whole book) / मुकादम (crew attendance, **no
  money roster**) / worker (own row only) — implemented on the boundary Phase 0 documented
  (role from `GetUserRoleForFarmAsync`), WITHOUT redesigning farm privacy.
- **Numerals:** Devanagari digits in date headers; Latin digits for quantities, hours and money.
- **No new farmer-facing Marathi.** Every string used below is from the founder's harvested list
  or already ships in the repo.
- **No R1 read path may consume `AttendanceMark.Value`** (`AttendanceMark.cs:151-158`).
- **Blank (unknown) is not absent; a stated amount survives unchanged; a missing amount renders
  blank, never ₹0.**
- **No DB work in this phase.** No migration, no grant, no policy. (The hours columns are Phase 2
  Task 2.5, inside the unshipped `20260831180408_AddAttendanceMarks` — verified unshipped on this
  worktree 2026-09-02: `git log origin/main -- "*AddAttendanceMarks*"` returns empty.)

**Change Surface**
- **DB:** none (explicitly — see above).
- **Backend:** `LabourDataDto.cs` (grid contract, view discriminator, nullable money members, new
  `LabourHomeDto`), `GetLabourDataHandler.cs` (`BuildHajeriLedger` rewrite, port wiring, view
  resolution, home aggregates), `AttendanceMark.cs` (`[Obsolete]` on `Value` only),
  tests in `ShramSafal.Domain.Tests` + one RealPostgres suite.
- **Frontend:** `labour.types.ts`, `labourClient.ts`, `labourMock.ts`, `HajeriLedger.tsx`,
  new `HajeriCellDetail.tsx`, `LabourHub.tsx`, `WeeklyDashboard.tsx`, `LabourUiKit.tsx`,
  `PersonDetail.tsx`, `attendanceDraft.ts`, Vitest suites.
- **Cross-cutting:** the labour GET wire contract changes shape (ledger cells, view, home,
  nullable money). Backend and frontend halves land inside the same phase; the phase is not done
  until both halves are committed (transient drift between Task 1 and Task 3 commits is
  acceptable inside the branch, never at the founder gate).

**Verified-count correction carried into this rewrite:** `BuildHajeriLedgerTests.cs` holds **8**
`[Fact]`s (the plan said 10 — counted in file 2026-09-02). All 8 are rewritten below; none is
deleted; each old fact's intent is named next to its replacement.

**Execution order:** Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8.
Task 5 (deleting the door switches, brief Task 4.0) deliberately runs AFTER the register is
finished — Decision 4b: un-hiding a surface means finishing it first.

---

## Interfaces this phase CONSUMES (built by other phases)

| From | Interface | Exact shape consumed |
|---|---|---|
| Phase 2 (Task 2.5) | `AttendanceMark.HoursWorked` | `public decimal? HoursWorked { get; }` — stated hours, null = nobody said |
| Phase 2 (Task 2.5) | `AttendanceMark.ExtraHours` | `public decimal? ExtraHours { get; }` — stated extra hours, null = nobody said |
| Phase 2 (Task 2.5) | hours provenance | `LabourTimeBasis AttendanceMark.HoursBasis` (Explicit-only beside stated hours). Phase 4 only DISPLAYS stored hours and never converts them into day fractions — the read path consumes the two decimals and nothing else; the TEST helper must stamp `Explicit` when creating marks with hours, or the domain guard throws |
| Phase 3 (Task 3.6, Phase 0 UNKNOWN 1) | `LabourAssignment.EngagedThroughFieldOperatorId` | `public Guid? EngagedThroughFieldOperatorId { get; }` — null = nobody said through whom; trailing optional `engagedThroughFieldOperatorId` on `LabourAssignment.Create` AND `LabourAssignmentFactory.FromParsed` |
| Phase 3 (write path) | `AttendanceMark` rows exist to read; the semantic person-day conflict check lives in `RecordAttendanceMarkHandler` (Phase 3) — Task 7 here builds only the structural proof + safety-net pin, never the detector |
| Already shipped (reused, never rebuilt) | `IShramSafalRepository.GetAttendanceMarksForFarmInWindowAsync(FarmId farmId, DateOnly? from, DateOnly? toInclusive, CancellationToken ct = default)` → `Task<IReadOnlyList<AttendanceMark>>` (`IShramSafalRepository.cs:919-923`, impl `ShramSafalRepository.cs:1577`) |
| Already shipped | `IShramSafalRepository.GetFieldOperatorsForFarmAsync(FarmId, CancellationToken)` → `Task<IReadOnlyList<FieldOperator>>` (`:862`, impl `:1521`) |
| Already shipped | `IShramSafalRepository.GetFieldOperatorWorkRowsForAssignmentsAsync(IReadOnlyCollection<Guid>, CancellationToken)` → `Task<IReadOnlyList<FieldOperatorWorkRow>>` (`:1004-1006`, impl `:1645`) — **NOT farm-scoped by itself; caller filters `FarmId`** |
| Already shipped | `LabourHeadcount.Resolve(int? workerCount, int? maleCount, int? femaleCount)` → `int?` (used at `GetLabourDataHandler.cs:598`) |
| Already shipped | `LabourAssignment.{ContractUnit, ContractQuantity, WagePerPerson, TotalCost, Task, Shift, WorkerCount, MaleCount, FemaleCount, DailyLogId}` (`LabourAssignment.cs:59-82`) |

**Ordering note:** if Phase 2's hours members or Phase 3 Task 3.6's `EngagedThroughFieldOperatorId` are not
yet on the branch when a task below references them, STOP and execute those phases first — do not
stub the members here; two definitions of the same domain member is how the branch forks against
itself.

## Interfaces this phase PRODUCES (relied on by later phases / the client)

```csharp
// ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs
public sealed record LabourDataDto(
    IReadOnlyList<string> TopLevelIds,
    IReadOnlyList<LabourPersonDto> People,
    LabourDashboardDto Dashboard,
    LabourLedgerDto Ledger,
    IReadOnlyList<LabourReviewItemDto> Review,
    LabourAttendanceDraftDto Attendance,
    string View,            // "owner" | "crew" | "own"  (Task 2)
    LabourHomeDto Home);    // Task 8

public sealed record LabourLedgerDto(
    string WeekLabel,
    IReadOnlyList<string> Days,                       // ISO dates, EVERY day of a bounded window
    IReadOnlyList<LabourLedgerRowDto> Rows,
    IReadOnlyList<LabourLedgerCrewRowDto> CrewRows);

public sealed record LabourLedgerRowDto(
    string PersonId,                                  // "op:{32-hex}" — grouping key, still not a bare Guid
    Guid FieldOperatorId,
    string Name,
    string Initial,
    string Tone,
    IReadOnlyList<LabourLedgerCellDto?> Cells);       // null slot = no mark that day (blank, dashed)

public sealed record LabourLedgerCellDto(
    string? Day,          // "full" | "half" | "absent" | null (mark exists but day half unmarked)
    string? Night,        // "worked" | "notworked" | null
    decimal? Hours,       // stated hours (Nत), as stated, never converted
    decimal? ExtraHours,  // stated extra hours (+N), as stated
    bool Ukte,            // person-day work rows point at an engagement with a stated ContractUnit
    string? Work);        // tap-detail work context (engagement Task strings, " · "-joined); the GRID never renders it

public sealed record LabourLedgerCrewRowDto(
    Guid ThroughFieldOperatorId,
    string ThroughName,
    IReadOnlyList<int?> Counts);                      // per-day stated counts, null = unknown (blank)

public sealed record LabourHomeDto(
    decimal? RojandariStated,   // रोजंदारी · नोंदलेली — Σ same-kind stated TotalCost, null = none stated
    decimal? UkteAgreed,        // उक्ते काम · ठरलेली — Σ stated TotalCost on contract engagements, null = none
    int? OnFarmToday,           // आज कामावर N जण — stated headcounts, null = unknown
    int? RojandariToday,
    int? UkteToday);

// GetLabourDataHandler.cs — internal, pinned by direct tests (InternalsVisibleTo already granted)
internal enum LabourRegisterView { OwnerBook, CrewAttendance, OwnRow }
internal static LabourRegisterView ResolveRegisterView(AppRole role);
internal static LabourDataDto ApplyRegisterView(LabourDataDto dto, LabourRegisterView view);
internal static LabourLedgerDto BuildHajeriLedger(
    string weekLabel, LabourTimeWindow window, DateOnly farmLocalToday,
    IReadOnlyList<AttendanceMark> marks, IReadOnlyList<FieldOperator> operators,
    IReadOnlyList<FieldOperatorWorkRow> workRows, IReadOnlyList<LabourAssignment> windowAssignments,
    IReadOnlyDictionary<Guid, DateOnly> logDateByLogId);
```

```ts
// mobile-web features/labour/labour.types.ts
export interface LedgerCell {
    day: 'full' | 'half' | 'absent' | null;
    night: 'worked' | 'notworked' | null;
    hours: number | null;
    extraHours: number | null;
    ukte: boolean;
    work: string | null;
}
export interface LedgerRow {
    personId: string; fieldOperatorId: string; name: string; initial: string; tone: AvatarTone;
    cells: (LedgerCell | null)[];
}
export interface LedgerCrewRow { throughFieldOperatorId: string; throughName: string; counts: (number | null)[]; }
export type LabourView = 'owner' | 'crew' | 'own';
export interface LabourHome {
    rojandariStated: number | null; ukteAgreed: number | null;
    onFarmToday: number | null; rojandariToday: number | null; ukteToday: number | null;
}
// LabourBalance.paid and .advance become `number | null`;
// netBalance(b) returns null when recorded, paid, OR advance is null.
// DOM contract on the rebuilt HajeriLedger (Phase 5 consumes it):
// data-testid="ledger-row" on every person/crew row container;
// data-testid="ledger-cell" on every day cell; data-testid="ledger-day-head",
// "ledger-ukte-dot", "ledger-crew-cell" as in the component.
```

`PresenceStatus` (`labour.types.ts:47`) **stays** as the three farmer-tappable capture facts (its
own doc says why); the LEDGER stops using it — `LedgerRow.cells` moves to `LedgerCell | null`.
That is the "PresenceStatus becomes the rich cell type" instruction discharged without breaking
the capture surfaces that legitimately still tap three facts.

---

### Task 1 (brief Tasks 4.1 + 4.4, backend half): the clean grid contract, and `BuildHajeriLedger` reads marks

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs:204-232`
  (the `LabourLedgerDto` + `LabourLedgerRowDto` records and their doc comments)
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs`
  — `BuildHajeriLedger` (`:809-897` incl. doc comment `:786-808`), its call site (`:713`),
  `MarkValue` (`:899-905` — DELETE, nothing sums marks any more)
- Modify: `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs:151-158` (`[Obsolete]` on `Value`)
- Modify: `src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkTests.cs` (pragma around the
  `Value` pin at `:126`)
- Test (rewrite in place): `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs`

**Interfaces:**
- Consumes: `AttendanceMark.{FarmId, FieldOperatorId, WorkDate, Day, Night, HoursWorked, ExtraHours}`;
  `FieldOperator.{Id, DisplayName}`; `FieldOperatorWorkRow.{FieldOperatorId, LabourAssignmentId,
  WorkDate, FarmId, DisplayNameAtAttach}`; `LabourAssignment.{Id, DailyLogId, ContractUnit, Task,
  WorkerCount, MaleCount, FemaleCount, EngagedThroughFieldOperatorId}`; `LabourTimeWindow`;
  `LabourHeadcount.Resolve`.
- Produces: `LabourLedgerDto` / `LabourLedgerRowDto` / `LabourLedgerCellDto` /
  `LabourLedgerCrewRowDto` and the new `BuildHajeriLedger` signature (exact shapes above) — Tasks
  2, 3, 4, 6, 7 build on them.

- [ ] **Step 1: Rewrite `BuildHajeriLedgerTests.cs` — full replacement, failing**

Every old fact's intent survives; the mapping is written into each test's doc comment. Replace the
entire file body with:

```csharp
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// PHASE 4 (Labour V2 R1) — the हजेरी वही reads ATTENDANCE MARKS, and it is the
/// founder's CLEAN register (master review 2026-09-02, D4): name + day cells
/// only. No money, no totals column, no bottom line, no derived arithmetic.
///
/// The previous suite (8 facts) pinned the derive-from-names interim register.
/// Each fact's INTENT survives here; the mapping is written on each test.
/// </summary>
public sealed class BuildHajeriLedgerTests
{
    private static readonly FarmId Farm = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId Actor = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private static readonly LabourTimeWindow Week = new(Monday, Monday.AddDays(6));

    private static AttendanceMark Mark(
        Guid operatorId, DateOnly date,
        DayMark day = DayMark.Full, NightMark night = NightMark.Unmarked,
        decimal? hours = null, decimal? extraHours = null)
        => AttendanceMark.Create(
            Guid.NewGuid(), Farm, operatorId, date, day, night, Actor, CreatedAtUtc,
            hoursWorked: hours, extraHours: extraHours,
            // Task 2.5's domain guard: hours present => basis MUST be Explicit
            // (hours on a mark are somebody's words); no hours => Unspecified.
            hoursBasis: hours is null && extraHours is null
                ? LabourTimeBasis.Unspecified
                : LabourTimeBasis.Explicit);

    private static FieldOperator Operator(Guid id, string name)
        => FieldOperator.Create(id, name, fullName: null, Farm, Actor, CreatedAtUtc);

    private static LabourAssignment Assignment(
        Guid id, Guid logId, ContractUnit? contractUnit = null, string? task = null,
        int? workerCount = null, Guid? engagedThrough = null)
        => LabourAssignment.Create(
            id: id,
            dailyLogId: logId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: workerCount,
            wagePerPerson: null,
            contractUnit: contractUnit,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed(),
            shift: null,
            task: task,
            workerNames: [],
            engagedThroughFieldOperatorId: engagedThrough);

    private static FieldOperatorWorkRow WorkRow(Guid operatorId, Guid assignmentId, DateOnly date, string name)
        => FieldOperatorWorkRow.Create(
            Guid.NewGuid(), operatorId, assignmentId, Farm, date, name, Actor, CreatedAtUtc);

    private static LabourLedgerDto Build(
        IReadOnlyList<AttendanceMark> marks,
        IReadOnlyList<FieldOperator> operators,
        IReadOnlyList<FieldOperatorWorkRow>? workRows = null,
        IReadOnlyList<LabourAssignment>? assignments = null,
        IReadOnlyDictionary<Guid, DateOnly>? logDates = null,
        LabourTimeWindow? window = null)
        => GetLabourDataHandler.BuildHajeriLedger(
            weekLabel: "",
            window: window ?? Week,
            farmLocalToday: Monday.AddDays(3),
            marks: marks,
            operators: operators,
            workRows: workRows ?? [],
            windowAssignments: assignments ?? [],
            logDateByLogId: logDates ?? new Dictionary<Guid, DateOnly>());

    /// <summary>
    /// THE RULE THIS SCREEN EXISTS FOR (was: AnUnnamedDayIsNullNotAbsent).
    /// A day nobody ruled on is a null cell — silence, never absence (rule 4).
    /// </summary>
    [Fact]
    public void AnUnmarkedDayIsANullCellNotAbsent()
    {
        var ganesh = Guid.NewGuid();
        var ledger = Build([Mark(ganesh, Monday)], [Operator(ganesh, "गणेश")]);

        var row = Assert.Single(ledger.Rows);
        Assert.Equal(7, row.Cells.Count);          // the whole bounded window is drawn
        Assert.Equal("full", row.Cells[0]!.Day);
        Assert.Null(row.Cells[1]);                 // Tuesday: no mark → no cell → blank
        Assert.DoesNotContain(row.Cells, c => c is { Day: "absent" });
    }

    /// <summary>
    /// (was: NobodyNamedYieldsAnEmptyRegisterNotAZeroedOne — INVERTED by
    /// founder correction 5.) Zero marks, zero people: the register still
    /// renders its seven day columns. A register with nothing written in it is
    /// still a register; it must never vanish because capture has not happened.
    /// </summary>
    [Fact]
    public void ZeroMarksStillRenderTheWholeWeek()
    {
        var ledger = Build([], []);

        Assert.Equal(7, ledger.Days.Count);
        Assert.Equal("2026-08-24", ledger.Days[0]);
        Assert.Equal("2026-08-30", ledger.Days[6]);
        Assert.Empty(ledger.Rows);
        Assert.Empty(ledger.CrewRows);
    }

    /// <summary>
    /// (was: AHalfShiftIsPointFive.) A half comes ONLY from DayMark.Half.
    /// An engagement's Shift changes no cell — a crew's shift silently becoming
    /// every person's attendance was the shipped defect at :825-830.
    /// </summary>
    [Fact]
    public void AHalfComesOnlyFromTheMarkNeverFromEngagementShift()
    {
        var ganesh = Guid.NewGuid();
        var logId = Guid.NewGuid();
        var assignment = LabourAssignment.Create(
            id: Guid.NewGuid(), dailyLogId: logId, engagementType: LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: 4, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: CreatedAtUtc, time: LabourTime.ServerAssumed(),
            shift: LabourShift.Half, task: null, workerNames: ["गणेश"]);

        var ledger = Build(
            [Mark(ganesh, Monday, DayMark.Full)],
            [Operator(ganesh, "गणेश")],
            assignments: [assignment],
            logDates: new Dictionary<Guid, DateOnly> { [logId] = Monday });

        Assert.Equal("full", Assert.Single(ledger.Rows).Cells[0]!.Day);

        var halfMarked = Build([Mark(ganesh, Monday, DayMark.Half)], [Operator(ganesh, "गणेश")]);
        Assert.Equal("half", Assert.Single(halfMarked.Rows).Cells[0]!.Day);
    }

    /// <summary>
    /// C3 killed: a NIGHT is a night, never a full-day tick, and Full+Night is
    /// TWO preserved facts — never a summed number. The grid contract carries
    /// no numeric aggregate anywhere for them to be summed into.
    /// </summary>
    [Fact]
    public void NightIsANightNeverAFullDayAndNeverASum()
    {
        var ganesh = Guid.NewGuid();
        var nightOnly = Build(
            [Mark(ganesh, Monday, DayMark.Unmarked, NightMark.Worked)],
            [Operator(ganesh, "गणेश")]);
        var cell = Assert.Single(nightOnly.Rows).Cells[0]!;
        Assert.Null(cell.Day);                    // no day-half claim was made
        Assert.Equal("worked", cell.Night);

        var both = Build(
            [Mark(ganesh, Monday, DayMark.Full, NightMark.Worked)],
            [Operator(ganesh, "गणेश")]);
        var bothCell = Assert.Single(both.Rows).Cells[0]!;
        Assert.Equal("full", bothCell.Day);
        Assert.Equal("worked", bothCell.Night);   // two marks, preserved separately
    }

    /// <summary>Stated hours and extra hours survive to the cell as stated — never converted.</summary>
    [Fact]
    public void StatedHoursSurviveUnconverted()
    {
        var ganesh = Guid.NewGuid();
        var ledger = Build(
            [Mark(ganesh, Monday, DayMark.Unmarked, NightMark.Worked, hours: 3m, extraHours: 2m)],
            [Operator(ganesh, "गणेश")]);

        var cell = Assert.Single(ledger.Rows).Cells[0]!;
        Assert.Equal(3m, cell.Hours);
        Assert.Equal(2m, cell.ExtraHours);
        Assert.Null(cell.Day);                    // hours did NOT become a day fraction
    }

    /// <summary>
    /// (Master review D4, item 3.) The उक्ते dot appears exactly on cells whose
    /// person-day work rows point at an engagement with a STATED ContractUnit.
    /// </summary>
    [Fact]
    public void UkteDotComesFromTheEngagementsContractUnit()
    {
        var ganesh = Guid.NewGuid();
        var logId = Guid.NewGuid();
        var contractWork = Assignment(Guid.NewGuid(), logId, contractUnit: ContractUnit.Acre, task: "द्राक्ष छाटणी");
        var logDates = new Dictionary<Guid, DateOnly> { [logId] = Monday };

        var ledger = Build(
            [Mark(ganesh, Monday), Mark(ganesh, Monday.AddDays(1))],
            [Operator(ganesh, "गणेश")],
            workRows: [WorkRow(ganesh, contractWork.Id, Monday, "गणेश")],
            assignments: [contractWork],
            logDates: logDates);

        var row = Assert.Single(ledger.Rows);
        Assert.True(row.Cells[0]!.Ukte);
        Assert.Equal("द्राक्ष छाटणी", row.Cells[0]!.Work);
        Assert.False(row.Cells[1]!.Ukte);         // Tuesday's mark has no contract context
    }

    /// <summary>
    /// (Master review D4, item 3 + final direction §3.) A crew engaged through a
    /// Labour Mukadam is its own aggregate row: per-day STATED counts, blank
    /// when unknown, never folded into the mukadam's own presence row.
    /// </summary>
    [Fact]
    public void CrewAggregateRowCarriesStatedCountsBlankWhenUnknown()
    {
        var shankar = Guid.NewGuid();
        var mondayLog = Guid.NewGuid();
        var tuesdayLog = Guid.NewGuid();
        var logDates = new Dictionary<Guid, DateOnly>
        {
            [mondayLog] = Monday,
            [tuesdayLog] = Monday.AddDays(1),
        };

        var ledger = Build(
            [Mark(shankar, Monday)],
            [Operator(shankar, "शंकर")],
            assignments:
            [
                Assignment(Guid.NewGuid(), mondayLog, workerCount: 8, engagedThrough: shankar),
                Assignment(Guid.NewGuid(), tuesdayLog, workerCount: null, engagedThrough: shankar),
            ],
            logDates: logDates);

        var crew = Assert.Single(ledger.CrewRows);
        Assert.Equal(shankar, crew.ThroughFieldOperatorId);
        Assert.Equal("शंकर", crew.ThroughName);
        Assert.Equal(8, crew.Counts[0]);
        Assert.Null(crew.Counts[1]);              // count not stated → blank, never 0

        // Shankar's own row is untouched by his crew's numbers.
        var own = Assert.Single(ledger.Rows);
        Assert.Equal("full", own.Cells[0]!.Day);
        Assert.Null(own.Cells[1]);
    }

    /// <summary>
    /// (was: DaysAreDistinctOrderedAndColumnTotalled — totals half DELETED by
    /// master review D4.) Days enumerate the window in order; and a no-work day
    /// (a log with no engagements) still has its column and its marks (rules 6/7:
    /// attendance without work is recordable, and nothing here claims work).
    /// </summary>
    [Fact]
    public void ANoWorkDayStillCarriesItsColumnAndItsMarks()
    {
        var ganesh = Guid.NewGuid();
        var noWorkLog = Guid.NewGuid();
        var ledger = Build(
            [Mark(ganesh, Monday.AddDays(4))],
            [Operator(ganesh, "गणेश")],
            logDates: new Dictionary<Guid, DateOnly> { [noWorkLog] = Monday.AddDays(4) });

        Assert.Equal(
            ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"],
            ledger.Days);
        Assert.Equal("full", Assert.Single(ledger.Rows).Cells[4]!.Day);
        Assert.All(Assert.Single(ledger.Rows).Cells, c => Assert.True(c is null || c.Work is null));
    }

    /// <summary>(was: TheInitialIsAWholeDevanagariLetter — unchanged intent, mark-plane source.)</summary>
    [Fact]
    public void TheInitialIsAWholeDevanagariLetter()
    {
        var id = Guid.NewGuid();
        var ledger = Build([Mark(id, Monday)], [Operator(id, "कांतीलाल घोडगे")]);

        Assert.Equal("कां", Assert.Single(ledger.Rows).Initial);
    }

    /// <summary>
    /// (was: PersonIdIsANameKeyNotAWorkerId.) The row now carries a REAL work
    /// identity (FieldOperatorId) for tap-detail, and PersonId stays a prefixed
    /// grouping key that can never be mistaken for a bare user id.
    /// </summary>
    [Fact]
    public void PersonIdIsPrefixedAndTheRowCarriesTheOperatorId()
    {
        var id = Guid.NewGuid();
        var ledger = Build([Mark(id, Monday)], [Operator(id, "गणेश")]);

        var row = Assert.Single(ledger.Rows);
        Assert.Equal(id, row.FieldOperatorId);
        Assert.StartsWith("op:", row.PersonId);
        Assert.False(Guid.TryParse(row.PersonId, out _));
    }

    /// <summary>
    /// (was: WeekTotalIsTheRegisterSumNotManDays + the PresentOutranksHalf
    /// ranking — both concepts DELETED.) Master review D4: "नाव + दिवसाचे खूण
    /// एवढेच." The grid contract structurally carries NO aggregate member — no
    /// Total, no WeekTotal, no DailyTotals — so no read can sum marks, consume
    /// AttendanceMark.Value, or rank two facts into one. Pinned by reflection so
    /// a future member has to delete this sentence to ship.
    /// </summary>
    [Fact]
    public void TheGridContractCarriesNoAggregateAndNoMoney()
    {
        var rowMembers = typeof(LabourLedgerRowDto).GetProperties().Select(p => p.Name).ToArray();
        Assert.Equal(
            new[] { "PersonId", "FieldOperatorId", "Name", "Initial", "Tone", "Cells" },
            rowMembers);

        var ledgerMembers = typeof(LabourLedgerDto).GetProperties().Select(p => p.Name).ToArray();
        Assert.Equal(new[] { "WeekLabel", "Days", "Rows", "CrewRows" }, ledgerMembers);

        var cellMembers = typeof(LabourLedgerCellDto).GetProperties().Select(p => p.Name).ToArray();
        Assert.Equal(new[] { "Day", "Night", "Hours", "ExtraHours", "Ukte", "Work" }, cellMembers);
    }

    /// <summary>
    /// Correction 5, precisely: the ledger build takes no anchor, no headcount
    /// and no permission-to-capture as input. Pinned on the signature itself.
    /// </summary>
    [Fact]
    public void TheLedgerBuildTakesNoCaptureStateInput()
    {
        var build = typeof(GetLabourDataHandler).GetMethod(
            "BuildHajeriLedger",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(build);
        var parameterNames = build!.GetParameters().Select(p => p.Name).ToArray();
        Assert.Equal(
            new[] { "weekLabel", "window", "farmLocalToday", "marks", "operators", "workRows", "windowAssignments", "logDateByLogId" },
            parameterNames);
    }
}
```

Notes for the implementer, verified against the tree 2026-09-02:
- `ContractUnit` is an enum in `ShramSafal.Domain.Farms` (used by `LabourAssignment.ContractUnit`,
  `LabourAssignment.cs:65`). If `ContractUnit.Acre` is not a member, open the enum and use its
  first real member — the test needs *a stated unit*, not a particular one.
- `FieldOperatorWorkRow.Create` — copy the parameter order from
  `src/apps/ShramSafal/ShramSafal.Domain/Labour/FieldOperatorWorkRow.cs` (fields `:61-80`); if the
  factory's signature differs from the helper above, adjust the helper, not the assertions.
- `Mark(...)` passes `hoursWorked:`/`extraHours:`/`hoursBasis:` as the trailing optional
  parameters Phase 2's Task 2.5 added to `AttendanceMark.Create`. The basis MUST be
  `LabourTimeBasis.Explicit` whenever hours or extra hours are passed — Task 2.5's
  `ValidateHours` throws otherwise (hours on a mark are somebody's words). If Task 2.5 named
  them differently, match ITS names.
- `Assignment(...)` passes `engagedThroughFieldOperatorId:` as Phase 3's trailing optional
  parameter on `LabourAssignment.Create` (`LabourAssignment.cs:136-144` idiom). Same rule.

- [ ] **Step 2: Run and see it fail for the right reason**

```
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~BuildHajeriLedgerTests" 2>&1 | tail -20
```
Expected: **compile errors** — `LabourLedgerCellDto` / `LabourLedgerCrewRowDto` do not exist,
`BuildHajeriLedger` has the old 4-parameter signature. (A test failing to compile against a
contract that does not exist yet IS the failing test for a contract change.)

- [ ] **Step 3: Replace the ledger records in `LabourDataDto.cs`**

Delete the existing `LabourLedgerDto` (`:204-209` region) and `LabourLedgerRowDto` (`:211-232`
region) **including** their Task-5/Task-6 doc comments (they document members that no longer
exist), and put in their place:

```csharp
/// <summary>
/// The CLEAN register (founder master review 2026-09-02, D4): "नावाखाली कोणताही
/// summary, कामाचा मजकूर किंवा पैशांची कळ नाही. नाव + दिवसाचे खूण एवढेच."
///
/// <para>No money member, no totals member — not days, not people, not rupees.
/// The old <c>Total</c>/<c>WeekTotal</c>/<c>DailyTotals</c> left this contract
/// deliberately; day-count reads live in DETAIL views (tap a cell), and the
/// dimensional week (5 पूर्ण · 1 अर्धा · 2 रात्री…) is composed there — never
/// one number (final direction §2). Reinstating an aggregate here requires
/// deleting <c>BuildHajeriLedgerTests.TheGridContractCarriesNoAggregateAndNoMoney</c>,
/// which is the point of that test.</para>
///
/// <para><c>Days</c> is EVERY date of a bounded window, in order — the page is
/// always drawn (correction 5); a register with nothing written in it is still
/// a register. Cells are per-day slots; a <c>null</c> slot is "कुणी माहिती
/// नाही" — silence, never absence.</para>
/// </summary>
public sealed record LabourLedgerDto(
    string WeekLabel,
    IReadOnlyList<string> Days,
    IReadOnlyList<LabourLedgerRowDto> Rows,
    IReadOnlyList<LabourLedgerCrewRowDto> CrewRows);

/// <summary>
/// One person's register row. <c>FieldOperatorId</c> is the durable work
/// identity (tap-detail addresses a person-day by it); <c>PersonId</c> stays a
/// prefixed grouping key ("op:{32-hex}") so no client ever mistakes it for a
/// bare user id — the same defence the old "name:" prefix carried.
/// </summary>
public sealed record LabourLedgerRowDto(
    string PersonId,
    Guid FieldOperatorId,
    string Name,
    string Initial,
    string Tone,
    IReadOnlyList<LabourLedgerCellDto?> Cells);

/// <summary>
/// One person-day cell — the five approved axes (D-H3 + master review D4):
/// day half, night half, stated hours (Nत), stated extra hours (+N), and the
/// उक्ते engagement marker. All STATED facts. <c>Day</c>/<c>Night</c> are the
/// wire forms of <see cref="ShramSafal.Domain.Labour.DayMark"/> /
/// <see cref="ShramSafal.Domain.Labour.NightMark"/> with Unmarked as null —
/// two preserved facts, never a summed number, and no reader may consume
/// <c>AttendanceMark.Value</c> to merge them (it is [Obsolete] for exactly
/// that reason). <c>Work</c> exists for TAP-DETAIL only; the grid never
/// renders it (D4: no कामाचा मजकूर under the name).
/// </summary>
public sealed record LabourLedgerCellDto(
    string? Day,
    string? Night,
    decimal? Hours,
    decimal? ExtraHours,
    bool Ukte,
    string? Work);

/// <summary>
/// A crew engaged THROUGH a Labour Mukadam (final direction §3): its own
/// aggregate row, never folded into his personal presence row. <c>Counts</c>
/// are per-day STATED headcounts (LabourHeadcount.Resolve over that day's
/// engaged-through engagements — known figures sum, an unstated one poisons
/// nothing, all-unknown is null/blank). Display of what was recorded; no
/// remainder subtraction, no reconciliation against work rows (D9.12).
/// </summary>
public sealed record LabourLedgerCrewRowDto(
    Guid ThroughFieldOperatorId,
    string ThroughName,
    IReadOnlyList<int?> Counts);
```

- [ ] **Step 4: Mark `AttendanceMark.Value` obsolete (the DataEngineer resolution REVISION-1 adopted)**

In `AttendanceMark.cs`, directly above `public decimal Value =>` (`:157` today), add:

```csharp
    [Obsolete("Night arithmetic is NOT decided (founder final direction 2026-09-01; " +
        "master review 2026-09-02 keeps the register clean). No R1 read path may consume " +
        "Value — display Day and Night as two preserved facts. This member also turns " +
        "Unmarked into 0, contradicting its own remarks (Phase 0 C12).")]
```

In `AttendanceMarkTests.cs`, wrap the existing `Value` pin (the fact containing `:126`'s
`Assert` on `Value`) with `#pragma warning disable CS0618` / `#pragma warning restore CS0618`
immediately inside the fact's braces. Do not delete the pin — it documents the shipped
interpretation the founder has not yet ruled on.

- [ ] **Step 5: Rewrite `BuildHajeriLedger` and its call site**

Replace the whole method (`GetLabourDataHandler.cs:786-905`, doc comment through `MarkValue`)
with:

```csharp
    /// <summary>
    /// STAGE 5, superseded — the हजेरी वही now reads ATTENDANCE MARKS (Phase 4,
    /// Labour V2 R1), not names on engagements. A cell is a RULING somebody
    /// made about a person on a farm-day; a person merely NAMED on a work
    /// engagement has said nothing about attendance and gets no cell (being
    /// named is not being marked — the same line BuildAttendanceDraft draws).
    ///
    /// <para><b>The page is always drawn</b> (correction 5): a bounded window
    /// enumerates every one of its days; an unbounded (आजपर्यंत) window shows
    /// every date that carries any fact, and when nothing does, the current
    /// farm-local week — day columns with every cell blank. The build takes no
    /// anchor, no headcount and no permission-to-capture as input, and that is
    /// pinned on its signature by BuildHajeriLedgerTests.</para>
    ///
    /// <para><b>What engagements still contribute</b> — exactly two stated
    /// facts, joined via work rows, never presence: the उक्ते dot (a person-day
    /// work row points at an engagement whose ContractUnit is stated) and the
    /// crew aggregate rows (engagements engaged-through a Labour Mukadam,
    /// per-day stated counts). Nothing here sums a mark, multiplies anything,
    /// or reads AttendanceMark.Value (which is [Obsolete]).</para>
    /// </summary>
    internal static LabourLedgerDto BuildHajeriLedger(
        string weekLabel,
        LabourTimeWindow window,
        DateOnly farmLocalToday,
        IReadOnlyList<AttendanceMark> marks,
        IReadOnlyList<FieldOperator> operators,
        IReadOnlyList<FieldOperatorWorkRow> workRows,
        IReadOnlyList<LabourAssignment> windowAssignments,
        IReadOnlyDictionary<Guid, DateOnly> logDateByLogId)
    {
        // ── 1. Day columns. Bounded window → every day of it, drawn whether or
        //       not anything happened. Unbounded → every date carrying a fact;
        //       none at all → the current farm-local week, blank. ─────────────
        List<DateOnly> days;
        if (window.FromDate is { } from && window.ToDateInclusive is { } to)
        {
            days = [];
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                days.Add(d);
            }
        }
        else
        {
            days = marks.Select(m => m.WorkDate)
                .Concat(logDateByLogId.Values)
                .Distinct()
                .OrderBy(d => d)
                .ToList();
            if (days.Count == 0)
            {
                // Monday-anchored, same arithmetic as LabourTimeWindow.StartOfWeek.
                var monday = farmLocalToday.AddDays(-(((int)farmLocalToday.DayOfWeek + 6) % 7));
                days = Enumerable.Range(0, 7).Select(offset => monday.AddDays(offset)).ToList();
            }
        }

        var dayIndex = days
            .Select((date, index) => (date, index))
            .ToDictionary(pair => pair.date, pair => pair.index);

        var nameByOperatorId = operators.ToDictionary(o => o.Id, o => o.DisplayName);
        var assignmentById = windowAssignments.ToDictionary(a => a.Id);
        var workRowsByPersonDay = workRows
            .Where(r => dayIndex.ContainsKey(r.WorkDate))
            .GroupBy(r => (r.FieldOperatorId, r.WorkDate))
            .ToDictionary(g => g.Key, g => g.ToList());

        // ── 2. One row per marked person; one cell per mark. ────────────────
        var cellsByOperator = new Dictionary<Guid, LabourLedgerCellDto?[]>();
        foreach (var mark in marks)
        {
            if (!dayIndex.TryGetValue(mark.WorkDate, out var index))
            {
                continue; // a mark outside the drawn days (unbounded edge) has no column
            }

            if (!cellsByOperator.TryGetValue(mark.FieldOperatorId, out var cells))
            {
                cells = new LabourLedgerCellDto?[days.Count];
                cellsByOperator[mark.FieldOperatorId] = cells;
            }

            var contextRows = workRowsByPersonDay.TryGetValue(
                (mark.FieldOperatorId, mark.WorkDate), out var personDayRows)
                ? personDayRows
                : new List<FieldOperatorWorkRow>();
            var contextAssignments = contextRows
                .Select(r => assignmentById.GetValueOrDefault(r.LabourAssignmentId))
                .Where(a => a is not null)
                .Select(a => a!)
                .ToList();
            var tasks = contextAssignments
                .Select(a => a.Task)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!.Trim())
                .Distinct()
                .ToList();

            cells[index] = new LabourLedgerCellDto(
                Day: mark.Day switch
                {
                    DayMark.Full => "full",
                    DayMark.Half => "half",
                    DayMark.Absent => "absent",
                    _ => null, // Unmarked: the day half was never ruled on
                },
                Night: mark.Night switch
                {
                    NightMark.Worked => "worked",
                    NightMark.NotWorked => "notworked",
                    _ => null,
                },
                Hours: mark.HoursWorked,        // as stated — never converted to day fractions
                ExtraHours: mark.ExtraHours,    // as stated
                Ukte: contextAssignments.Any(a => a.ContractUnit is not null),
                Work: tasks.Count == 0 ? null : string.Join(SeparatorMiddot, tasks));
        }

        var rows = cellsByOperator
            .Select(pair =>
            {
                // The operator row should always resolve (marks are written against
                // this farm's operators); the attach-time snapshot is the honest
                // fallback for a rename/erasure race — never an invented name.
                var name = nameByOperatorId.TryGetValue(pair.Key, out var displayName)
                    ? displayName
                    : workRows.FirstOrDefault(r => r.FieldOperatorId == pair.Key)?.DisplayNameAtAttach ?? string.Empty;
                return new LabourLedgerRowDto(
                    PersonId: $"op:{pair.Key:N}",
                    FieldOperatorId: pair.Key,
                    Name: name,
                    Initial: FirstLetterOf(name),
                    Tone: ToneFor(name),
                    Cells: pair.Value);
            })
            .OrderBy(row => row.Name, StringComparer.Ordinal)
            .ToList();

        // ── 3. Crew aggregate rows — engagements engaged THROUGH a Labour
        //       Mukadam (final direction §3). Stated counts only: known figures
        //       sum, an unstated engagement poisons nothing, all-unknown is
        //       null → the client draws a blank violet cell, never a 0. ───────
        var crewRows = windowAssignments
            .Where(a => a.EngagedThroughFieldOperatorId is not null
                && logDateByLogId.TryGetValue(a.DailyLogId, out var d)
                && dayIndex.ContainsKey(d))
            .GroupBy(a => a.EngagedThroughFieldOperatorId!.Value)
            .Select(group =>
            {
                var counts = new int?[days.Count];
                foreach (var byDay in group.GroupBy(a => logDateByLogId[a.DailyLogId]))
                {
                    var stated = byDay
                        .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
                        .Where(h => h is not null)
                        .Select(h => h!.Value)
                        .ToList();
                    counts[dayIndex[byDay.Key]] = stated.Count == 0 ? null : stated.Sum();
                }

                var throughName = nameByOperatorId.GetValueOrDefault(group.Key, string.Empty);
                return new LabourLedgerCrewRowDto(group.Key, throughName, counts);
            })
            .OrderBy(crew => crew.ThroughName, StringComparer.Ordinal)
            .ToList();

        return new LabourLedgerDto(
            WeekLabel: weekLabel,
            Days: days.Select(date => date.ToString("yyyy-MM-dd")).ToList(),
            Rows: rows,
            CrewRows: crewRows);
    }
```

Keep `FirstLetterOf` and `ToneFor` exactly as they are. Delete `MarkValue` (`:899-905`) — with no
aggregate in the contract it has no caller, and a helper that sums marks must not survive to be
found.

Add to the handler's usings if missing: `using ShramSafal.Domain.Labour;` (for `AttendanceMark`,
`DayMark`, `NightMark`, `FieldOperator`, `FieldOperatorWorkRow`).

- [ ] **Step 6: Rewire the call site**

Replace `GetLabourDataHandler.cs:705-714` (the STAGE 5 comment + `var ledger = BuildHajeriLedger(
weekLabel, windowLogs, windowAssignments, manDays);`) with:

```csharp
        // STAGE 5, superseded (Phase 4) — the हजेरी वही reads attendance MARKS.
        // Engagements contribute exactly two stated facts (उक्ते dot, crew
        // counts) via the work-row join; names on engagements are no longer
        // presence. All three reads are windowed; the work-row read is NOT
        // farm-scoped by itself (PERMISSIVE user policy — see the port's own
        // remarks), so the E4 both-sides filter is applied here.
        var attendanceMarks = await repository.GetAttendanceMarksForFarmInWindowAsync(
            query.FarmId, window.FromDate, window.ToDateInclusive, ct);
        var farmOperators = await repository.GetFieldOperatorsForFarmAsync(query.FarmId, ct);
        var windowLogDateById = windowLogs.ToDictionary(l => l.Id, l => l.LogDate);
        var windowWorkRows = (await repository.GetFieldOperatorWorkRowsForAssignmentsAsync(
                windowAssignments.Select(a => a.Id).ToList(), ct))
            .Where(r => r.FarmId == query.FarmId)
            .ToList();
        var ledger = BuildHajeriLedger(
            weekLabel, window, farmLocalToday, attendanceMarks, farmOperators,
            windowWorkRows, windowAssignments, windowLogDateById);
```

(`windowLogs`, `windowAssignments`, `window`, `farmLocalToday`, `weekLabel` are all already in
scope at this point — verified in file.)

- [ ] **Step 7: Run the rewritten suite and the whole Domain.Tests project**

```
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~BuildHajeriLedgerTests"
dotnet test src/tests/ShramSafal.Domain.Tests/
```
Expected: BuildHajeriLedgerTests all PASS. If other Domain tests reference the deleted
`Total`/`WeekTotal`/`DailyTotals` members (compiler will name them), rewrite those assertions to
the new contract in the same spirit — never delete a test whose intent still holds.

- [ ] **Step 8: Architecture tests still green**

```
dotnet test src/tests/AgriSync.ArchitectureTests/
```
Expected: PASS (this task adds no new construction sites; `LabourAnchorRules` PIN 1 counts
`LabourAssignment.Create(` call sites in production code only — the new test-helper call sites
live in the test tree, which `ProductionSourceFiles()` excludes).

- [ ] **Step 9: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs \
        src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs \
        src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs \
        src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs \
        src/tests/ShramSafal.Domain.Tests/Labour/AttendanceMarkTests.cs
git commit -m "feat(labour): clean हजेरी register reads marks — totals and money leave the grid contract"
```

---

### Task 2 (D-H8 half of brief Task 4.1): three views on the labour read

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs`
  (`LabourDataDto` gains `View`; `LabourPersonDto.Paid`/`.Advance` and
  `LabourDashboardDto.Wages`/`.Advances`/`.Money` become nullable)
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs`
  (view resolution + `ApplyRegisterView`, applied at the single `Result.Success` site `:737`)
- Test (create): `src/tests/ShramSafal.Domain.Tests/Labour/LabourRegisterViewTests.cs`

**Interfaces:**
- Consumes: `AppRole` (`AgriSync.SharedKernel/Contracts/Roles/AppRole.cs`), `resolvedCallerRole`
  (already resolved at `GetLabourDataHandler.cs:174-178` from `GetUserRoleForFarmAsync` — the
  exact boundary Phase 0 UNKNOWN 5 documented; nothing else authorises, nothing here redesigns
  farm privacy).
- Produces: `LabourRegisterView`, `ResolveRegisterView(AppRole)`,
  `ApplyRegisterView(LabourDataDto, LabourRegisterView)`, `LabourDataDto.View` — consumed by the
  client (Task 3/8) and extended by Task 8.

**The decision this task implements, stated once so nobody re-litigates it in code review:**
D-H8's table gives the owner the whole book, the मुकादम crew attendance with money "ONLY
per-confirmation (D-H9), never as a roster", and the worker his own row. Two facts bound the R1
implementation, both verified: (1) the register grid is now CLEAN, and D-H8's own opening line —
"An attendance register is safe to show anyone on the farm. A wage book is not." — makes the
attendance grid shareable; the danger D-H8 names is MONEY reaching a non-owner as a roster.
(2) No account↔`FieldOperator` link exists anywhere in the domain (`FieldOperator.cs` carries no
user member; `WorkerProfile` links a `UserId` to nothing operator-shaped), so "his crew" / "his
own row" cannot be resolved to a caller in R1. Therefore: the VIEW RESOLUTION ships in the read
path now (D-H8: "in the read path from the first migration, not added later") — owner-tier gets
everything; मुकादम gets the attendance register and ZERO money members (D-H9's per-confirmation
disclosure is a Phase-5+ confirmation feature, and until it exists a मुकादम sees no money at
all); every other non-owner role gets attendance-empty rows (`Rows`/`CrewRows` = `[]` — the app
cannot yet say which row is "his", and showing him everyone's would foreclose D-H8's worker view)
plus zero money. When the identity link lands, OwnRow narrows to real rows as a data-only change;
the contract (`View`) is already on the wire. Suspended/pending membership reading at all is the
PRE-EXISTING repo-wide boundary — reported by Phase 0, explicitly not redesigned here.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/ShramSafal.Domain.Tests/Labour/LabourRegisterViewTests.cs`:

```csharp
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// D-H8, R1 read-path scope: ONE REGISTER, THREE VIEWS. "An attendance
/// register is safe to show anyone on the farm. A wage book is not." The
/// projection below is what stops stated money reaching a non-owner as a
/// roster; the ATTENDANCE grid stays shareable. It resolves on the exact
/// boundary Phase 0 documented (the caller's membership role) and redesigns
/// no farm privacy.
/// </summary>
public sealed class LabourRegisterViewTests
{
    private static LabourDataDto FullDto() => new(
        TopLevelIds: ["p1"],
        People:
        [
            new LabourPersonDto(
                Id: "p1", Name: "गणेश", Initial: "ग", Tone: "or", Role: "worker",
                Verified: true, Temporary: false, TaskScope: null, AppointedById: null,
                RecordedWages: 4200m, Paid: 2000m, Advance: 500m,
                TodayStatus: null, DaysThisWeek: null, MemberIds: null, Trust: null,
                Access: "review", DaysActive: 10, CleanRecord: null),
        ],
        Dashboard: new LabourDashboardDto(
            WeekLabel: "", WindowFrom: "", WindowTo: "", Insight: "",
            ManDays: 3m, ManDaysTrend: 0, Wages: 1200m, Advances: 0m, Owed: 2200m,
            Logs: 2, Pending: 1, Plots: [],
            Money: new LabourMoneyDto(4200m, 2000m, 0m, 2200m)),
        Ledger: new LabourLedgerDto(
            WeekLabel: "",
            Days: ["2026-08-24"],
            Rows:
            [
                new LabourLedgerRowDto("op:x", Guid.NewGuid(), "गणेश", "ग", "or",
                    [new LabourLedgerCellDto("full", null, null, null, false, null)]),
            ],
            CrewRows: []),
        Review:
        [
            new LabourReviewItemDto(
                "r1", "गणेश", "ग", "or", "आज", "Draft",
                new LabourPointsDto(4, null, null, 850m, []),
                Plot: null, PlotScope: "Farm"),
        ],
        Attendance: new LabourAttendanceDraftDto("", null, [], ""),
        View: "owner");

    [Fact]
    public void RolesResolveToTheThreeViews()
    {
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.PrimaryOwner));
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.SecondaryOwner));
        Assert.Equal(LabourRegisterView.CrewAttendance, GetLabourDataHandler.ResolveRegisterView(AppRole.Mukadam));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Worker));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Agronomist));
    }

    /// <summary>The owner's book is untouched — his record, every rupee.</summary>
    [Fact]
    public void OwnerBookPassesThroughWhole()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnerBook);

        Assert.Equal("owner", dto.View);
        Assert.Equal(2000m, dto.People[0].Paid);
        Assert.NotNull(dto.Dashboard.Money);
        Assert.Equal(850m, dto.Review[0].Points.Amount);
        Assert.Single(dto.Ledger.Rows);
    }

    /// <summary>
    /// D-H8 + the Task 4.1 constraint verbatim: a मुकादम reading the register
    /// receives his crew's attendance and NO other worker's money. Money is
    /// ABSENT (null), never a fabricated ₹0 — blank is not zero.
    /// </summary>
    [Fact]
    public void CrewAttendanceViewCarriesAttendanceAndZeroMoneyMembers()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.CrewAttendance);

        Assert.Equal("crew", dto.View);
        Assert.Single(dto.Ledger.Rows);                       // attendance stays
        Assert.Null(dto.People[0].RecordedWages);             // the money roster does not
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.People[0].Advance);
        Assert.Null(dto.Dashboard.Wages);
        Assert.Null(dto.Dashboard.Advances);
        Assert.Null(dto.Dashboard.Owed);
        Assert.Null(dto.Dashboard.Money);
        Assert.Null(dto.Review[0].Points.Amount);
    }

    /// <summary>
    /// The worker view: no identity link exists yet (FieldOperator carries no
    /// user id), so "his own row" is honestly EMPTY rows — never everyone's
    /// rows, and never any money. The view discriminator is on the wire so the
    /// narrowing lands later as data, not as a contract change.
    /// </summary>
    [Fact]
    public void OwnRowViewCarriesNoOtherRowsAndNoMoney()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnRow);

        Assert.Equal("own", dto.View);
        Assert.Empty(dto.Ledger.Rows);
        Assert.Empty(dto.Ledger.CrewRows);
        Assert.Single(dto.Ledger.Days);                       // the page itself is still drawn
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.Dashboard.Money);
    }
}
```

- [ ] **Step 2: Run and see it fail**

```
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourRegisterViewTests" 2>&1 | tail -15
```
Expected: compile errors — `View` is not a member of `LabourDataDto`, `ResolveRegisterView` /
`ApplyRegisterView` / `LabourRegisterView` do not exist, `Paid:`/`Wages:` reject nulls.

- [ ] **Step 3: Make the DTO members nullable and add `View`**

In `LabourDataDto.cs`:

1. `LabourDataDto` — append the discriminator as the LAST positional parameter (existing
   construction stays positional-compatible until the call site is updated in Step 4):
   `LabourAttendanceDraftDto Attendance` → `LabourAttendanceDraftDto Attendance,\n    string View`
   with this comment above `View`:
   ```csharp
    // D-H8 (ONE REGISTER, THREE VIEWS) — which projection this response IS:
    // "owner" (whole book) | "crew" (attendance, no money roster) | "own"
    // (own row only; empty until an account↔FieldOperator link exists).
    // Resolved server-side from the caller's membership role; the client
    // renders what arrives and adds nothing back.
   ```
2. `LabourPersonDto` — `decimal Paid,` → `decimal? Paid,` and `decimal Advance,` →
   `decimal? Advance,`, appending to the existing money comment block:
   ```csharp
    // Phase 4 (D-H8) — Paid and Advance are `decimal?`: null means WITHHELD BY
    // VIEW (a non-owner caller gets no money roster), distinct from the 0m a
    // real empty payout history produces for an owner. Never coalesce to 0.
   ```
3. `LabourDashboardDto` — `decimal Wages,` → `decimal? Wages,`, `decimal Advances,` →
   `decimal? Advances,`, `LabourMoneyDto Money` → `LabourMoneyDto? Money`, with one comment:
   ```csharp
    // Phase 4 (D-H8) — nullable: null = withheld by view (non-owner caller).
    // An owner's real figures are never null here.
   ```

- [ ] **Step 4: Implement the resolution and projection in `GetLabourDataHandler`**

Add inside the class (beside `BuildHajeriLedger`):

```csharp
    /// <summary>
    /// D-H8: which of the three register views this caller gets. Resolved on
    /// the SAME role the handler already authorises with (:174-178) — the
    /// boundary Phase 0 documented. Owner tier = the whole book; Mukadam =
    /// attendance without a money roster (D-H9's per-confirmation disclosure
    /// is a later confirmation feature — until it exists he sees no money at
    /// all); everything else = own-row (empty until an account↔FieldOperator
    /// link exists — FieldOperator carries no user member, verified).
    /// </summary>
    internal static LabourRegisterView ResolveRegisterView(AppRole role) => role switch
    {
        AppRole.PrimaryOwner or AppRole.SecondaryOwner => LabourRegisterView.OwnerBook,
        AppRole.Mukadam => LabourRegisterView.CrewAttendance,
        _ => LabourRegisterView.OwnRow,
    };

    /// <summary>
    /// Projects one built response into the caller's view. Money members go
    /// ABSENT (null) for non-owner views — blank is not zero, and a withheld
    /// figure must be indistinguishable from "nothing stated" to its reader
    /// rather than fabricated as ₹0. Attendance stays: "An attendance register
    /// is safe to show anyone on the farm. A wage book is not." (D-H8.)
    /// </summary>
    internal static LabourDataDto ApplyRegisterView(LabourDataDto dto, LabourRegisterView view)
    {
        if (view == LabourRegisterView.OwnerBook)
        {
            return dto with { View = "owner" };
        }

        var people = dto.People
            .Select(p => p with { RecordedWages = null, Paid = null, Advance = null })
            .ToList();
        var dashboard = dto.Dashboard with { Wages = null, Advances = null, Owed = null, Money = null };
        var review = dto.Review
            .Select(r => r with { Points = r.Points with { Amount = null } })
            .ToList();
        var ledger = view == LabourRegisterView.OwnRow
            ? dto.Ledger with { Rows = [], CrewRows = [] }
            : dto.Ledger;

        return dto with
        {
            View = view == LabourRegisterView.CrewAttendance ? "crew" : "own",
            People = people,
            Dashboard = dashboard,
            Review = review,
            Ledger = ledger,
        };
    }
```

Add the enum in the same file, below the handler class:

```csharp
/// <summary>D-H8's three views. Internal — the wire carries the string form on <see cref="LabourDataDto.View"/>.</summary>
internal enum LabourRegisterView
{
    OwnerBook = 0,
    CrewAttendance = 1,
    OwnRow = 2,
}
```

Then change the single success return (`:737`):

```csharp
        var built = new LabourDataDto(
            topLevelIds, people, dashboard, ledger, review, attendance, View: "owner");
        return Result.Success(ApplyRegisterView(built, ResolveRegisterView(resolvedCallerRole)));
```

- [ ] **Step 5: Run the new suite, then everything the nullability touched**

```
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourRegisterViewTests"
dotnet test src/tests/ShramSafal.Domain.Tests/
dotnet build src/AgriSync.sln 2>&1 | tail -5
```
Expected: new suite PASS. `LabourDataDtoShapeTests` still compiles (decimal literals convert to
`decimal?`). Any compile error the solution build names (e.g. a test constructing
`LabourDataDto` positionally without `View`) is fixed by supplying `View: "owner"` — the
compiler is the complete list; do not hunt by grep alone.

- [ ] **Step 6: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs \
        src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs \
        src/tests/ShramSafal.Domain.Tests/Labour/LabourRegisterViewTests.cs
git commit -m "feat(labour): D-H8 three-view resolution — money never reaches a non-owner as a roster"
```

---

### Task 3 (brief Tasks 4.1 + 4.4, frontend half): the split-cell register on the client

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/labour.types.ts` (`LedgerRow` `:110-140`
  region; add `LedgerCell`, `LedgerCrewRow`, `LabourView`; `LabourBalance.paid/.advance`
  nullability; `netBalance` `:279-289`; the `LabourData` interface's `ledger`/`dashboard`
  members; add `view`)
- Modify: `src/clients/mobile-web/src/features/labour/data/labourClient.ts` (wire DTOs
  `:124-147` + `LabourDataDto` `:190-198` + `mapLedgerRow` `:253-266` + `mapDashboard` `:230-252`)
- Modify: `src/clients/mobile-web/src/features/labour/labourMock.ts` (`p` helper `:70`,
  `EMPTY_LABOUR_DATA` `:95-112`, `LABOUR_MOCK.ledger` `:137-149`, people balances)
- Modify: `src/clients/mobile-web/src/features/labour/components/HajeriLedger.tsx` (full rewrite)
- Modify: `src/clients/mobile-web/src/features/labour/components/LabourUiKit.tsx`
  (`MoneyLine` `:103-107` guard, `BalanceCard` tiles `:252-259`)
- Modify: `src/clients/mobile-web/src/features/labour/components/PersonDetail.tsx:176-178`
- Modify: `src/clients/mobile-web/src/features/labour/components/WeeklyDashboard.tsx`
  (`drawsBar` `:121-126`, wages/advances tiles `:189-192`, the पैसे card `:345-385`)
- Test (rewrite in place): `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx`
  → renamed content (same file path — git keeps history) pinning the CLEAN grid
- Test (rewrite assertions only): `src/clients/mobile-web/src/features/labour/__tests__/AttendanceDefaultsBlank.test.tsx`

**Interfaces:**
- Consumes: the wire contract Task 1 + Task 2 produce (`LabourLedgerDto` with `rows[].cells`
  as cell objects + `crewRows`, `view`, nullable money members).
- Produces: `LedgerCell`, `LedgerCrewRow`, `LabourView`, the `cellDayClass`/`cellDayGlyph`
  helpers and `HajeriLedger`'s `onOpenCell` prop consumed by Task 4:
  `onOpenCell?: (row: LedgerRow, dayIndex: number) => void`.

**Approved copy used (harvested list, verbatim — no invention):** existing आला / ½ अर्धा / – नाही
legend stays; new legend items **रिकामं = कुणी माहिती नाही** · **4त = 4 तास** · **+2 जादा** ·
**◾ रात्र**. The footer sentence "शेवटचा आकडा = किती दिवस काम केलं." is DELETED (there is no
trailing column for it to describe). Crew row label: `{name}सोबत` (the founder's own
"⳹ शंकरसोबत 8" pattern; the glyph is replaced by the `Users` icon + word, per the feature's
icon-never-alone rule). Latin digits for counts/hours; day headers stay `formatLedgerDayHead`.

- [ ] **Step 1: Write the failing component test (rewrite `HajeriLedgerTotals.test.tsx` in place)**

The old file's intent — "totals never fabricate" — survives as its strongest form: **there are no
totals at all**. Replace the file's entire contents with:

```tsx
// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedger — Phase 4 (Labour V2 R1, founder master review 2026-09-02 D4):
 * the CLEAN register. This file previously pinned that totals were never
 * int-rounded; the founder then removed totals from the grid entirely, which
 * is that intent's final form: a total that does not exist cannot fabricate.
 * "नावाखाली कोणताही summary, कामाचा मजकूर किंवा पैशांची कळ नाही."
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData, LedgerCell } from '../../labour.types';

afterEach(() => cleanup());

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const withLedger = (ledger: LabourData['ledger']): LabourData => ({ ...LABOUR_MOCK, ledger });

describe('HajeriLedger — the clean register (master review D4)', () => {
    it('renders no ₹ and no trailing column anywhere in the grid', () => {
        const { container } = render(<HajeriLedger data={LABOUR_MOCK} onToast={vi.fn()} />);
        expect(container.textContent).not.toContain('₹');
        expect(container.textContent).not.toContain('एकूण');
        // one header cell per day and nothing after them
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length)
            .toBe(LABOUR_MOCK.ledger.days.length);
        expect(container.querySelector('[data-testid="ledger-row-total"]')).toBeNull();
    });

    it('a NIGHT-only cell renders the night marker and never the full-day tick', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ night: 'worked' })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        const c = container.querySelector('[data-testid="ledger-cell"]')!;
        expect(c.textContent).toContain('◾');
        expect(c.querySelector('svg')).toBeNull();   // the ✓ tick is an svg; a night is not a day
    });

    it('stated hours and extra hours render as stated — Nत and +N — never converted', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ night: 'worked', hours: 3 }), cell({ day: 'full', extraHours: 2 })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        expect(container.textContent).toContain('3त');
        expect(container.textContent).toContain('+2');
        expect(container.textContent).not.toContain('0.375'); // no day-fraction arithmetic, ever
    });

    it('the उक्ते dot renders exactly on cells whose engagement is a contract', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ day: 'full', ukte: true }), cell({ day: 'full' })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        const dots = container.querySelectorAll('[data-testid="ledger-ukte-dot"]');
        expect(dots.length).toBe(1);
    });

    it('a crew row draws stated counts and leaves unknown days blank — never 0', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [],
            crewRows: [{ throughFieldOperatorId: '1', throughName: 'शंकर', counts: [8, null] }],
        })} onToast={vi.fn()} />);

        expect(container.textContent).toContain('शंकरसोबत');
        const cells = container.querySelectorAll('[data-testid="ledger-crew-cell"]');
        expect(cells[0].textContent).toBe('8');
        expect(cells[1].textContent).toBe('');
    });

    it('zero rows still draw the week — the empty card sits BELOW the grid, never instead of it', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '', days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
            rows: [], crewRows: [],
        })} onToast={vi.fn()} />);

> **F1 CORRECTION (4.2 review, binding on this task):** the empty-state CLAIM card below
> ("अजून हजेरी नोंदवली नाही") may render for the OWNER view only. For `data.view !== 'owner'`
> an empty register is empty BY PROJECTION — rows were WITHHELD, not absent — and rendering the
> claim would present withholding as the fact "nothing was recorded" (the exact
> absence-as-fact defect this release removes). Non-owner + empty renders the bare week grid
> (day headers, no rows) and claims nothing. Do NOT invent Marathi for a withheld state — that
> copy, if wanted, is a founder-gate item. PIN IT: a test with `view: 'own'` and empty rows
> asserts the claim card is NOT rendered and the day headers ARE.

        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        expect(container.textContent).toContain('अजून हजेरी नोंदवली नाही');
    });
});
```

- [ ] **Step 2: Run and see it fail**

```
cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx 2>&1 | tail -15
```
Expected: FAIL — type errors (`LedgerCell` not exported, `crewRows` not on the ledger type) and
missing test ids.

- [ ] **Step 3: Retype the contract (`labour.types.ts`, `labourClient.ts`, `labourMock.ts`)**

`labour.types.ts` —
1. Below `PresenceStatus` (`:47`, which STAYS — capture surfaces still tap three facts; add one
   sentence to its comment: "The LEDGER no longer uses this union — a register cell is the
   five-axis `LedgerCell` below (master review D4)."), add:

```ts
/**
 * Phase 4 (master review 2026-09-02, D4) — one register cell, five approved
 * axes, ALL stated facts: day half, night half (◾ रात्र), stated hours (Nत),
 * stated extra hours (+N जादा), and the उक्ते engagement marker. `null` on an
 * axis = nobody said. A `null` CELL (see `LedgerRow.cells`) = no mark at all
 * that day — रिकामं = कुणी माहिती नाही, drawn dashed, never as `–` absence.
 * Nothing here is ever summed, ranked, or converted into a day fraction.
 */
export interface LedgerCell {
    day: 'full' | 'half' | 'absent' | null;
    night: 'worked' | 'notworked' | null;
    hours: number | null;
    extraHours: number | null;
    ukte: boolean;
    /** Tap-detail work context (e.g. 'द्राक्ष छाटणी'). The GRID never renders it. */
    work: string | null;
}

/** A crew engaged through a Labour Mukadam — per-day STATED counts, null = unknown (blank violet cell). */
export interface LedgerCrewRow {
    throughFieldOperatorId: string;
    throughName: string;
    counts: (number | null)[];
}

/** D-H8 — which projection the server sent. The client renders what arrives; it never adds back. */
export type LabourView = 'owner' | 'crew' | 'own';
```

2. Rewrite `LedgerRow` (`:110-140`): members become
   `personId: string; fieldOperatorId: string; name: string; initial: string; tone: AvatarTone;
   cells: (LedgerCell | null)[];` — `total` is DELETED with this replacement comment:
   ```ts
    /**
     * Phase 4 — `total` was DELETED (master review D4: no totals column at
     * all; day-count reads live in tap-detail). `cells` slots stay per-day;
     * a `null` slot is silence, never absence — unchanged rule.
     */
   ```
3. `LabourData`'s `ledger` member type: `{ weekLabel: string; days: string[]; rows: LedgerRow[];
   crewRows: LedgerCrewRow[] }` (drop `dailyTotals`/`weekTotal`); add to `LabourData`:
   `view: LabourView;` (and Task 8 adds `home`).
4. `LabourBalance`: `paid: number | null;` and `advance: number | null;` with one added comment
   line each: `null = withheld by view (D-H8) — never coalesce to 0.`
5. `DashboardData` (the interface `LabourData.dashboard` names): `wages: number | null;`,
   `advances: number | null;`, `money: <its current shape> | null;`.
6. `netBalance` (`:279-289`) becomes:

```ts
export const netBalance = (b: LabourBalance): { owe: boolean; amount: number; isAdvance: boolean } | null => {
    if (b.recorded === null || b.paid === null || b.advance === null) {
        // Unknown OR withheld-by-view (D-H8): a balance struck against an
        // absent term is a fabrication either way. Render nothing.
        return null;
    }
    const net = b.recorded - b.paid - b.advance;
    if (net >= 0) {
        return { owe: true, amount: net, isAdvance: false };
    }
    return { owe: false, amount: -net, isAdvance: b.advance > 0 };
};
```

`labourClient.ts` —
1. `LabourLedgerRowDto` (`:124-137`): `cells: (LedgerCellDto | null)[]`, add
   `fieldOperatorId: string;`, delete `total`. Add above the row DTO:
   ```ts
   export interface LedgerCellDto {
       day: string | null; night: string | null;
       hours: number | null; extraHours: number | null;
       ukte: boolean; work: string | null;
   }
   export interface LabourLedgerCrewRowDto {
       throughFieldOperatorId: string; throughName: string; counts: (number | null)[];
   }
   ```
2. `LabourLedgerDto` (`:138-146`): `{ weekLabel: string; days: string[];
   rows: LabourLedgerRowDto[]; crewRows: LabourLedgerCrewRowDto[] }`.
3. `LabourDashboardDto`: `wages: number | null;`, `advances: number | null;`,
   `money: LabourMoneyDto | null;`. `LabourPersonDto`'s paid/advance mirrors → `number | null`.
4. `LabourDataDto` (`:190-198`): add `view: string;`.
5. `mapLedgerRow` (`:253-266`) becomes:

```ts
const mapLedgerCell = (c: LedgerCellDto | null): LedgerCell | null =>
    c === null
        ? null // no mark that day — silence survives the wire untouched
        : {
            day: (c.day === 'full' || c.day === 'half' || c.day === 'absent') ? c.day : null,
            night: (c.night === 'worked' || c.night === 'notworked') ? c.night : null,
            hours: c.hours,
            extraHours: c.extraHours,
            ukte: c.ukte === true,
            work: c.work,
        };

const mapLedgerRow = (r: LabourLedgerRowDto): LedgerRow => ({
    personId: r.personId,
    fieldOperatorId: r.fieldOperatorId,
    name: r.name,
    initial: r.initial,
    tone: r.tone as LedgerRow['tone'],
    cells: r.cells.map(mapLedgerCell),
});
```

   and the ledger mapping at `:349-355` becomes:

```ts
        ledger: {
            weekLabel: dto.ledger.weekLabel,
            days: dto.ledger.days,
            rows: dto.ledger.rows.map(mapLedgerRow),
            crewRows: (dto.ledger.crewRows ?? []).map((c) => ({
                throughFieldOperatorId: c.throughFieldOperatorId,
                throughName: c.throughName,
                counts: c.counts,
            })),
        },
        view: dto.view === 'crew' || dto.view === 'own' ? dto.view : 'owner',
```

   (`'owner'` fallback is display-alignment only — the SERVER strips; the client never adds back.)
6. `mapDashboard`: pass `wages`/`advances`/`money` through as-is (they are already
   member-by-member; the nullable types now allow null through — verify no `?? 0` appears).

`labourMock.ts` —
1. `const p = (s: 'present' | 'half' | 'absent') => s;` (`:70`) becomes a cell builder:
   ```ts
   const p = (day: 'full' | 'half' | 'absent' | null, over: Partial<LedgerCell> = {}): LedgerCell | null =>
       day === null && Object.keys(over).length === 0
           ? null
           : { day, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over };
   ```
2. `EMPTY_LABOUR_DATA.ledger` (`:108`) → `{ weekLabel: '', days: [], rows: [], crewRows: [] }`;
   its dashboard `wages: 0, advances: 0` stay real zeros ONLY if a comment already justifies
   them — they do not: change to `wages: null, advances: null, money: null` (pre-fetch there is
   no evidence; blank is not zero) and add `view: 'owner' as const,` to both fixtures.
3. `LABOUR_MOCK.ledger` (`:137-149`): rewrite rows with the cell builder — presence values map
   `present→'full'`; keep the same four people and week shape; delete `dailyTotals`/`weekTotal`;
   add `crewRows: [{ throughFieldOperatorId: 'shankar-crew', throughName: 'शंकर', counts: [8, 8, null, 8, null, 4, null] }]`
   and give one रमेश cell `p('full', { night: 'worked' })`, one `p(null, { night: 'worked', hours: 3 })`
   and one `p('full', { ukte: true, work: 'द्राक्ष छाटणी' })` so the preview exercises every
   approved axis (hand-drawn preview data, clearly mock — same rule as the rest of the file).

- [ ] **Step 4: Rewrite `HajeriLedger.tsx` (full replacement)**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedger — the digital हजेरी वही, at the founder's APPROVED CLEAN design
 * (master review 2026-09-02, D4): "नावाखाली कोणताही summary, कामाचा मजकूर किंवा
 * पैशांची कळ नाही. नाव + दिवसाचे खूण एवढेच." Name + day cells ONLY — no money,
 * no totals column, no bottom line. Detail lives on tap (HajeriCellDetail).
 *
 * The cell carries the five approved axes: ✓ पूर्ण · ½ अर्धा · – अनुपस्थित ·
 * ◾ रात्र (split, below the day half) · Nत stated hours · +N stated extra ·
 * violet dot top-right = उक्ते engagement. A null cell is रिकामं = कुणी माहिती
 * नाही — dashed, never the '–' absence glyph. Latin digits for quantities and
 * hours (approved numeral convention); Devanagari stays in date headers.
 *
 * The register is NEVER gated and never vanishes: zero rows still draw every
 * day column, and the empty-state card sits BELOW the grid (approved mockup
 * 06 panel 1e), never in place of it.
 */
import React from 'react';
import { Check, BookText, Users } from 'lucide-react';
import type { LabourData, LedgerCell, LedgerRow } from '../labour.types';
import { Avatar, EmptyState } from './LabourUiKit';
import { isReadableWeekRange } from '../weekLabel';
import { formatLedgerDayHead } from '../marathiDate';

/** Day-half box style. Exported so AttendanceDefaultsBlank.test.tsx can pin the null branch. */
export const cellDayClass = (c: LedgerCell | null) => {
    if (c === null) return 'border border-dashed border-slate-200 bg-white text-slate-200'; // कुणी माहिती नाही
    if (c.day === 'full') return 'bg-emerald-50 text-emerald-700';
    if (c.day === 'half') return 'bg-amber-100 text-amber-700';
    if (c.day === 'absent') return 'bg-slate-100 text-slate-300';
    return 'bg-slate-50 text-slate-500'; // a mark exists (night/hours) with no day-half claim
};
export const cellDayGlyph = (c: LedgerCell | null): React.ReactNode => {
    if (c === null) return null;
    if (c.day === 'full') return <Check size={12} strokeWidth={3.2} />;
    if (c.day === 'half') return '½';
    if (c.day === 'absent') return '–';
    return null;
};

/** The sub-line under the day half: ◾ (night worked) · Nत · +N. Stated facts, Latin digits. */
const cellSubLine = (c: LedgerCell): string => {
    const parts: string[] = [];
    if (c.night === 'worked') parts.push('◾');
    if (c.hours !== null) parts.push(`${c.hours}त`);
    if (c.extraHours !== null) parts.push(`+${c.extraHours}`);
    return parts.join('');
};

const HajeriLedger: React.FC<{
    data: LabourData;
    onToast: (m: string) => void;
    onOpenCell?: (row: LedgerRow, dayIndex: number) => void;
}> = ({ data, onOpenCell }) => {
    const L = data.ledger;

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <span className="text-[13px] font-extrabold text-slate-800">
                    {isReadableWeekRange(L.weekLabel) ? `${L.weekLabel} · हजेरी वही` : 'हजेरी वही'}
                </span>
            </div>

            {/* Legend — the approved vocabulary, and nothing else. */}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 p-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Check size={12} strokeWidth={3} /></span>आला</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-[11px] font-extrabold text-amber-700">½</span>अर्धा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-extrabold text-slate-300">–</span>नाही</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="h-5 w-5 rounded-md border border-dashed border-slate-200 bg-white" />रिकामं = कुणी माहिती नाही</span>
                <span className="text-[12px] font-semibold text-slate-600">◾ रात्र</span>
                <span className="text-[12px] font-semibold text-slate-600">4त = 4 तास</span>
                <span className="text-[12px] font-semibold text-slate-600">+2 जादा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="h-2 w-2 rounded-full bg-violet-500" />उक्ते काम</span>
            </div>

            <div className="overflow-x-auto rounded-[18px] border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                {/* Header: name column + one cell per day. NOTHING trails (D4: no totals column). */}
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">दिवस</span>
                    <span className="flex flex-1 gap-1.5">
                        {L.days.map((d, i) => (
                            <span key={`${d}-${i}`} data-testid="ledger-day-head" className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{formatLedgerDayHead(d)}</span>
                        ))}
                    </span>
                </div>

                {L.rows.map((r) => (
                    /* data-testid="ledger-row" is a Phase 5 DOM contract
                       (HajeriLedgerClean.test.tsx counts rows and asserts
                       nothing trails the day cells) — keep it on every
                       person AND crew row container. */
                    <div key={r.personId} data-testid="ledger-row" className="flex items-center gap-2 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-2 text-[12.5px] font-extrabold text-slate-700"><Avatar tone={r.tone} initial={r.initial} size="sm" />{r.name}</span>
                        <span className="flex flex-1 gap-1.5">
                            {r.cells.map((c, i) => (
                                <button
                                    type="button"
                                    key={i}
                                    data-testid="ledger-cell"
                                    onClick={c !== null && onOpenCell ? () => onOpenCell(r, i) : undefined}
                                    className={`relative flex h-[34px] w-[26px] flex-none flex-col items-center justify-center rounded-lg text-[12px] font-extrabold [font-variant-numeric:tabular-nums] ${cellDayClass(c)}`}
                                >
                                    {c !== null && c.ukte && <span data-testid="ledger-ukte-dot" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-500" />}
                                    <span className="flex items-center justify-center leading-none">{cellDayGlyph(c)}</span>
                                    {c !== null && cellSubLine(c) !== '' && (
                                        <span className="mt-0.5 text-[8.5px] font-bold leading-none text-slate-500">{cellSubLine(c)}</span>
                                    )}
                                </button>
                            ))}
                        </span>
                    </div>
                ))}

                {/* Crew aggregate rows — violet count cells, blank when unknown, never
                    folded into the mukadam's own row (final direction §3). */}
                {L.crewRows.map((crew) => (
                    <div key={crew.throughFieldOperatorId} data-testid="ledger-row" className="flex items-center gap-2 border-t border-dashed border-violet-100 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-1.5 text-[12px] font-bold text-violet-700"><Users size={13} />{crew.throughName}सोबत</span>
                        <span className="flex flex-1 gap-1.5">
                            {crew.counts.map((n, i) => (
                                <span key={i} data-testid="ledger-crew-cell" className={`flex h-[34px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold [font-variant-numeric:tabular-nums] ${n === null ? 'border border-dashed border-violet-100 bg-white text-violet-200' : 'bg-violet-50 text-violet-700'}`}>{n === null ? '' : n}</span>
                            ))}
                        </span>
                    </div>
                ))}
            </div>

            {/* Approved placement (mockup 06, panel 1e): the empty card sits BELOW the
                always-drawn grid, never as a takeover that replaces it. */}
            {L.rows.length === 0 && L.crewRows.length === 0 && (
                <EmptyState
                    icon={<BookText size={22} />}
                    title="अजून हजेरी नोंदवली नाही"
                    subtitle="बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल."
                />
            )}

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600">हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही.</div>
        </div>
    );
};

export default HajeriLedger;
```

- [ ] **Step 5: Null-money render guards (the D-H8 nullability landing)**

1. `LabourUiKit.tsx` `BalanceCard` tiles (`:252-259`):
   `['दिलं', inr(balance.paid)]` → `['दिलं', balance.paid === null ? '—' : inr(balance.paid)]`;
   `if (balance.advance > 0)` → `if (balance.advance !== null && balance.advance > 0)` (and the
   `inr(balance.advance)` inside is then non-null by the guard). `MoneyLine` needs no edit — it
   returns null via `netBalance` already.
2. `PersonDetail.tsx:176-178`:
   `w.balance.recorded === null || w.balance.advance !== 0` →
   `w.balance.recorded === null || w.balance.paid === null || w.balance.advance !== 0`
   (a `null` advance also lands in the omit branch via `!== 0` being true — comment stays valid).
3. `WeeklyDashboard.tsx`:
   - `drawsBar` (`:121-126`) → prepend `d.money !== null &&` and read through `d.money` as
     before (TypeScript narrows the rest of the expression).
   - wages tile (`:189`) → `value={d.wages === null ? '—' : inr(d.wages)}`
   - advances tile (`:191`) → `value={d.advances === null ? '—' : inr(d.advances)}`
   - the पैसे card body (`:345-385`): wrap the card's inner content in `{d.money !== null ? (…existing content…) : (<div className="text-[16px] font-black text-slate-800">—</div>)}` —
     the existing `d.money.recorded === null ? '—' : …` branches inside stay untouched.
4. `AttendanceDefaultsBlank.test.tsx`: update imports/fixtures from `cellClass`/`cellGlyph` to
   `cellDayClass`/`cellDayGlyph` and from `PresenceStatus | null` cells to
   `LedgerCell | null` (use the `cell(…)` builder pattern from Step 1's test); every assertion's
   intent (null ≠ absent, both visually distinct, names always render) is kept verbatim.

- [ ] **Step 6: Run the feature suites and the full frontend typecheck**

```
cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/labour src/features/logs
```
Expected: PASS. `tsc` is the complete ripple list for the nullability change — fix every site it
names with the same `=== null ? '—' :` house pattern; never `?? 0`.

- [ ] **Step 7: Commit**

```bash
git add src/clients/mobile-web/src/features/labour
git commit -m "feat(labour): split-cell clean हजेरी वही on the client — crew rows, five axes, no totals"
```

---

### Task 4 (brief Task 4.5): tap-detail — the only place detail lives

**Files:**
- Create: `src/clients/mobile-web/src/features/labour/components/HajeriCellDetail.tsx`
- Modify: `src/clients/mobile-web/src/features/labour/components/LabourFeature.tsx:208`
  (the `'ledger'` mount gains the sheet state + `onOpenCell`)
- Test (create): `src/clients/mobile-web/src/features/labour/components/__tests__/HajeriCellDetail.test.tsx`

**Interfaces:**
- Consumes: `LedgerRow` / `LedgerCell` (Task 3), `HajeriLedger`'s `onOpenCell` prop.
- Produces: `HajeriCellDetail: React.FC<{ row: LedgerRow; dayIndex: number; dayIso: string; onClose: () => void }>` — nothing else consumes it yet; Phase 5+ worker-confirmation
  attaches HERE (row/tap-detail is D-H10's resolved placement), which is why it is its own
  component and not inline JSX.

**Approved copy:** पूर्ण · अर्धा · आला नाही (existing नाही vocabulary) · रात्र · `N तास` ·
`जादा N तास` · उक्ते काम · dimensional week from the founder's own pattern
`5 पूर्ण · 1 अर्धा · 2 रात्री · 3 तास जादा`. "हा तपशील फक्त cell वर दाबल्यावर दिसतो" is his design
note, not UI copy — it does not render.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriCellDetail — master review D4 item 4: person-day detail ONLY on tap
 * (marks + stated hours + arrangement + work context), and final direction §2:
 * the week reads DIMENSIONALLY here — 5 पूर्ण · 1 अर्धा · 2 रात्री · 3 तास
 * जादा — never one invented number.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriCellDetail from '../HajeriCellDetail';
import type { LedgerRow, LedgerCell } from '../../labour.types';

afterEach(() => cleanup());

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const row: LedgerRow = {
    personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
    cells: [
        cell({ day: 'full' }),
        cell({ day: 'full', night: 'worked' }),
        cell({ day: 'half' }),
        cell({ night: 'worked', hours: 3 }),
        cell({ day: 'full', extraHours: 2, ukte: true, work: 'द्राक्ष छाटणी' }),
        null,
        null,
    ],
};

describe('HajeriCellDetail — detail only on tap, week only in dimensions', () => {
    it('shows the person-day facts: marks, stated hours, arrangement, work context', () => {
        const { container } = render(
            <HajeriCellDetail row={row} dayIndex={4} dayIso="2026-08-28" onClose={vi.fn()} />);

        expect(container.textContent).toContain('गणेश');
        expect(container.textContent).toContain('पूर्ण');
        expect(container.textContent).toContain('जादा 2 तास');
        expect(container.textContent).toContain('उक्ते काम');
        expect(container.textContent).toContain('द्राक्ष छाटणी');
    });

    it('reads the week dimensionally and never as one number', () => {
        const { container } = render(
            <HajeriCellDetail row={row} dayIndex={0} dayIso="2026-08-24" onClose={vi.fn()} />);

        const week = container.querySelector('[data-testid="dimensional-week"]')!;
        expect(week.textContent).toContain('3 पूर्ण');
        expect(week.textContent).toContain('1 अर्धा');
        expect(week.textContent).toContain('2 रात्री');
        expect(week.textContent).toContain('जादा 2 तास');
        // the one-number week must not exist: no '4.5', no summed figure
        expect(container.textContent).not.toContain('4.5');
    });

    it('omits dimensions that have no stated fact — never a fabricated 0', () => {
        const bare: LedgerRow = { ...row, cells: [cell({ day: 'half' }), null] };
        const { container } = render(
            <HajeriCellDetail row={bare} dayIndex={0} dayIso="2026-08-24" onClose={vi.fn()} />);

        const week = container.querySelector('[data-testid="dimensional-week"]')!;
        expect(week.textContent).toContain('1 अर्धा');
        expect(week.textContent).not.toContain('0 पूर्ण');
        expect(week.textContent).not.toContain('0 रात्री');
    });
});
```

- [ ] **Step 2: Run and see it fail**

```
cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/HajeriCellDetail.test.tsx 2>&1 | tail -8
```
Expected: FAIL — module `../HajeriCellDetail` not found.

- [ ] **Step 3: Implement `HajeriCellDetail.tsx`**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriCellDetail — "हा तपशील फक्त cell वर दाबल्यावर दिसतो." (founder master
 * review 2026-09-02, D4 item 4). The grid stays clean; EVERYTHING beyond the
 * day-mark lives here: the person-day's marks, stated hours, the arrangement
 * (उक्ते काम) and its work context, and the row's DIMENSIONAL week — counts of
 * stated facts side by side (final direction §2), never one invented number.
 *
 * COUNTING here is display of what was said (how many cells say पूर्ण), not
 * arithmetic that invents a figure: no fraction, no sum across kinds, no
 * conversion of hours into days. A dimension with nothing stated is OMITTED —
 * never rendered as 0.
 *
 * D-H10 note: a future worker confirmation attaches to THIS surface (row /
 * tap-detail — the founder's resolved placement). Keep it a component.
 */
import React from 'react';
import { X } from 'lucide-react';
import type { LedgerRow } from '../labour.types';
import { Avatar } from './LabourUiKit';
import { formatLedgerDayHead } from '../marathiDate';

const DAY_WORD: Record<string, string> = { full: 'पूर्ण', half: 'अर्धा', absent: 'आला नाही' };

const HajeriCellDetail: React.FC<{
    row: LedgerRow;
    dayIndex: number;
    dayIso: string;
    onClose: () => void;
}> = ({ row, dayIndex, dayIso, onClose }) => {
    const c = row.cells[dayIndex];

    // Dimensional week — counts of the row's own stated facts, Latin digits.
    const marked = row.cells.filter((x) => x !== null);
    const full = marked.filter((x) => x!.day === 'full').length;
    const half = marked.filter((x) => x!.day === 'half').length;
    const nights = marked.filter((x) => x!.night === 'worked').length;
    const extra = marked.reduce((sum, x) => sum + (x!.extraHours ?? 0), 0);
    const weekParts: string[] = [];
    if (full > 0) weekParts.push(`${full} पूर्ण`);
    if (half > 0) weekParts.push(`${half} अर्धा`);
    if (nights > 0) weekParts.push(`${nights} रात्री`);
    if (extra > 0) weekParts.push(`जादा ${extra} तास`);

    return (
        <div className="fixed inset-0 z-40 flex items-end bg-black/30" onClick={onClose}>
            <div className="w-full rounded-t-[24px] bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[19px] font-bold text-stone-800">
                        <Avatar tone={row.tone} initial={row.initial} size="sm" />{row.name}
                        <span className="text-[16px] font-semibold text-stone-500">{formatLedgerDayHead(dayIso)}</span>
                    </span>
                    <button type="button" onClick={onClose} aria-label="बंद" className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500"><X size={18} /></button>
                </div>

                {c === null ? (
                    // रिकामं — nobody has said anything about this day. Blank, not absent.
                    <div className="mt-3 rounded-xl border border-dashed border-stone-200 p-3 text-[16px] text-stone-500">कुणी माहिती नाही</div>
                ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {c.day !== null && (
                            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[16px] font-bold text-emerald-700">{DAY_WORD[c.day]}</span>
                        )}
                        {c.night === 'worked' && (
                            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[16px] font-bold text-slate-700">◾ रात्र</span>
                        )}
                        {c.hours !== null && (
                            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[16px] font-bold text-slate-700">{c.hours} तास</span>
                        )}
                        {c.extraHours !== null && (
                            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[16px] font-bold text-amber-700">जादा {c.extraHours} तास</span>
                        )}
                        {c.ukte && (
                            <span className="rounded-full bg-violet-50 px-3 py-1.5 text-[16px] font-bold text-violet-700">उक्ते काम{c.work !== null ? ` · ${c.work}` : ''}</span>
                        )}
                        {!c.ukte && c.work !== null && (
                            <span className="rounded-full bg-stone-100 px-3 py-1.5 text-[16px] font-semibold text-stone-600">{c.work}</span>
                        )}
                    </div>
                )}

                {weekParts.length > 0 && (
                    <div data-testid="dimensional-week" className="mt-4 border-t border-stone-100 pt-3 text-[16px] font-semibold text-stone-600">
                        {weekParts.join(' · ')}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HajeriCellDetail;
```

- [ ] **Step 4: Mount it from `LabourFeature.tsx`**

Add state beside the feature's existing screen state:
`const [cellDetail, setCellDetail] = React.useState<{ row: LedgerRow; dayIndex: number } | null>(null);`
(import `LedgerRow` from `../labour.types`), change the `'ledger'` mount (`:208`) to:

```tsx
{cur.name === 'ledger' && (
    <HajeriLedger
        data={data}
        onToast={showToast}
        onOpenCell={(row, dayIndex) => setCellDetail({ row, dayIndex })}
    />
)}
```

and render, beside the feature's other overlays:

```tsx
{cellDetail && (
    <HajeriCellDetail
        row={cellDetail.row}
        dayIndex={cellDetail.dayIndex}
        dayIso={data.ledger.days[cellDetail.dayIndex] ?? ''}
        onClose={() => setCellDetail(null)}
    />
)}
```

with import `import HajeriCellDetail from './HajeriCellDetail';`.

- [ ] **Step 5: Run and pass**

```
cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/labour
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/clients/mobile-web/src/features/labour
git commit -m "feat(labour): person-day tap-detail with the dimensional week read"
```

---

### Task 5 (brief Task 4.0): the ledger door is a door, not a switch

Runs AFTER Tasks 1–4: Decision 4b — un-hiding means finishing, and the screen is now finished.

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/components/LabourHub.tsx`
  (`:39-51` constant + comment block; `:342-344` render)
- Modify: `src/clients/mobile-web/src/features/labour/components/WeeklyDashboard.tsx`
  (`:62-64` constant + comment; `:387-394` render)
- Test: covered by Task 3's "zero rows still draw the week" + a mount assertion added below.

**Scope fence (verbatim from the plan):** `SHOW_ATTENDANCE_TILE` (`LabourHub.tsx:37`) is a CAPTURE
gate and is **out of this task** — its tile keeps `(SHOW_ATTENDANCE_TILE || isPreview)`
unchanged. Only the LEDGER's two doors and the ledger tile's `|| isPreview` escape are deleted.

- [ ] **Step 1: Write the failing test** — append to
`src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx`:

```tsx
import LabourHub from '../LabourHub';
import WeeklyDashboard from '../WeeklyDashboard';

describe('Correction 5 — the ledger door is not a switch', () => {
    it('the हजेरी वही tile renders on a real farm (no preview, no flag)', () => {
        const { getAllByText } = render(
            <LabourHub
                data={LABOUR_MOCK}
                onOpenMukadam={vi.fn()} onOpenPerson={vi.fn()} onAttendance={vi.fn()}
                onDashboard={vi.fn()} onLedger={vi.fn()} onReview={vi.fn()} onGoToLog={vi.fn()}
            />);
        expect(getAllByText('हजेरी वही').length).toBeGreaterThan(0);
    });

    it('the dashboard हजेरी वही button renders unconditionally', () => {
        const { getAllByText } = render(
            <WeeklyDashboard
                data={LABOUR_MOCK}
                onReview={vi.fn()} onLedger={vi.fn()} onToast={vi.fn()}
                timeWindow="alltime" onTimeWindowChange={vi.fn()}
            />);
        expect(getAllByText('हजेरी वही').length).toBeGreaterThan(0);
    });
});
```

(If `WeeklyDashboard`'s `Props` require members not listed here, supply them from the component's
own `Props` interface with `vi.fn()` / fixture values — the assertion is the tile's presence,
nothing else.)

- [ ] **Step 2: Run and see it fail**

```
cd src/clients/mobile-web && npx vitest run src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx 2>&1 | tail -8
```
Expected: FAIL — 'हजेरी वही' tile/button not found (both flags are `false` and `isPreview` is not
passed).

- [ ] **Step 3: Delete — not flip — the switches**

1. `LabourHub.tsx`: delete lines `:39-51` (the whole `SHOW_LEDGER_TILE` comment block + `const
   SHOW_LEDGER_TILE = false;`) and replace the render at `:342-344` with an unconditional tile
   plus the reason a future editor must read:

```tsx
            {/* Correction 5 (founder, 2026-09-01): the हजेरी वही is NEVER gated —
                not by capture state, not by a constant that can be flipped back.
                The register draws its own blank week when nothing is recorded.
                (SHOW_LEDGER_TILE and its |, isPreview escape were DELETED, not
                flipped — a flag is a gate wearing a comment.) */}
            <QuickTile icon={<BookText size={20} />} chip="bg-blue-100 text-blue-600" label="हजेरी वही" sub="सर्व दिवस" onClick={onLedger} />
```

   Also update the stale reference in the file-top comment (`:12` mentions `SHOW_LEDGER_TILE`)
   and in the `isPreview` prop doc (`:85-86`) — comments that name a deleted constant LIE, and
   this repo treats a lying comment as a defect (`labour-attendance-shipped-but-gated`).
2. `WeeklyDashboard.tsx`: delete `:62-64` (the `SHOW_LEDGER_BUTTON` comment + constant) and
   unwrap the `:387-394` button (remove `{SHOW_LEDGER_BUTTON && (` and its closing `)}`), leaving
   the button unconditional with the same replacement comment as above (one line version:
   `{/* Correction 5: the हजेरी वही door is never gated — constant DELETED, not flipped. */}`).
   Update the stale `:29` file-top mention.

- [ ] **Step 4: Run and pass**

```
cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/labour
```
Expected: PASS, and `tsc` confirms no dangling references to either constant.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/labour/components/LabourHub.tsx \
        src/clients/mobile-web/src/features/labour/components/WeeklyDashboard.tsx \
        src/clients/mobile-web/src/features/labour/components/__tests__/HajeriLedgerTotals.test.tsx
git commit -m "feat(labour): delete the ledger door switches — the register is never gated"
```

---

### Task 6 (brief Task 4.2): no-work-day attendance keeps its disturbance

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/attendanceDraft.ts:60-63` (and the file-top
  comment that justifies the discard)
- Test (modify): `src/clients/mobile-web/src/features/logs/__tests__/attendanceDraft.test.ts:40-48,61-67`
- Backend register behaviour: already pinned by Task 1's `ANoWorkDayStillCarriesItsColumnAndItsMarks`.

**Interfaces:**
- Consumes: `AgriLogResponse.disturbance` / `.dayOutcome`
  (`domain/ai/contracts/AgriLogResponseSchema.ts:722,731`; `'NO_WORK_PLANNED'` at `:84`).
- Produces: nothing new — `toAttendanceOnlyDraft` keeps its exact signature
  `toAttendanceOnlyDraft(draft: AgriLogResponse | null): AgriLogResponse | null`; Phase 3's
  no-work capture door (**काम झालं नाही, पण मजूर आले** — approved copy) relies on the draft
  reaching the confirm screen with `disturbance` intact.

**Verification the plan asked for, CLOSED here (2026-09-02, in-tree):** the sync payload CAN
carry the reason — `sync-contract/schemas/payloads/create_daily_log.zod.ts:126` declares
`dayOutcome: z.enum(['WORK_RECORDED','DISTURBANCE_RECORDED','NO_WORK_PLANNED','IRRELEVANT_INPUT'])`
and `:130` declares `disturbance: z.object(…)`; the generated
`sync-contract/schemas/payloads-csharp/CreateDailyLogPayload.cs:83-84` carries
`string? DayOutcome` and `DisturbanceItem? Disturbance`. The Phase 0 worry ("DisturbanceItem may
not be on the payload") is FALSE for the current tree — no sync-contract change is needed, so
this task stays a one-file client fix.

- [ ] **Step 1: Update the tests (failing)**

In `attendanceDraft.test.ts`, change the first test (`:40-48`):

```ts
    it('empties every bucket that belongs to the other door — but never the disturbance', () => {
        const out = toAttendanceOnlyDraft(fullDraft())!;
        expect(out.cropActivities).toEqual([]);
        expect(out.irrigation).toEqual([]);
        expect(out.inputs).toEqual([]);
        expect(out.machinery).toEqual([]);
        expect(out.activityExpenses).toEqual([]);
        // D11 + founder Task 4.2: attendance says WHO, disturbance says WHAT
        // blocked the day. Neither collapses into the other; dropping it here
        // severed the no-work-day flow (the parse DOES produce it).
        expect(out.disturbance).toEqual({ blockedSegments: [], reason: 'rain' });
    });
```

and extend the keeps-what-he-can-read test (`:61-67`) with two lines:

```ts
        expect(out.disturbance).toEqual(src.disturbance);
        expect(out.dayOutcome).toBe(src.dayOutcome);
```

- [ ] **Step 2: Run and see the first one fail**

```
cd src/clients/mobile-web && npx vitest run src/features/logs/__tests__/attendanceDraft.test.ts 2>&1 | tail -8
```
Expected: FAIL — `out.disturbance` is `undefined` (the shipped `:60-63` discards it).

- [ ] **Step 3: Fix `attendanceDraft.ts`**

Replace lines `:60-63` (the comment + `disturbance: undefined,`) with:

```ts
        // PRESERVED — Phase 4 Task 4.2 (spec D11, no-work door "काम झालं नाही,
        // पण मजूर आले"). Attendance says WHO was there; the disturbance says
        // WHAT blocked the day. They are the two halves of ONE fact about a
        // no-work day and neither collapses into the other — the earlier
        // version dropped it here, which severed the flow the parse feeds
        // (AgriLogResponseSchema.ts:731) from the day it describes. The sync
        // payload carries it end to end (create_daily_log.zod.ts:126,130 →
        // CreateDailyLogPayload.cs:83-84), verified 2026-09-02.
        disturbance: draft.disturbance,
```

Also amend the file-top doc comment: the sentence block that begins "A disturbance is a blocker
on the DAY, not on who turned up" is now false — replace that one paragraph with:
`* The disturbance SURVIVES this filter (see below): on a no-work day it is the`
`* reason the day had no work, and the हजेरी confirm screen shows it beside WHO came.`

- [ ] **Step 4: Run and pass, then the whole logs+labour set (rules 6/7 regression)**

```
cd src/clients/mobile-web && npx vitest run src/features/logs src/features/labour
```
Expected: PASS — including `isAttendanceOnlyDraft` tests, which are disturbance-agnostic by
design (a no-work draft with people + disturbance still counts as attendance-only: WHO plus the
blocker, no work buckets — which is exactly rules 6 and 7: the day shows attendance and nothing
concludes work happened).

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/logs/attendanceDraft.ts \
        src/clients/mobile-web/src/features/logs/__tests__/attendanceDraft.test.ts
git commit -m "fix(labour): no-work-day attendance keeps its disturbance — WHO and WHAT-blocked are one day's two halves"
```

---

### Task 7 (brief Task 4.3): one person, two works, one farm-day — structure, plus the safety net

**No new type, no new column, no detector.** The semantic pre-persistence check lives in Phase
3's `RecordAttendanceMarkHandler` (after the gate, before staging — Phase 0 UNKNOWN 4's seam).
This task proves what the SCHEMA already guarantees, and pins the SQL unique index as a
last-resort safety net that must never become the product mechanism.

**Files:**
- Test (already created in Task 1): `BuildHajeriLedgerTests.cs` — the structural half is
  `UkteDotComesFromTheEngagementsContractUnit` + the new fact below.
- Test (append): `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs`
- Test (create): `src/tests/ShramSafal.Sync.IntegrationTests/Labour/AttendanceMarkUniqueIndexRealPostgresTests.cs`

**Interfaces:**
- Consumes: the `ux_attendance_marks_farm_operator_day` unique index
  (`Migrations/20260831180408_AddAttendanceMarks.cs:41-45` — verified in file), the
  RealPostgres harness idiom (`RequiresPostgresConnection`, `IntegrationMigrationChain`, scratch
  DB — lifted from `LabourAssignmentParentIntegrityRealPostgresTests.cs`, read in full).
- Produces: nothing — proofs only.

- [ ] **Step 1: Append the structural fact (failing only if the build is wrong)**

Append to `BuildHajeriLedgerTests`:

```csharp
    /// <summary>
    /// Brief Task 4.3, structural half: Ganesh on grape pruning AND cane work
    /// the same day is TWO work rows and exactly ONE mark → one register row,
    /// one cell, and both engagements' WorkerCount untouched (attribution never
    /// changes reported quantity — P7). No reconciliation step exists or is
    /// needed; the grain guarantees it.
    /// </summary>
    [Fact]
    public void TwoWorksOneDayIsOneRowOneCellAndNoCountChanges()
    {
        var ganesh = Guid.NewGuid();
        var grapeLog = Guid.NewGuid();
        var caneLog = Guid.NewGuid();
        var grapes = Assignment(Guid.NewGuid(), grapeLog, task: "द्राक्ष छाटणी", workerCount: 4);
        var cane = Assignment(Guid.NewGuid(), caneLog, task: "ऊस तोडणी", workerCount: 6);
        var logDates = new Dictionary<Guid, DateOnly> { [grapeLog] = Monday, [caneLog] = Monday };

        var ledger = Build(
            [Mark(ganesh, Monday)],
            [Operator(ganesh, "गणेश")],
            workRows:
            [
                WorkRow(ganesh, grapes.Id, Monday, "गणेश"),
                WorkRow(ganesh, cane.Id, Monday, "गणेश"),
            ],
            assignments: [grapes, cane],
            logDates: logDates);

        var row = Assert.Single(ledger.Rows);           // one row
        var cell = row.Cells[0]!;                       // one cell
        Assert.Equal("full", cell.Day);
        Assert.Equal("द्राक्ष छाटणी · ऊस तोडणी", cell.Work); // both contexts, ONE presence
        Assert.Equal(4, grapes.WorkerCount);            // reported quantities untouched
        Assert.Equal(6, cane.WorkerCount);
    }
```

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~TwoWorksOneDay"`
Expected: PASS immediately (the structure already guarantees it — that is the point; a FAIL here
means Task 1's build is wrong, fix THAT).

- [ ] **Step 2: Write the safety-net proof (failing = red until run against real Postgres)**

Create `AttendanceMarkUniqueIndexRealPostgresTests.cs` — harness copied from
`LabourAssignmentParentIntegrityRealPostgresTests.cs` (same file layout, scratch DB name
`ssf_attmark_uq_{Guid:N}`), with this class doc and fact:

```csharp
// spec: 2026-09-01-labour-v2-r1 (Phase 4, brief Task 4.3)
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Brief Task 4.3, safety-net half — final direction §8, verbatim rule: the
/// unique index is a LAST-RESORT SAFETY NET that prevents an impossible
/// duplicate canonical mark if application logic fails. It is NOT the product
/// mechanism that discovers ambiguity, and a database error must never be the
/// thing that decides to ask the farmer a question — the semantic check lives
/// in RecordAttendanceMarkHandler, BEFORE persistence (Phase 3). This suite
/// proves the net exists and holds; nothing more.
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged RequiresPostgres; unreachable Postgres THROWS out of InitializeAsync
/// — FAILED, never a silent skip. Own scratch database, full
/// IntegrationMigrationChain, dropped on dispose. Superuser connection is fine
/// here: this is a CONSTRAINT proof, not an RLS proof, and must never be cited
/// as RLS coverage.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AttendanceMarkUniqueIndexRealPostgresTests : IAsyncLifetime
{
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_attmark_uq_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    [Fact]
    public async Task A_second_canonical_mark_for_the_same_person_day_is_refused_with_23505()
    {
        var farmId = Guid.NewGuid();
        var operatorId = Guid.NewGuid();
        var recordedBy = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        static NpgsqlCommand InsertMark(NpgsqlConnection db, Guid farmId, Guid operatorId, Guid recordedBy, int dayMark)
        {
            var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.attendance_marks
                    ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                     recorded_by_user_id, recorded_at_utc, modified_at_utc)
                VALUES (@id, @fid, @oid, DATE '2026-09-01', @day, 0, @uid, NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("fid", farmId);
            c.Parameters.AddWithValue("oid", operatorId);
            c.Parameters.AddWithValue("day", dayMark);
            c.Parameters.AddWithValue("uid", recordedBy);
            return c;
        }

        // First ruling lands.
        await using (var first = InsertMark(db, farmId, operatorId, recordedBy, dayMark: 1))
        {
            (await first.ExecuteNonQueryAsync()).Should().Be(1);
        }

        // A second canonical ruling for the SAME (farm, person, day) — even a
        // different value — hits the net: 23505, never a silent second truth.
        await using var second = InsertMark(db, farmId, operatorId, recordedBy, dayMark: 2);
        var act = async () => await second.ExecuteNonQueryAsync();
        (await act.Should().ThrowAsync<PostgresException>())
            .Which.SqlState.Should().Be("23505");

        // A different DAY for the same person is not a duplicate — the net
        // catches the impossible, never the ordinary.
        await using var otherDay = db.CreateCommand();
        otherDay.CommandText = """
            INSERT INTO ssf.attendance_marks
                ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                 recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (@id, @fid, @oid, DATE '2026-09-02', 1, 0, @uid, NOW(), NOW());
            """;
        otherDay.Parameters.AddWithValue("id", Guid.NewGuid());
        otherDay.Parameters.AddWithValue("fid", farmId);
        otherDay.Parameters.AddWithValue("oid", operatorId);
        otherDay.Parameters.AddWithValue("uid", recordedBy);
        (await otherDay.ExecuteNonQueryAsync()).Should().Be(1);
    }
}
```

(If Phase 2's Task 2.5 has added `hours_worked`/`extra_hours`/`hours_basis` to the CreateTable,
the INSERTs above still succeed — the new columns are nullable by that task's own definition.)

- [ ] **Step 3: Run it against native :5433**

```
dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter "FullyQualifiedName~AttendanceMarkUniqueIndexRealPostgresTests"
```
Expected: PASS (requires local native Postgres on :5433 per project policy; an unreachable server
FAILS loudly — that is the harness's contract, do not convert it to a skip).

- [ ] **Step 4: Commit**

```bash
git add src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs \
        src/tests/ShramSafal.Sync.IntegrationTests/Labour/AttendanceMarkUniqueIndexRealPostgresTests.cs
git commit -m "test(labour): one person two works one farm-day — structural proof plus the 23505 safety net"
```

---

### Task 8 (brief Task 4.6): the Labour home's two money truths

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs`
  (add `LabourHomeDto`; `LabourDataDto` gains `Home` as the final positional member)
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs`
  (compute `Home` after the `todaysLogIdSet` block `:717-729`; extend `ApplyRegisterView`)
- Modify: `src/clients/mobile-web/src/features/labour/labour.types.ts` (`LabourHome`,
  `LabourData.home`), `labourClient.ts` (wire + map), `labourMock.ts` (fixtures)
- Modify: `src/clients/mobile-web/src/features/labour/components/LabourHub.tsx` (the two cards +
  the आज कामावर line, inserted directly above the QuickTile grid `:336`)
- Test (append): `src/tests/ShramSafal.Domain.Tests/Labour/LabourRegisterViewTests.cs` and a new
  `src/tests/ShramSafal.Domain.Tests/Labour/LabourHomeMoneyTests.cs`
- Test (append): the LabourHub facts into `HajeriLedgerTotals.test.tsx`'s file (same suite file
  as Task 5's mount tests)

**Interfaces:**
- Consumes: `LabourAssignment.{ContractUnit, TotalCost, WorkerCount, MaleCount, FemaleCount,
  DailyLogId}`, `LabourHeadcount.Resolve`, `todaysLogIdSet` (handler `:718-722`),
  `allAssignments` (handler `:571-573`), `ApplyRegisterView` (Task 2).
- Produces: `LabourHomeDto` (exact shape in the phase interface block) and
  `internal static LabourHomeDto BuildLabourHome(IReadOnlyList<LabourAssignment> allAssignments, IReadOnlySet<Guid> todaysLogIds)` — Phase 6 (Contract V1) extends the उक्ते card from this exact
  seam without remodelling anything (the founder's scope fence).

**The three honesty rules this task encodes (master review D6, verbatim in effect):** summing
SAME-KIND stated amounts under an honest label (नोंदलेली / ठरलेली) is display of what was
recorded. Forbidden: blending the two kinds, rate × days derivation, presenting agreed as spent.
"आज कामावर" counts come from stated engagement headcounts — the engagement is the single source
of HOW MANY (`AttendanceMark.cs` remarks: "this says who"); the arrangement split is a breakdown,
never a filter, so the parts need not sum to the whole and an unknown stays blank. दिलेली रक्कम
(actually-paid) is NOT this task — it renders only when a payment is recorded, and the existing
Paid figures already carry that surface.

- [ ] **Step 1: Write the failing tests**

Create `LabourHomeMoneyTests.cs`:

```csharp
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Master review D6 — one Labour, TWO money truths, never one figure: the
/// system never says "₹16,650 खर्च". रोजंदारी · नोंदलेली and उक्ते काम ·
/// ठरलेली aggregate SAME-KIND stated amounts under honest labels; nothing
/// blends them, nothing derives rate × days, nothing presents agreed as spent.
/// Blanks are null, never 0.
/// </summary>
public sealed class LabourHomeMoneyTests
{
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);

    private static LabourAssignment Engagement(Guid logId, decimal? totalCost, ContractUnit? unit, int? count = null)
        => LabourAssignment.Create(
            id: Guid.NewGuid(), dailyLogId: logId, engagementType: LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: count, wagePerPerson: null,
            contractUnit: unit, contractQuantity: null, totalCost: totalCost,
            linkedActivityId: null, createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed(), shift: null, task: null, workerNames: []);

    [Fact]
    public void TheTwoKindsNeverCombineAndBlanksAreNulls()
    {
        var todayLog = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [
                Engagement(todayLog, totalCost: 1200m, unit: null, count: 4),        // रोजंदारी, stated
                Engagement(todayLog, totalCost: null, unit: null),                   // रोजंदारी, nothing stated
                Engagement(todayLog, totalCost: 12000m, unit: ContractUnit.Acre, count: 8), // उक्ते, agreed
            ],
            todaysLogIds: new HashSet<Guid> { todayLog });

        Assert.Equal(1200m, home.RojandariStated);
        Assert.Equal(12000m, home.UkteAgreed);      // never 13200 anywhere
        Assert.Equal(12, home.OnFarmToday);         // whole count, stated headcounts
        Assert.Equal(4, home.RojandariToday);
        Assert.Equal(8, home.UkteToday);
    }

    [Fact]
    public void NoStatedMoneyIsNullNeverZero()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, totalCost: null, unit: null)],
            todaysLogIds: new HashSet<Guid>());

        Assert.Null(home.RojandariStated);
        Assert.Null(home.UkteAgreed);
        Assert.Null(home.OnFarmToday);              // no engagement today → unknown, not 0
    }

    [Fact]
    public void UnknownHeadcountStaysBlankInsideTheBreakdown()
    {
        var todayLog = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [
                Engagement(todayLog, totalCost: null, unit: null, count: 4),
                Engagement(todayLog, totalCost: null, unit: ContractUnit.Acre, count: null), // उक्ते, count unstated
            ],
            todaysLogIds: new HashSet<Guid> { todayLog });

        Assert.Equal(4, home.OnFarmToday);          // known figures are not poisoned…
        Assert.Equal(4, home.RojandariToday);
        Assert.Null(home.UkteToday);                // …and the unknown part stays blank, never 0
    }
}
```

Append to `LabourRegisterViewTests` (inside `CrewAttendanceViewCarriesAttendanceAndZeroMoneyMembers`
and `OwnRowViewCarriesNoOtherRowsAndNoMoney`, one line each):

```csharp
        Assert.Null(dto.Home.RojandariStated);
        Assert.Null(dto.Home.UkteAgreed);
```

and give `FullDto()` a home: `View: "owner", Home: new LabourHomeDto(1200m, 12000m, 12, 4, 8)`
(plus `Assert.Equal(1200m, dto.Home.RojandariStated);` in the OwnerBook fact — and the headcount
members must SURVIVE stripping in all three views: add
`Assert.Equal(12, dto.Home.OnFarmToday);` to the crew fact — attendance counts are safe for
anyone, only money is withheld).

- [ ] **Step 2: Run and see it fail**

```
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourHomeMoney" 2>&1 | tail -10
```
Expected: compile errors — `LabourHomeDto` and `BuildLabourHome` do not exist.

- [ ] **Step 3: Backend implementation**

`LabourDataDto.cs` — append after `LabourAttendanceDraftDto`:

```csharp
/// <summary>
/// Labour home (master review 2026-09-02, D6) — one Labour, TWO money truths,
/// never combined: the system never says "₹16,650 खर्च".
///
/// <para><c>RojandariStated</c> (रोजंदारी · नोंदलेली) sums STATED TotalCost on
/// non-contract engagements; <c>UkteAgreed</c> (उक्ते काम · ठरलेली) sums stated
/// TotalCost on engagements with a stated ContractUnit. Same-kind aggregation
/// under an honest label is display of what was recorded; blending the kinds,
/// rate × days, or presenting agreed as spent is forbidden and has no member
/// here to land in. Null = nothing stated — blank, never ₹0. Actually-paid
/// money (दिलेली रक्कम) is the existing Paid surface, not this.</para>
///
/// <para>The headcount line ("आज कामावर N जण — x रोजंदारी · y उक्ते") reads
/// STATED engagement headcounts (the engagement is the single source of HOW
/// MANY — AttendanceMark's own contract); the arrangement split is a
/// breakdown, never a filter, so x + y need not equal N and an unknown part
/// stays null. Phase 6 (Contract V1) extends the उक्ते card from this seam
/// without remodelling Labour/हजेरी — the founder's scope fence.</para>
/// </summary>
public sealed record LabourHomeDto(
    decimal? RojandariStated,
    decimal? UkteAgreed,
    int? OnFarmToday,
    int? RojandariToday,
    int? UkteToday);
```

and `LabourDataDto` gains `,\n    LabourHomeDto Home` after `View`.

`GetLabourDataHandler.cs` — add beside `BuildHajeriLedger`:

```csharp
    /// <summary>See <see cref="LabourHomeDto"/> — the two money truths and the आज कामावर counts.</summary>
    internal static LabourHomeDto BuildLabourHome(
        IReadOnlyList<LabourAssignment> allAssignments,
        IReadOnlySet<Guid> todaysLogIds)
    {
        static decimal? SumStated(IEnumerable<LabourAssignment> source)
        {
            var stated = source
                .Where(a => a.TotalCost is not null)
                .Select(a => a.TotalCost!.Value)
                .ToList();
            return stated.Count == 0
                ? null // nothing stated — blank, never ₹0
                : decimal.Round(stated.Sum(), 2, MidpointRounding.AwayFromZero);
        }

        static int? SumKnownHeadcounts(IEnumerable<LabourAssignment> source)
        {
            var known = source
                .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
                .Where(h => h is not null)
                .Select(h => h!.Value)
                .ToList();
            return known.Count == 0 ? null : known.Sum();
        }

        var todays = allAssignments.Where(a => todaysLogIds.Contains(a.DailyLogId)).ToList();

        return new LabourHomeDto(
            RojandariStated: SumStated(allAssignments.Where(a => a.ContractUnit is null)),
            UkteAgreed: SumStated(allAssignments.Where(a => a.ContractUnit is not null)),
            OnFarmToday: SumKnownHeadcounts(todays),
            RojandariToday: SumKnownHeadcounts(todays.Where(a => a.ContractUnit is null)),
            UkteToday: SumKnownHeadcounts(todays.Where(a => a.ContractUnit is not null)));
    }
```

Call it after the `todaysLogIdSet` loop (`:729`):
`var home = BuildLabourHome(allAssignments, todaysLogIdSet);` and thread it into the
construction from Task 2:
`var built = new LabourDataDto(topLevelIds, people, dashboard, ledger, review, attendance, View: "owner", Home: home);`

Extend `ApplyRegisterView`'s non-owner branch (before the final `return`):
`var home = dto.Home with { RojandariStated = null, UkteAgreed = null };` and add `Home = home,`
to the `with` — headcounts survive (attendance is safe for anyone; money is not).

Update `LabourRegisterViewTests.FullDto()` and any other `LabourDataDto` construction the
compiler names with `Home:` values.

- [ ] **Step 4: Run backend tests**

```
dotnet test src/tests/ShramSafal.Domain.Tests/
```
Expected: PASS, including the reshaped view tests.

- [ ] **Step 5: Frontend — cards and the headcount line, owner-view gated**

1. `labour.types.ts`: add

```ts
/** Master review D6 — the Labour home's two money truths + आज कामावर. Never combined. */
export interface LabourHome {
    rojandariStated: number | null;
    ukteAgreed: number | null;
    onFarmToday: number | null;
    rojandariToday: number | null;
    ukteToday: number | null;
}
```

   and `home: LabourHome;` on `LabourData`.
2. `labourClient.ts`: wire `home: { rojandariStated: number | null; ukteAgreed: number | null;
   onFarmToday: number | null; rojandariToday: number | null; ukteToday: number | null; };` on
   `LabourDataDto`; map straight through with an old-server fallback:
   `home: dto.home ?? { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },`
3. `labourMock.ts`: `EMPTY_LABOUR_DATA.home` = all nulls;
   `LABOUR_MOCK.home = { rojandariStated: 4650, ukteAgreed: 12000, onFarmToday: 12, rojandariToday: 4, ukteToday: 8 }`.
4. `LabourHub.tsx` — insert directly ABOVE the QuickTile grid (`:336`), importing `inr` from
   `../labourMock`:

```tsx
        {/* D6 (master review 2026-09-02) — one Labour, TWO money truths, never
            one figure. Owner view only: D-H8 keeps money off every non-owner
            surface, and the server has already stripped it — this gate only
            spares the owner-shaped empty shells. Blanks are '—', never ₹0. */}
        {data.view === 'owner' && (
            <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-[20px] border border-stone-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <span className="block text-[16px] font-bold text-stone-600">रोजंदारी</span>
                    <span className="block text-[13px] font-semibold text-stone-400">नोंदलेली</span>
                    <span className="mt-1 block text-[23px] font-black text-stone-800 [font-variant-numeric:tabular-nums]">{data.home.rojandariStated === null ? '—' : inr(data.home.rojandariStated)}</span>
                </div>
                <div className="rounded-[20px] border border-violet-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <span className="block text-[16px] font-bold text-violet-700">उक्ते काम</span>
                    <span className="block text-[13px] font-semibold text-stone-400">ठरलेली</span>
                    <span className="mt-1 block text-[23px] font-black text-stone-800 [font-variant-numeric:tabular-nums]">{data.home.ukteAgreed === null ? '—' : inr(data.home.ukteAgreed)}</span>
                </div>
            </div>
        )}

        {/* आज कामावर N जण — x रोजंदारी · y उक्ते. Whole count first; the
            arrangement is a breakdown, not a filter. Renders only when a count
            was actually stated — an unknown day says nothing, never 0. All
            views: attendance counts are safe for anyone (D-H8). Latin digits
            (approved numeral convention). */}
        {data.home.onFarmToday !== null && (
            <div className="rounded-[20px] border border-stone-100 bg-white p-3.5 text-[19px] font-bold text-stone-800 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                आज कामावर {data.home.onFarmToday} जण
                {(data.home.rojandariToday !== null || data.home.ukteToday !== null) && (
                    <span className="text-[16px] font-semibold text-stone-500">
                        {' — '}
                        {[
                            data.home.rojandariToday !== null ? `${data.home.rojandariToday} रोजंदारी` : null,
                            data.home.ukteToday !== null ? `${data.home.ukteToday} उक्ते` : null,
                        ].filter((s) => s !== null).join(' · ')}
                    </span>
                )}
            </div>
        )}
```

5. Append to the Task 5 test file (`HajeriLedgerTotals.test.tsx`):

```tsx
describe('LabourHub — D6: two money truths, never one figure', () => {
    const hub = (data: LabourData) => render(
        <LabourHub
            data={data}
            onOpenMukadam={vi.fn()} onOpenPerson={vi.fn()} onAttendance={vi.fn()}
            onDashboard={vi.fn()} onLedger={vi.fn()} onReview={vi.fn()} onGoToLog={vi.fn()}
        />);

    it('shows both cards separately and never a combined figure', () => {
        const { container } = hub({ ...LABOUR_MOCK, home: { rojandariStated: 4650, ukteAgreed: 12000, onFarmToday: 12, rojandariToday: 4, ukteToday: 8 } });
        expect(container.textContent).toContain('रोजंदारी');
        expect(container.textContent).toContain('नोंदलेली');
        expect(container.textContent).toContain('उक्ते काम');
        expect(container.textContent).toContain('ठरलेली');
        expect(container.textContent).not.toContain('16,650'); // the forbidden combined figure
        expect(container.textContent).toContain('आज कामावर 12 जण');
        expect(container.textContent).toContain('4 रोजंदारी');
        expect(container.textContent).toContain('8 उक्ते');
    });

    it('a day with no stated money shows blanks, not zeros; unknown headcount says nothing', () => {
        const { container } = hub({ ...LABOUR_MOCK, home: { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null } });
        expect(container.textContent).toContain('—');
        expect(container.textContent).not.toContain('₹0');
        expect(container.textContent).not.toContain('आज कामावर');
    });

    it('a non-owner view renders no money cards at all', () => {
        const { container } = hub({ ...LABOUR_MOCK, view: 'crew', home: { ...LABOUR_MOCK.home, rojandariStated: null, ukteAgreed: null } });
        expect(container.textContent).not.toContain('नोंदलेली');
        expect(container.textContent).not.toContain('ठरलेली');
    });
});
```

- [ ] **Step 6: Run everything**

```
cd src/clients/mobile-web && npx tsc --noEmit && npx vitest run src/features/labour
cd ../../.. && dotnet test src/tests/ShramSafal.Domain.Tests/ && dotnet test src/tests/AgriSync.ArchitectureTests/
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application \
        src/clients/mobile-web/src/features/labour \
        src/tests/ShramSafal.Domain.Tests/Labour
git commit -m "feat(labour): labour-home money split — रोजंदारी नोंदलेली and उक्ते ठरलेली, never one figure"
```

---

## Phase self-review checklist (run before handing to the checker)

- [ ] Every brief item mapped: 4.0→Task 5, 4.1+4.4→Tasks 1+2+3, 4.2→Task 6, 4.3→Task 7,
      4.5→Task 4, 4.6→Task 8, D-H8 views→Task 2.
- [ ] No money member, no numeric aggregate anywhere in the grid contract
      (`TheGridContractCarriesNoAggregateAndNoMoney` is the pin).
- [ ] `AttendanceMark.Value` is `[Obsolete]` and consumed by nothing in production.
- [ ] Blank ≠ zero at every site touched: nulls render `—` or nothing, never `0`/`₹0`.
- [ ] No new farmer-facing Marathi outside the harvested/approved list; the two comments that
      lied (`attendanceDraft.ts` header, `LabourHub` flag references) are rewritten, not left.
- [ ] No migration, no grant, no RLS change in this phase.
- [ ] The mic shell, ShramSathi processing screen, capture flows: untouched by every task here.

## Founder gate (before any deploy step)

Phase 4 is code-complete when all eight tasks are committed and green. It is NOT approved, NOT
merged, NOT deployed. Pointers for the founder's verification: open `?preview=labour` → हजेरी वही
(clean grid, split cells, crew row, tap-detail) and the Labour home (two cards + आज कामावर line);
`dotnet test src/tests/ShramSafal.Domain.Tests/` and `npx vitest run src/features/labour` outputs.
