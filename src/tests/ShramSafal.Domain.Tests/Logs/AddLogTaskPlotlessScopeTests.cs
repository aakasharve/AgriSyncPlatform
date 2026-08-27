using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR_PHASE2 P2.3 — adding a task to a log that names no crop cycle.
///
/// <para><c>AddLogTaskHandler</c> is the ONLY production path that puts a
/// <c>LogTask</c> on a <c>DailyLog</c>. If it refuses a cycle-less parent, then
/// a <c>Farm</c>-scoped log can never carry a single task: the farmer says
/// "आज संपूर्ण शेतात फवारणी केली" and the record of the फवारणी is rejected
/// outright. The schedule-compliance stamp is the optional part, so the
/// optional part must yield — not the record (<c>P9</c>).</para>
///
/// <para>The honest result is a task whose <c>Compliance</c> is null, which is
/// exactly what that property already documents ("the evaluator was never
/// run"). We deliberately do NOT stamp <c>ComplianceResult.Unscheduled()</c>
/// instead: that asserts a plot-crop-cycle was checked and had no active
/// subscription, and no such check happened (<c>P8</c>).</para>
/// </summary>
public sealed class AddLogTaskPlotlessScopeTests
{
    private static readonly DateTime Now = new(2026, 6, 20, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid OwnerGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task farm_scoped_log_accepts_a_task()
    {
        var (handler, repo, logId) = Build(MakeFarmLog());

        var result = await handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "फवारणी",
            Notes: null,
            ActorUserId: OwnerGuid));

        result.IsSuccess.Should().BeTrue(
            "a farm-wide log must be able to carry the work the farmer described");
        result.Value!.Tasks.Should().ContainSingle();

        var stored = await repo.GetDailyLogByIdAsync(logId);
        stored!.Tasks.Should().ContainSingle();
    }

    [Fact]
    public async Task farm_scoped_log_task_carries_no_compliance_verdict()
    {
        var (handler, repo, logId) = Build(MakeFarmLog());

        await handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "फवारणी",
            Notes: null,
            ActorUserId: OwnerGuid));

        var stored = await repo.GetDailyLogByIdAsync(logId);
        stored!.Tasks.Single().Compliance.Should().BeNull(
            "there is no crop-cycle schedule for the whole farm, so there is no verdict to give");
    }

    [Fact]
    public async Task multi_plot_log_accepts_a_task_too()
    {
        var (handler, repo, logId) = Build(MakeMultiPlotLog());

        var result = await handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "फवारणी",
            Notes: null,
            ActorUserId: OwnerGuid));

        result.IsSuccess.Should().BeTrue();
        var stored = await repo.GetDailyLogByIdAsync(logId);
        stored!.Tasks.Single().Compliance.Should().BeNull();
    }

    [Fact]
    public async Task plot_scoped_log_is_still_stamped_with_a_compliance_verdict()
    {
        var (handler, repo, logId) = Build(MakePlotLog(), seedCropCycle: true);

        var result = await handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "फवारणी",
            Notes: null,
            ActorUserId: OwnerGuid));

        result.IsSuccess.Should().BeTrue();
        var stored = await repo.GetDailyLogByIdAsync(logId);
        stored!.Tasks.Single().Compliance.Should().NotBeNull(
            "the Labour V1 behaviour for a plot-scoped log is unchanged");
    }

    [Fact]
    public async Task plot_scoped_log_whose_cycle_row_is_missing_still_fails_CropCycleNotFound()
    {
        // The V1 error path, untouched: this log NAMES a cycle and the cycle is
        // genuinely absent. That is a real not-found, unlike a farm-wide log,
        // which was never supposed to have one.
        var (handler, _, logId) = Build(MakePlotLog(), seedCropCycle: false);

        var result = await handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "फवारणी",
            Notes: null,
            ActorUserId: OwnerGuid));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.CropCycleNotFound");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static (AddLogTaskHandler handler, InMemoryShramSafalRepository repo, Guid logId) Build(
        DailyLog log, bool seedCropCycle = false)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.SetMembership(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);

        if (seedCropCycle)
        {
            repo.AddCropCycle(CropCycle.Create(
                CropCycleGuid, new FarmId(FarmGuid), PlotGuid, "Grapes", "Vegetative",
                new DateOnly(2026, 1, 1), null, Now));
        }

        var handler = new AddLogTaskHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(Now),
            new AllowAllEntitlementPolicy(),
            new UnscheduledComplianceService());

        return (handler, repo, log.Id);
    }

    private static DailyLog MakePlotLog()
        => DailyLog.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), PlotGuid, CropCycleGuid,
            new UserId(OwnerGuid), new DateOnly(2026, 6, 20), null, null, Now);

    private static DailyLog MakeMultiPlotLog()
        => DailyLog.CreateForMultiPlot(
            Guid.NewGuid(), new FarmId(FarmGuid), [PlotGuid, Guid.NewGuid()],
            new UserId(OwnerGuid), new DateOnly(2026, 6, 20), null, null, Now);

    private static DailyLog MakeFarmLog()
        => DailyLog.CreateForFarm(
            Guid.NewGuid(), new FarmId(FarmGuid),
            new UserId(OwnerGuid), new DateOnly(2026, 6, 20), null, null, Now);

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    /// <summary>
    /// Returns a REAL (if empty) verdict, so "Compliance is null" in these tests
    /// can only mean the evaluator was never called — not that it was called and
    /// returned nothing.
    /// </summary>
    private sealed class UnscheduledComplianceService : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }
}
