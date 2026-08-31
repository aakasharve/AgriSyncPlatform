using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// STAGE 5 — the हजेरी वही, built from labour rows that finally carry names.
///
/// The founder asked repeatedly why the register was always missing. It was
/// hardcoded empty server-side ("empty by design until Stage 5") and could not
/// have been anything else: the names reader in LedgerDerivationService pointed
/// at a key the prompt never emitted, so WorkerNamesJson was "[]" on every row
/// ever written. With names persisting, the register derives from data that
/// already exists — no new table.
///
/// These pin the rules that make it a REGISTER rather than an accusation.
/// </summary>
public sealed class BuildHajeriLedgerTests
{
    private static readonly Guid FarmId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);

    private static DailyLog LogOn(Guid id, DateOnly date) => DailyLog.CreateForFarm(
        id, FarmId, Actor, date, idempotencyKey: null, location: null, createdAtUtc: CreatedAtUtc);

    private static LabourAssignment Named(
        Guid logId, IReadOnlyList<string> names, LabourShift shift = LabourShift.Full)
        => LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: logId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: names.Count,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed(),
            shift: shift,
            task: null,
            workerNames: names);

    /// <summary>
    /// THE RULE THIS SCREEN EXISTS FOR. A day a person was not named is NOT a day
    /// he was absent — nobody said that. A muster roll that turns silence into
    /// absence is an accusation, and it is the one fact this register must never
    /// invent.
    /// </summary>
    [Fact]
    public void AnUnnamedDayIsNullNotAbsent()
    {
        var mondayId = Guid.NewGuid();
        var tuesdayId = Guid.NewGuid();
        var logs = new List<DailyLog>
        {
            LogOn(mondayId, new DateOnly(2026, 8, 24)),
            LogOn(tuesdayId, new DateOnly(2026, 8, 25)),
        };
        var assignments = new List<LabourAssignment>
        {
            Named(mondayId, ["रमेश"]),
            Named(tuesdayId, ["सुनीता"]),
        };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 2m);

        var ramesh = ledger.Rows.Single(r => r.Name == "रमेश");
        Assert.Equal(2, ramesh.Cells.Count);
        Assert.Equal("present", ramesh.Cells[0]);
        Assert.Null(ramesh.Cells[1]);
        Assert.Equal(1m, ramesh.Total);
        Assert.DoesNotContain("absent", ledger.Rows.SelectMany(r => r.Cells));
    }

    /// <summary>A half shift is half a day, never rounded up to a whole one.</summary>
    [Fact]
    public void AHalfShiftIsPointFive()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment> { Named(logId, ["रमेश"], LabourShift.Half) };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 1m);

        Assert.Equal("half", ledger.Rows.Single().Cells[0]);
        Assert.Equal(0.5m, ledger.Rows.Single().Total);
        Assert.Equal(0.5m, ledger.DailyTotals.Single());
    }

    /// <summary>
    /// If the farmer stated a FULL shift anywhere on a day, the person was there a
    /// full day by his own word. A second, half-shift row must not shrink it.
    /// </summary>
    [Fact]
    public void PresentOutranksHalfOnTheSameDay()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment>
        {
            Named(logId, ["रमेश"], LabourShift.Half),
            Named(logId, ["रमेश"], LabourShift.Full),
        };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 2m);

        Assert.Single(ledger.Rows);
        Assert.Equal("present", ledger.Rows.Single().Cells[0]);
        Assert.Equal(1m, ledger.Rows.Single().Total);
    }

    /// <summary>
    /// A headcount with nobody named produces NO register. An empty one is the
    /// honest answer; a grid of dashes would read as everyone being absent.
    /// </summary>
    [Fact]
    public void NobodyNamedYieldsAnEmptyRegisterNotAZeroedOne()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment> { Named(logId, []) };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 4m);

        Assert.Empty(ledger.Rows);
        Assert.Empty(ledger.Days);
        Assert.Empty(ledger.DailyTotals);
    }

    /// <summary>
    /// WeekTotal is the REGISTER own sum, not मजूर-दिवस. They answer different
    /// questions — man-days counts every stated headcount including crews nobody
    /// named — and giving both the same number is how a screen starts lying.
    /// </summary>
    [Fact]
    public void WeekTotalIsTheRegisterSumNotManDays()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment> { Named(logId, ["रमेश", "सुनीता"]) };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 40m);

        Assert.Equal(2m, ledger.WeekTotal);
    }

    /// <summary>
    /// A day enters the register once, in date order, and the column total is the
    /// sum down that column.
    /// </summary>
    [Fact]
    public void DaysAreDistinctOrderedAndColumnTotalled()
    {
        var d1 = Guid.NewGuid();
        var d2 = Guid.NewGuid();
        var logs = new List<DailyLog>
        {
            LogOn(d2, new DateOnly(2026, 8, 25)),
            LogOn(d1, new DateOnly(2026, 8, 24)),
        };
        var assignments = new List<LabourAssignment>
        {
            Named(d1, ["रमेश", "सुनीता"]),
            Named(d2, ["रमेश"], LabourShift.Half),
        };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 3m);

        Assert.Equal(["2026-08-24", "2026-08-25"], ledger.Days);
        Assert.Equal([2m, 0.5m], ledger.DailyTotals);
    }

    /// <summary>
    /// The avatar initial must be a whole Devanagari letter with its matras, not a
    /// sliced UTF-16 unit that renders as a broken glyph.
    /// </summary>
    [Fact]
    public void TheInitialIsAWholeDevanagariLetter()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment> { Named(logId, ["कांतीलाल घोडगे"]) };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 1m);

        Assert.Equal("कां", ledger.Rows.Single().Initial);
    }

    /// <summary>
    /// A spoken name carries no identity. PersonId is a grouping key and must
    /// never be mistaken for a worker id, so it is deliberately not a Guid.
    /// </summary>
    [Fact]
    public void PersonIdIsANameKeyNotAWorkerId()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { LogOn(logId, new DateOnly(2026, 8, 24)) };
        var assignments = new List<LabourAssignment> { Named(logId, ["रमेश"]) };

        var ledger = GetLabourDataHandler.BuildHajeriLedger("", logs, assignments, manDays: 1m);

        Assert.Equal("name:रमेश", ledger.Rows.Single().PersonId);
        Assert.False(Guid.TryParse(ledger.Rows.Single().PersonId, out _));
    }
}
