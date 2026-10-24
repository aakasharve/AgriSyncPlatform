using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class LabourAssignmentTests
{
    private static readonly Guid Log = Guid.Parse("66666666-6666-6666-6666-666666666666");

    [Fact]
    public void Create_hired_sets_fields()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: 3, femaleCount: 2, workerCount: 5, wagePerPerson: 350m,
            contractUnit: null, contractQuantity: null, totalCost: 1750m, linkedActivityId: null,
            createdAtUtc: new DateTime(2025, 10, 21, 0, 0, 0, DateTimeKind.Utc), time: LabourTime.ServerAssumed());
        Assert.Equal(Log, la.DailyLogId);
        Assert.Equal(LabourEngagementType.Hired, la.EngagementType);
        Assert.Equal(3, la.MaleCount);
        Assert.Equal(2, la.FemaleCount);
        Assert.Equal(5, la.WorkerCount);
        Assert.Equal(350m, la.WagePerPerson);
        Assert.Null(la.ContractUnit);
        Assert.Equal(1750m, la.TotalCost);
    }

    /// <summary>
    /// B002 (Labour V2 R1, 3.3 review carried to 3.5) — the name pipe's
    /// server-authoritative write boundary trims spoken names and drops
    /// whitespace-only entries, so 'गणेश ' and 'गणेश' cannot become two
    /// people on the record or mask a name-keyed contradiction. It must NOT
    /// dedupe: identical names are legitimate (two real people called बाळू),
    /// and merging is identity resolution's job, never serialization's.
    /// </summary>
    [Fact]
    public void Create_trims_worker_names_and_drops_blanks_but_never_dedupes()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            null, null, workerCount: 3, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed(),
            workerNames: [" गणेश ", "गणेश", "   ", "बाळू", "बाळू"]);

        Assert.Equal("[\"गणेश\",\"गणेश\",\"बाळू\",\"बाळू\"]", la.WorkerNamesJson);
    }

    [Fact]
    public void Create_contract_sets_unit_and_quantity()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Contract,
            null, null, null, wagePerPerson: 50m,
            contractUnit: ContractUnit.Tree, contractQuantity: 120m, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed());
        Assert.Equal(LabourEngagementType.Contract, la.EngagementType);
        Assert.Equal(ContractUnit.Tree, la.ContractUnit);
        Assert.Equal(120m, la.ContractQuantity);
    }

    // THE load-bearing honesty invariant (ADR §1 / plan §3.2d): a per-unit rate with
    // no farmer-stated total persists with TotalCost == null — NEVER rate × count.
    [Fact]
    public void Create_does_not_fabricate_total_from_rate_times_count()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Contract,
            null, null, workerCount: 4, wagePerPerson: 50m,
            contractUnit: ContractUnit.Tree, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed());
        Assert.Null(la.TotalCost);            // not 50*4=200 — no fabricated total
        Assert.Equal(50m, la.WagePerPerson);
        Assert.Equal(4, la.WorkerCount);
    }

    [Fact]
    public void Create_self_allows_all_null_counts()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Self,
            null, null, null, null, null, null, null, null, DateTime.UtcNow, LabourTime.ServerAssumed());
        Assert.Equal(LabourEngagementType.Self, la.EngagementType);
        Assert.Null(la.WorkerCount);
        Assert.Null(la.WagePerPerson);
        Assert.Null(la.TotalCost);
    }

    // Task 2.1 — descriptive surface: shift/task/worker names (NOT money).
    [Fact]
    public void Create_sets_shift_task_and_worker_names()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: 2, femaleCount: 0, workerCount: 2, wagePerPerson: 300m,
            contractUnit: null, contractQuantity: null, totalCost: 600m, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed(),
            shift: LabourShift.Half, task: "फवारणी", workerNames: ["रमेश", "विलास"]);

        Assert.Equal(LabourShift.Half, la.Shift);
        Assert.Equal("फवारणी", la.Task);
        Assert.Contains("रमेश", la.WorkerNamesJson);
        Assert.Contains("विलास", la.WorkerNamesJson);
    }

    [Fact]
    public void Create_omitting_descriptive_fields_defaults_to_null_and_empty_array()
    {
        var la = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: 1, femaleCount: 0, workerCount: 1, wagePerPerson: 300m,
            contractUnit: null, contractQuantity: null, totalCost: 300m, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed());

        Assert.Null(la.Shift);
        Assert.Null(la.Task);
        Assert.Equal("[]", la.WorkerNamesJson);
    }

    // Money-guard: descriptive params must never influence TotalCost/WagePerPerson.
    // NO-MULTIPLY stays intact regardless of shift/task/workerNames being supplied.
    [Fact]
    public void Create_descriptive_fields_do_not_alter_money_fields()
    {
        var withDescriptive = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Contract,
            null, null, workerCount: 4, wagePerPerson: 50m,
            contractUnit: ContractUnit.Tree, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed(),
            shift: LabourShift.Full, task: "छाटणी", workerNames: ["सचिन"]);

        Assert.Null(withDescriptive.TotalCost);           // still not fabricated (50*4)
        Assert.Equal(50m, withDescriptive.WagePerPerson);  // unchanged by descriptive fields

        var withStatedTotal = LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: 3, femaleCount: 2, workerCount: 5, wagePerPerson: 350m,
            contractUnit: null, contractQuantity: null, totalCost: 1800m, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed(),
            shift: LabourShift.Night, task: null, workerNames: null);

        Assert.Equal(1800m, withStatedTotal.TotalCost);    // stated total preserved exactly
        Assert.Equal(350m, withStatedTotal.WagePerPerson);
    }

    // ── Task 3.6 (spec: 2026-08-28-labour-v2-release-1) — the crew link ──────
    // Final direction §3: THROUGH WHOM this crew was engaged, ENGAGEMENT-scoped.
    // NULL = "nobody said through whom" — never "no mukadam".

    [Fact]
    public void EngagedThroughDefaultsToNullMeaningNobodySaid()
    {
        var a = MinimalAssignment(); // the file's existing builder — reuse it
        Assert.Null(a.EngagedThroughFieldOperatorId);
    }

    [Fact]
    public void EngagedThroughIsStoredWhenStated()
    {
        var through = Guid.NewGuid();
        var a = MinimalAssignment(engagedThroughFieldOperatorId: through);
        Assert.Equal(through, a.EngagedThroughFieldOperatorId);
    }

    /// <summary>
    /// Task 3.6 — the minimal valid engagement, for facts that probe one
    /// property. This file had no builder before 3.6 (every earlier fact
    /// inlines its own <c>Create</c> call, because each asserts on the very
    /// fields it states); it exists from 3.6 onward and forwards only what a
    /// caller states — everything else stays at the factory's own defaults.
    /// </summary>
    private static LabourAssignment MinimalAssignment(Guid? engagedThroughFieldOperatorId = null)
        => LabourAssignment.Create(Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: 4, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: LabourTime.ServerAssumed(),
            engagedThroughFieldOperatorId: engagedThroughFieldOperatorId);
}
