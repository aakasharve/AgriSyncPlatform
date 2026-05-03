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
/// T-IGH-03-PIPELINE-ROLLOUT (RemovePlannedActivity): per-stage
/// validator + authorizer coverage and end-to-end pipeline assertions.
/// Canonical short-circuit ordering: <c>InvalidCommand →
/// PlannedActivityNotFound → Forbidden → (body)</c>.
/// </summary>
public sealed class RemovePlannedActivityPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid MukadamId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid WorkerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static PlannedActivity MakeTemplateDerivedActivity() =>
        PlannedActivity.CreateFromTemplate(
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Spray pesticide",
            "Flowering",
            new DateOnly(2026, 5, 5),
            Guid.NewGuid(),
            Now.AddDays(-3));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_PlannedActivityId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.Empty,
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: Guid.Empty,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: Guid.Empty,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Reason_is_blank()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            Reason: "  ",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            Reason: "Activity skipped due to rain",
            CallerUserId: MukadamId,
            ClientCommandId: null)).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_PlannedActivityNotFound_when_id_resolves_to_nothing()
    {
        var repo = new FakeRemoveRepo(activity: null, role: AppRole.Mukadam);
        var a = new RemovePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_below_Mukadam()
    {
        var activity = MakeTemplateDerivedActivity();
        var repo = new FakeRemoveRepo(activity, AppRole.Worker);
        var a = new RemovePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: WorkerId,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_Mukadam()
    {
        var activity = MakeTemplateDerivedActivity();
        var repo = new FakeRemoveRepo(activity, AppRole.Mukadam);
        var a = new RemovePlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_PlannedActivityId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline(MakeTemplateDerivedActivity(), AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.Empty,
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_PlannedActivityNotFound()
    {
        var (pipeline, repo) = BuildPipeline(activity: null, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: Guid.NewGuid(),
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden()
    {
        var activity = MakeTemplateDerivedActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Worker);

        var result = await pipeline.HandleAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            Reason: "skipped",
            CallerUserId: WorkerId,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path_and_soft_removes_template_derived_row()
    {
        var activity = MakeTemplateDerivedActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new RemovePlannedActivityCommand(
            PlannedActivityId: activity.Id,
            FarmId: FarmId,
            Reason: "Activity skipped due to rain",
            CallerUserId: MukadamId,
            ClientCommandId: null));

        Assert.True(result.IsSuccess);
        Assert.True(activity.IsRemoved);
        Assert.Equal("Activity skipped due to rain", activity.RemovedReason);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("plan.removed", repo.AuditEvents[0].Action);
        Assert.Equal(1, repo.SaveCalls);
    }

    // ---- Helpers ----

    private static (
        IHandler<RemovePlannedActivityCommand> Pipeline,
        FakeRemoveRepo Repo) BuildPipeline(PlannedActivity? activity, AppRole? role)
    {
        var repo = new FakeRemoveRepo(activity, role);
        var rawHandler = new RemovePlannedActivityHandler(
            repo,
            new FakeSyncMutationStore(),
            new FakeClock(Now));

        var validator = new RemovePlannedActivityValidator();
        var authorizer = new RemovePlannedActivityAuthorizer(repo);

        var pipeline = HandlerPipeline.Build<RemovePlannedActivityCommand>(
            rawHandler,
            new LoggingBehavior<RemovePlannedActivityCommand>(
                NullLogger<LoggingBehavior<RemovePlannedActivityCommand>>.Instance),
            new ValidationBehavior<RemovePlannedActivityCommand>(
                new IValidator<RemovePlannedActivityCommand>[] { validator }),
            new AuthorizationBehavior<RemovePlannedActivityCommand>(
                new IAuthorizationCheck<RemovePlannedActivityCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FakeRemoveRepo : Work.Handlers.StubShramSafalRepository
    {
        private readonly PlannedActivity? _activity;
        private readonly AppRole? _role;

        public FakeRemoveRepo(PlannedActivity? activity, AppRole? role)
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
