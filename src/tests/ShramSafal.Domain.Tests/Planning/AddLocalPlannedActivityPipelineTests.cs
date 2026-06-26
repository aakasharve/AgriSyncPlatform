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
/// T-IGH-03-PIPELINE-ROLLOUT (AddLocalPlannedActivity): per-stage
/// validator + authorizer coverage and end-to-end pipeline assertions.
///
/// <para>
/// Canonical short-circuit ordering for the add use case is
/// <c>InvalidCommand → Forbidden → (body)</c>. There is deliberately NO
/// PlannedActivityNotFound stage — the use case CREATES a new planned
/// activity rather than loading an existing one, so the
/// <see cref="AddLocalPlannedActivityAuthorizer"/> only performs the
/// Mukadam-or-higher role check (mirroring the handler body verbatim).
/// </para>
/// </summary>
public sealed class AddLocalPlannedActivityPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid CropCycleId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid MukadamId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid WorkerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static AddLocalPlannedActivityCommand WellFormed(Guid? newActivityId = null) =>
        new(
            NewActivityId: newActivityId ?? Guid.NewGuid(),
            CropCycleId: CropCycleId,
            FarmId: FarmId,
            ActivityName: "Drip irrigation",
            Stage: "Fruiting",
            PlannedDate: new DateOnly(2026, 5, 1),
            Reason: "Extra irrigation needed",
            CallerUserId: MukadamId,
            ClientCommandId: null);

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_NewActivityId_is_empty()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { NewActivityId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CropCycleId_is_empty()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { CropCycleId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { FarmId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { CallerUserId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_ActivityName_is_blank()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { ActivityName = "   " }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Stage_is_blank()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { Stage = "" }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Reason_is_blank()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed() with { Reason = "   " }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new AddLocalPlannedActivityValidator();
        var errs = v.Validate(WellFormed()).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_below_Mukadam()
    {
        var repo = new FakeAddRepo(AppRole.Worker);
        var a = new AddLocalPlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormed() with { CallerUserId = WorkerId }, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_has_no_role_on_farm()
    {
        var repo = new FakeAddRepo(role: null);
        var a = new AddLocalPlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormed(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_Mukadam()
    {
        var repo = new FakeAddRepo(AppRole.Mukadam);
        var a = new AddLocalPlannedActivityAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormed(), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration: canonical short-circuit ordering ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_FarmId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline(AppRole.Mukadam);

        var result = await pipeline.HandleAsync(WellFormed() with { FarmId = Guid.Empty });

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Body adds the activity + an audit row on success — their absence
        // proves the pipeline short-circuited before the handler ran.
        Assert.Empty(repo.AddedActivities);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden()
    {
        var (pipeline, repo) = BuildPipeline(AppRole.Worker);

        var result = await pipeline.HandleAsync(WellFormed() with { CallerUserId = WorkerId });

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AddedActivities);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path_and_writes_audit()
    {
        var (pipeline, repo) = BuildPipeline(AppRole.Mukadam);
        var newId = Guid.NewGuid();

        var result = await pipeline.HandleAsync(WellFormed(newId));

        Assert.True(result.IsSuccess);
        Assert.Single(repo.AddedActivities);
        var added = repo.AddedActivities[0];
        Assert.Equal(newId, added.Id);
        Assert.True(added.IsLocallyAdded);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("plan.added", repo.AuditEvents[0].Action);
        Assert.Equal(1, repo.SaveCalls);
    }

    // ---- Helpers ----

    private static (
        IHandler<AddLocalPlannedActivityCommand> Pipeline,
        FakeAddRepo Repo) BuildPipeline(AppRole? role)
    {
        var repo = new FakeAddRepo(role);
        var rawHandler = new AddLocalPlannedActivityHandler(
            repo,
            new FakeSyncMutationStore(),
            new FakeClock(Now));

        var validator = new AddLocalPlannedActivityValidator();
        var authorizer = new AddLocalPlannedActivityAuthorizer(repo);

        var pipeline = HandlerPipeline.Build<AddLocalPlannedActivityCommand>(
            rawHandler,
            new LoggingBehavior<AddLocalPlannedActivityCommand>(
                NullLogger<LoggingBehavior<AddLocalPlannedActivityCommand>>.Instance),
            new ValidationBehavior<AddLocalPlannedActivityCommand>(
                new IValidator<AddLocalPlannedActivityCommand>[] { validator }),
            new AuthorizationBehavior<AddLocalPlannedActivityCommand>(
                new IAuthorizationCheck<AddLocalPlannedActivityCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    /// <summary>
    /// Minimal repo stub that overrides only the methods exercised by the
    /// add pipeline (role lookup, planned-activity insert, audit append,
    /// save). Inherits StubShramSafalRepository defaults so any stray call
    /// to an unmocked method surfaces loudly.
    /// </summary>
    private sealed class FakeAddRepo : Work.Handlers.StubShramSafalRepository
    {
        private readonly AppRole? _role;

        public FakeAddRepo(AppRole? role)
        {
            _role = role;
        }

        public List<PlannedActivity> AddedActivities { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();
        public int SaveCalls { get; private set; }

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(_role);

        public override Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default)
        {
            AddedActivities.AddRange(plannedActivities);
            return Task.CompletedTask;
        }

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
