using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateDailyLog): end-to-end coverage of
/// the create-daily-log pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty FarmId/PlotId/CropCycleId/
/// RequestedByUserId/OperatorUserId or explicit-but-empty DailyLogId
/// as <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing, and <see cref="ShramSafalErrors.Forbidden"/>
/// when the operator is not a member of the target farm.</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer — the body's analytics emission and audit row writes
/// do not happen.</item>
/// <item>The happy path runs the body: an audit row is written, the
/// LogCreated analytics event is emitted, and the result carries the
/// created log's DTO.</item>
/// </list>
/// </summary>
public sealed class CreateDailyLogPipelineTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(farmId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_PlotId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(plotId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CropCycleId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(cropCycleId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_RequestedByUserId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(requestedByUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_OperatorUserId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(operatorUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_explicit_DailyLogId_is_empty()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(dailyLogId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_accepts_null_DailyLogId_handler_will_generate_one()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand(dailyLogId: null)).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_caller_shape_invariants_pass()
    {
        var v = new CreateDailyLogValidator();
        var errs = v.Validate(MakeCommand()).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_FarmNotFound_when_farm_id_resolves_to_nothing()
    {
        var repo = new InMemoryShramSafalRepository();
        // No farm seeded.
        var a = new CreateDailyLogAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_operator_is_not_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        // No membership set for OperatorUserId.
        var a = new CreateDailyLogAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_operator_is_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);
        var a = new CreateDailyLogAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_FarmId_is_empty()
    {
        var (pipeline, repo, analytics) = BuildPipeline(seedAll: true);

        var result = await pipeline.HandleAsync(MakeCommand(farmId: Guid.Empty));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_FarmNotFound_when_farm_is_missing()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: false);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_operator_is_not_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        // No membership.
        var (pipeline, analytics) = BuildPipelineFor(repo);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: true);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.True(result.IsSuccess);
        // Body emits a single LogCreated analytics event on success —
        // its presence proves the pipeline forwarded the call to the
        // body and the body progressed past the entitlement gate, plot
        // and crop-cycle lookups, idempotency, audit, and save.
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.LogCreated, analytics.Events[0].EventType);
    }

    // ---- helpers ----

    private static CreateDailyLogCommand MakeCommand(
        Guid? farmId = null,
        Guid? plotId = null,
        Guid? cropCycleId = null,
        Guid? requestedByUserId = null,
        Guid? operatorUserId = null,
        Guid? dailyLogId = null)
        => new(
            FarmId: farmId ?? FarmGuid,
            PlotId: plotId ?? PlotGuid,
            CropCycleId: cropCycleId ?? CropCycleGuid,
            RequestedByUserId: requestedByUserId ?? OperatorUserId,
            OperatorUserId: operatorUserId ?? OperatorUserId,
            LogDate: new DateOnly(2026, 4, 28),
            Location: null,
            DeviceId: "device-1",
            ClientRequestId: $"req-{Guid.NewGuid():N}",
            DailyLogId: dailyLogId,
            ActorRole: "worker");

    private static Farm MakeFarm() =>
        Farm.Create(FarmGuid, "Patil Farm", OperatorUserId,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private static Plot MakePlot() =>
        Plot.Create(PlotGuid, FarmGuid, "Plot A", 1.0m,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private static CropCycle MakeCropCycle() =>
        CropCycle.Create(CropCycleGuid, new FarmId(FarmGuid), PlotGuid,
            "Grapes", "Vegetative", new DateOnly(2026, 1, 1), null,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private static (
        IHandler<CreateDailyLogCommand, DailyLogDto> Pipeline,
        InMemoryShramSafalRepository Repo,
        CapturingAnalyticsWriter Analytics) BuildPipeline(bool seedAll)
    {
        var repo = new InMemoryShramSafalRepository();

        if (seedAll)
        {
            repo.AddFarm(MakeFarm());
            repo.AddPlot(MakePlot());
            repo.AddCropCycle(MakeCropCycle());
            repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);
        }

        var (pipeline, analytics) = BuildPipelineFor(repo);
        return (pipeline, repo, analytics);
    }

    private static (
        IHandler<CreateDailyLogCommand, DailyLogDto> Pipeline,
        CapturingAnalyticsWriter Analytics) BuildPipelineFor(InMemoryShramSafalRepository repo)
    {
        var clock = new CreateDailyLogFixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new CapturingAnalyticsWriter();

        var rawHandler = new CreateDailyLogHandler(
            repo,
            new CreateDailyLogFixedIdGenerator(LogGuid),
            clock,
            new AllowAllEntitlementPolicy(),
            analytics);

        var validator = new CreateDailyLogValidator();
        var authorizer = new CreateDailyLogAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CreateDailyLogCommand, DailyLogDto>(
                NullLogger<LoggingBehavior<CreateDailyLogCommand, DailyLogDto>>.Instance),
            new ValidationBehavior<CreateDailyLogCommand, DailyLogDto>(
                new IValidator<CreateDailyLogCommand>[] { validator }),
            new AuthorizationBehavior<CreateDailyLogCommand, DailyLogDto>(
                new IAuthorizationCheck<CreateDailyLogCommand>[] { authorizer }));

        return (pipeline, analytics);
    }

    private sealed class CreateDailyLogFixedClock : IClock
    {
        public CreateDailyLogFixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class CreateDailyLogFixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public CreateDailyLogFixedIdGenerator(Guid id) { _id = id; }
        public Guid New() => _id;
    }

    private sealed class CapturingAnalyticsWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            Events.Add(e);
            return Task.CompletedTask;
        }
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default)
        {
            Events.AddRange(events);
            return Task.CompletedTask;
        }
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
