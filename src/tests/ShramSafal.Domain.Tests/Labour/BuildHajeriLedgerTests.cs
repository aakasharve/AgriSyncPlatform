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

    /// <summary>
    /// Phase 5 walk (Task 1 review carry) — DUPLICATE-MARK INPUT, pinned so
    /// the degraded mode is a decision, not an accident. Two marks for the
    /// same (operator, day) cannot exist through any production door: the
    /// single producer (LabourAnchorRules PIN 3) amends-in-place on repeat,
    /// and the partial unique index refuses a second canonical row with 23505
    /// (AttendanceMarkUniqueIndexRealPostgresTests). If that invariant ever
    /// broke anyway, the builder's <c>cells[index] = …</c> assignment makes
    /// the LAST mark in repository order win — one row, one cell, silently.
    /// This pin names that behaviour; changing it (throw, first-wins, both)
    /// must be deliberate and must land next to the index it distrusts.
    /// </summary>
    [Fact]
    public void ADuplicatePersonDayIsLastMarkWinsOneRowOneCellBehindTheIndex()
    {
        var ganesh = Guid.NewGuid();

        var ledger = Build(
            [
                Mark(ganesh, Monday, DayMark.Full),
                Mark(ganesh, Monday, DayMark.Absent), // unreachable in prod; last in list
            ],
            [Operator(ganesh, "गणेश")]);

        var row = Assert.Single(ledger.Rows);   // never a doubled row
        var cell = row.Cells[0]!;
        Assert.Equal("absent", cell.Day);       // the later statement, whole
        Assert.Single(row.Cells, c => c is not null); // and only one cell
    }
}
