using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): per-stage
/// validator + authorizer coverage and end-to-end pipeline assertions
/// (canonical short-circuit ordering: <c>InvalidCommand →
/// PlannedActivityNotFound → Forbidden → (body)</c>).
/// </summary>
public sealed class OverridePlannedActivityPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid MukadamId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid WorkerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static PlannedActivity MakeActivity(Guid? id = null) =>
        PlannedActivity.CreateFromTemplate(
            id ?? Guid.NewGuid(),
            Guid.NewGuid(),
            "Spray",
            "Flowering",
            new DateOnly(2026, 4, 25),
            Guid.NewGuid(),
            Now.AddDays(-5));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_PlannedActivityId_is_empty()
    {
        var v = new OverridePlannedActivityValidator();
        var errs = v.Validate(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.Empty,
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new OverridePlannedActivityValidator();
        var errs = v.Validate(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: Guid.Empty,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new OverridePlannedActivityValidator();
        var errs = v.Validate(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: Guid.Empty,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Reason_is_blank()
    {
        var v = new OverridePlannedActivityValidator();
        var errs = v.Validate(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "   ",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new OverridePlannedActivityValidator();
        var errs = v.Validate(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: "Spray (revised)",
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: "cmd-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_PlannedActivityNotFound_when_id_resolves_to_nothing()
    {
        var repo = new FakePlanRepo(activity: null, role: AppRole.Mukadam);
        var a = new OverridePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            NewPlannedDate: null,
            NewActivityName: null,
            NewStage: null,
            Reason: "x",
            CallerUserId: MukadamId,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_PlannedActivityNotFound_when_activity_is_soft_removed()
    {
        var activity = MakeActivity();
        // Soft-remove the activity so IsRemoved is true.
        activity.SoftRemove(new AgriSync.SharedKernel.Contracts.Ids.UserId(MukadamId), "obsolete", Now);
        var repo = new FakePlanRepo(activity, AppRole.Mukadam);
        var a = new OverridePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            NewPlannedDate: null,
            NewActivityName: null,
            NewStage: null,
            Reason: "x",
            CallerUserId: MukadamId,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_below_Mukadam()
    {
        var activity = MakeActivity();
        var repo = new FakePlanRepo(activity, AppRole.Worker);
        var a = new OverridePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            NewPlannedDate: null,
            NewActivityName: null,
            NewStage: null,
            Reason: "x",
            CallerUserId: WorkerId,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_Mukadam()
    {
        var activity = MakeActivity();
        var repo = new FakePlanRepo(activity, AppRole.Mukadam);
        var a = new OverridePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            NewPlannedDate: null,
            NewActivityName: null,
            NewStage: null,
            Reason: "x",
            CallerUserId: MukadamId,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_PlannedActivityId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline(MakeActivity(), AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.Empty,
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Body emits an audit row on success — its absence proves the
        // pipeline short-circuited before the handler ran.
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_PlannedActivityNotFound()
    {
        var (pipeline, repo) = BuildPipeline(activity: null, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden()
    {
        var activity = MakeActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Worker);

        var result = await pipeline.HandleAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            NewPlannedDate: new DateOnly(2026, 4, 30),
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: WorkerId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path_and_writes_audit()
    {
        var activity = MakeActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Mukadam);

        var newDate = new DateOnly(2026, 5, 2);
        var result = await pipeline.HandleAsync(new OverridePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            NewPlannedDate: newDate,
            NewActivityName: null,
            NewStage: null,
            Reason: "Rain delay",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.True(result.IsSuccess);
        Assert.Equal(newDate, activity.PlannedDate);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("plan.overridden", repo.AuditEvents[0].Action);
        Assert.Equal(1, repo.SaveCalls);
    }

    // ---- Helpers ----

    private static (
        IHandler<OverridePlannedActivityCommand> Pipeline,
        FakePlanRepo Repo) BuildPipeline(PlannedActivity? activity, AppRole? role)
    {
        var repo = new FakePlanRepo(activity, role);
        var rawHandler = new OverridePlannedActivityHandler(
            repo,
            new FakeSyncMutationStore(),
            new FakeClock(Now));

        var validator = new OverridePlannedActivityValidator();
        var authorizer = new OverridePlannedActivityAuthorizer(repo);

        var pipeline = HandlerPipeline.Build<OverridePlannedActivityCommand>(
            rawHandler,
            new LoggingBehavior<OverridePlannedActivityCommand>(
                NullLogger<LoggingBehavior<OverridePlannedActivityCommand>>.Instance),
            new ValidationBehavior<OverridePlannedActivityCommand>(
                new IValidator<OverridePlannedActivityCommand>[] { validator }),
            new AuthorizationBehavior<OverridePlannedActivityCommand>(
                new IAuthorizationCheck<OverridePlannedActivityCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    /// <summary>
    /// Minimal repo stub that overrides only the methods exercised by the
    /// override pipeline (planned-activity load, role lookup, audit
    /// append, save). Inherits StubShramSafalRepository defaults so any
    /// stray call to an unmocked method surfaces loudly.
    /// </summary>
    private sealed class FakePlanRepo : Work.Handlers.StubShramSafalRepository
    {
        private readonly PlannedActivity? _activity;
        private readonly AppRole? _role;

        public FakePlanRepo(PlannedActivity? activity, AppRole? role)
        {
            _activity = activity;
            _role = role;
        }

        public List<AuditEvent> AuditEvents { get; } = new();
        public int SaveCalls { get; private set; }

        public override Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(_activity?.Id == id ? _activity : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(_role);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeClock : IClock
    {
        private readonly DateTime _now;
        public FakeClock(DateTime now) => _now = now;
        public DateTime UtcNow => _now;
    }

    private sealed class FakeSyncMutationStore : ISyncMutationStore
    {
        private readonly Dictionary<string, StoredSyncMutation> _store = new();

        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
        {
            var key = $"{deviceId}::{clientRequestId}";
            _store.TryGetValue(key, out var result);
            return Task.FromResult(result);
        }

        public Task<bool> TryStoreSuccessAsync(
            string deviceId,
            string clientRequestId,
            string mutationType,
            string responsePayloadJson,
            DateTime processedAtUtc,
            CancellationToken ct = default)
        {
            var key = $"{deviceId}::{clientRequestId}";
            if (_store.ContainsKey(key)) return Task.FromResult(false);
            _store[key] = new StoredSyncMutation(deviceId, clientRequestId, mutationType, responsePayloadJson, processedAtUtc);
            return Task.FromResult(true);
        }
    }
}
