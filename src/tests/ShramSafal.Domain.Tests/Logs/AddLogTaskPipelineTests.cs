using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): end-to-end coverage of the
/// add-log-task pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs / missing ActivityType /
/// explicit-but-empty LogTaskId as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.DailyLogNotFound"/> when the log id
/// resolves to nothing, and <see cref="ShramSafalErrors.Forbidden"/>
/// when the caller is not a member of the log's farm — preserving the
/// canonical <c>InvalidCommand → DailyLogNotFound → Forbidden</c>
/// ordering when chained behind the validator.</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer, leaving the inner handler body un-invoked (no audit
/// row written).</item>
/// <item>The happy path runs the body: an audit row is written and
/// the result carries the updated DailyLog DTO.</item>
/// </list>
/// </summary>
public sealed class AddLogTaskPipelineTests
{
    private static readonly Guid ActorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OperatorUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid FarmGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid LogGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid PlotGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid CropCycleGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_DailyLogId_is_empty()
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: Guid.Empty,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_ActorUserId_is_empty()
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validator_yields_InvalidCommand_when_ActivityType_is_blank(string? activityType)
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: activityType!,
            Notes: null,
            ActorUserId: ActorUserId)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_explicit_LogTaskId_is_empty()
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            LogTaskId: Guid.Empty,
            ActorUserId: ActorUserId)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_accepts_null_LogTaskId_handler_will_generate_one()
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            LogTaskId: null,
            ActorUserId: ActorUserId)).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_caller_shape_invariants_pass()
    {
        var v = new AddLogTaskValidator();
        var errs = v.Validate(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: "trace",
            LogTaskId: Guid.Parse("77777777-7777-7777-7777-777777777777"),
            ActorUserId: ActorUserId)).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_DailyLogNotFound_when_log_id_resolves_to_nothing()
    {
        var repo = new InMemoryShramSafalRepository();
        // No log seeded — GetDailyLogByIdAsync returns null.
        var a = new AddLogTaskAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.DailyLogNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member_of_the_logs_farm()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(MakeLog());
        // No membership set for ActorUserId on FarmGuid.
        var a = new AddLogTaskAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_a_member_of_the_logs_farm()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(MakeLog());
        repo.SetMembership(FarmGuid, ActorUserId, AppRole.Worker);
        var a = new AddLogTaskAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_ActivityType_is_blank()
    {
        var (pipeline, repo) = BuildPipeline(seedLogAndMembership: true);

        var result = await pipeline.HandleAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "",
            Notes: null,
            ActorUserId: ActorUserId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Inner handler writes one audit row on the success path — its
        // absence proves the body did not run.
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_DailyLogNotFound_when_log_is_missing()
    {
        var (pipeline, repo) = BuildPipeline(seedLogAndMembership: false);

        var result = await pipeline.HandleAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.DailyLogNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_caller_is_not_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(MakeLog());
        repo.AddCropCycle(MakeCropCycle());
        // No membership set.
        var pipeline = BuildPipelineFor(repo);

        var result = await pipeline.HandleAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: null,
            ActorUserId: ActorUserId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (pipeline, repo) = BuildPipeline(seedLogAndMembership: true);

        var result = await pipeline.HandleAsync(new AddLogTaskCommand(
            DailyLogId: LogGuid,
            ActivityType: "spray",
            Notes: "rain delayed",
            ActorUserId: ActorUserId,
            ActorRole: "worker",
            ClientCommandId: "cmd-pipeline-1"));

        Assert.True(result.IsSuccess);
        // Body emits a TaskAdded audit row before SaveChangesAsync —
        // its presence proves the pipeline forwarded the call to the
        // body and the body progressed past the entitlement gate,
        // crop-cycle lookup, deviation-reason policy (Completed status,
        // no deviation code), and AddTask.
        Assert.Single(repo.AuditEvents);
        Assert.Equal("TaskAdded", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static DailyLog MakeLog() => DailyLog.Create(
        id: LogGuid,
        farmId: new FarmId(FarmGuid),
        plotId: PlotGuid,
        cropCycleId: CropCycleGuid,
        operatorUserId: new UserId(OperatorUserId),
        logDate: new DateOnly(2026, 4, 28),
        idempotencyKey: null,
        location: null,
        createdAtUtc: new DateTime(2026, 4, 28, 10, 0, 0, DateTimeKind.Utc));

    private static CropCycle MakeCropCycle() => CropCycle.Create(
        CropCycleGuid,
        new FarmId(FarmGuid),
        PlotGuid,
        "Grapes",
        "Vegetative",
        new DateOnly(2026, 1, 1),
        null,
        new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private static (
        IHandler<AddLogTaskCommand, DailyLogDto> Pipeline,
        InMemoryShramSafalRepository Repo) BuildPipeline(bool seedLogAndMembership)
    {
        var repo = new InMemoryShramSafalRepository();

        if (seedLogAndMembership)
        {
            repo.AddLog(MakeLog());
            repo.AddCropCycle(MakeCropCycle());
            repo.SetMembership(FarmGuid, ActorUserId, AppRole.Worker);
        }

        return (BuildPipelineFor(repo), repo);
    }

    private static IHandler<AddLogTaskCommand, DailyLogDto> BuildPipelineFor(InMemoryShramSafalRepository repo)
    {
        var clock = new AddLogTaskFixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var rawHandler = new AddLogTaskHandler(
            repo,
            new AddLogTaskFixedIdGenerator(Guid.Parse("88888888-8888-8888-8888-888888888888")),
            clock,
            new AllowAllEntitlementPolicy(),
            new NoopComplianceService());

        var validator = new AddLogTaskValidator();
        var authorizer = new AddLogTaskAuthorizer(repo);

        return HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<AddLogTaskCommand, DailyLogDto>(
                NullLogger<LoggingBehavior<AddLogTaskCommand, DailyLogDto>>.Instance),
            new ValidationBehavior<AddLogTaskCommand, DailyLogDto>(
                new IValidator<AddLogTaskCommand>[] { validator }),
            new AuthorizationBehavior<AddLogTaskCommand, DailyLogDto>(
                new IAuthorizationCheck<AddLogTaskCommand>[] { authorizer }));
    }

    private sealed class AddLogTaskFixedClock : IClock
    {
        public AddLogTaskFixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class AddLogTaskFixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public AddLogTaskFixedIdGenerator(Guid id) { _id = id; }
        public Guid New() => _id;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopComplianceService : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }
}
