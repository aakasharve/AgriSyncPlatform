using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RemovePlannedActivity): per-stage
/// validator + authorizer coverage and end-to-end pipeline assertions
/// (canonical short-circuit ordering: <c>InvalidCommand →
/// PlannedActivityNotFound → Forbidden → (body)</c>).
/// </summary>
public sealed class RemovePlannedActivityPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid CropCycleId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid MukadamId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid WorkerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static PlannedActivity MakeActivity(Guid? id = null) =>
        PlannedActivity.CreateFromTemplate(
            id ?? Guid.NewGuid(),
            CropCycleId,
            "Spray pesticide",
            "Flowering",
            new DateOnly(2026, 5, 5),
            Guid.NewGuid(),
            Now.AddDays(-3));

    private static RemovePlannedActivityCommand WellFormed(Guid plannedActivityId) =>
        new(
            PlannedActivityId: plannedActivityId,
            FarmId: FarmId,
            Reason: "Activity skipped due to rain",
            CallerUserId: MukadamId,
            ClientCommandId: null);

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_PlannedActivityId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(WellFormed(Guid.NewGuid()) with { PlannedActivityId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(WellFormed(Guid.NewGuid()) with { FarmId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(WellFormed(Guid.NewGuid()) with { CallerUserId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Reason_is_blank()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(WellFormed(Guid.NewGuid()) with { Reason = "   " }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new RemovePlannedActivityValidator();
        var errs = v.Validate(WellFormed(Guid.NewGuid())).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_PlannedActivityNotFound_when_id_resolves_to_nothing()
    {
        var repo = new FakeRemoveRepo(activity: null, role: AppRole.Mukadam);
        var a = new RemovePlannedActivityAuthorizer(repo, new FakeClock(Now));

        var result = await a.AuthorizeAsync(WellFormed(Guid.NewGuid()), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_holds_no_PlanWork()
    {
        var activity = MakeActivity();
        var repo = new FakeRemoveRepo(activity, AppRole.Worker);
        var a = new RemovePlannedActivityAuthorizer(repo, new FakeClock(Now));

        var result = await a.AuthorizeAsync(WellFormed(activity.Id) with { CallerUserId = WorkerId }, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_holds_PlanWork()
    {
        var activity = MakeActivity();
        var repo = new FakeRemoveRepo(activity, AppRole.Mukadam);
        var a = new RemovePlannedActivityAuthorizer(repo, new FakeClock(Now));

        var result = await a.AuthorizeAsync(WellFormed(activity.Id), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration: canonical short-circuit ordering ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_PlannedActivityId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline(MakeActivity(), AppRole.Mukadam);

        var result = await pipeline.HandleAsync(WellFormed(Guid.NewGuid()) with { PlannedActivityId = Guid.Empty });

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

        var result = await pipeline.HandleAsync(WellFormed(Guid.NewGuid()));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.PlannedActivityNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden()
    {
        var activity = MakeActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Worker);

        var result = await pipeline.HandleAsync(WellFormed(activity.Id) with { CallerUserId = WorkerId });

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path_and_writes_audit()
    {
        var activity = MakeActivity();
        var (pipeline, repo) = BuildPipeline(activity, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(WellFormed(activity.Id));

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
        var authorizer = new RemovePlannedActivityAuthorizer(repo, new FakeClock(Now));

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

    /// <summary>
    /// Minimal repo stub that overrides only the methods exercised by the
    /// remove pipeline (planned-activity load, role lookup, audit append,
    /// save). Inherits StubShramSafalRepository defaults so any stray call
    /// to an unmocked method surfaces loudly.
    /// </summary>
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

        // lane L8b-1 (founder D-73) — the planning doors ask ScheduleChangeGate (PlanWork). In these tests the मुकादम is
        // the seat the owner GAVE "कामाचं नियोजन करणे" (unless PlanWorkGiven is false); every other label holds only what
        // the 2b migration stored for it (no PlanWork): a label grants nothing.
        public bool PlanWorkGiven { get; init; } = true;

        // lane L8b-1 fix round 1 (review H1) — the planned-work doors read the season's farm first. Every season here is on
        // FarmId, unless a fact puts it on another farm (SeasonFarm).
        public Guid SeasonFarm { get; init; } = FarmId;

        public override Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult<ShramSafal.Domain.Crops.CropCycle?>(ShramSafal.Domain.Crops.CropCycle.Create(
                cropCycleId, new AgriSync.SharedKernel.Contracts.Ids.FarmId(SeasonFarm), Guid.NewGuid(), "Grapes", "Flowering",
                new DateOnly(2026, 1, 1), null, Now));

        public override async Task<ShramSafal.Application.Services.FarmAccess?> GetFarmAccessForUserAsync(
            Guid farmId, Guid userId, CancellationToken ct = default)
        {
            var access = await base.GetFarmAccessForUserAsync(farmId, userId, ct);
            return access is { Role: AppRole.Mukadam } && PlanWorkGiven
                ? access with { StoredPermissions = (access.StoredPermissions ?? ShramSafal.Domain.Farms.FarmPermission.None) | ShramSafal.Domain.Farms.FarmPermission.PlanWork }
                : access;
        }

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
