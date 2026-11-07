// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B003; founder D-46) — a material labour
// correction re-opens a confirmed record, so the record's WORK day is rebuilt inside the same unit of work.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class CorrectLabourRecomputeTests
{
    private static readonly Guid Farm = Guid.Parse("3a500000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("3a500000-0000-0000-0000-000000000002");
    private static readonly DateOnly WorkDay = new(2026, 11, 2);
    private static readonly DateTime Created = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime CorrectedAt = new(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc); // D+3

    [Fact]
    public async Task CorrectLabour_Reopen_RecomputesWorkDay()
    {
        var (log, assignment, repo) = ConfirmedDayWithEightWorkers();
        var recorder = new RecordingRichness();

        var result = await Handler(repo, recorder).HandleAsync(SixWorkers(assignment.Id));

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Equal([(Farm, WorkDay)], recorder.Calls);
    }

    [Fact]
    public async Task CorrectLabour_Reopen_RecomputesWorkDay_OnTheQueuedPathToo()
    {
        var (log, assignment, repo) = ConfirmedDayWithEightWorkers();
        var recorder = new RecordingRichness();

        var result = await Handler(repo, recorder).HandleAsync(
            SixWorkers(assignment.Id) with { IdempotencyStoredByCaller = true, DailyLogId = log.Id });

        Assert.True(result.IsSuccess);
        Assert.Equal([(Farm, WorkDay)], recorder.Calls);
    }

    [Fact]
    public async Task CorrectLabour_Replay_DoesNotRecompute()
    {
        var (_, assignment, repo) = ConfirmedDayWithEightWorkers();
        var recorder = new RecordingRichness();
        var handler = Handler(repo, recorder);

        Assert.True((await handler.HandleAsync(SixWorkers(assignment.Id))).IsSuccess);
        var replay = await handler.HandleAsync(SixWorkers(assignment.Id));

        Assert.True(replay.IsSuccess);
        Assert.True(replay.Value.AlreadyApplied);
        Assert.Single(recorder.Calls);
    }

    [Fact]
    public async Task CorrectLabour_NothingMoved_DoesNotRecompute()
    {
        var (log, assignment, repo) = ConfirmedDayWithEightWorkers();
        var recorder = new RecordingRichness();

        var result = await Handler(repo, recorder).HandleAsync(Command(assignment.Id, new LabourQuantityCorrection(8, null, null)));

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.CorrectionsRecorded);
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
        Assert.Empty(recorder.Calls);
    }

    [Fact]
    public async Task CorrectLabour_RecomputeFails_TheCorrectionFailsWithIt()
    {
        var (_, assignment, repo) = ConfirmedDayWithEightWorkers();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Handler(repo, new ThrowingRichness()).HandleAsync(SixWorkers(assignment.Id)));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static (DailyLog Log, LabourAssignment Assignment, Repo Repo) ConfirmedDayWithEightWorkers()
    {
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Owner),
            WorkDay, null, (LocationSnapshot?)null, Created);
        log.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, new UserId(Owner),
            Created.AddHours(1), targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());
        var assignment = LabourAssignment.Create(
            Guid.NewGuid(), log.Id, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: 8, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null,
            linkedActivityId: null, createdAtUtc: Created, time: LabourTime.ServerAssumed());

        var repo = new Repo();
        repo.SetRole(Farm, Owner, AppRole.PrimaryOwner);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        return (log, assignment, repo);
    }

    private static CorrectLabourCommand SixWorkers(Guid assignmentId) =>
        Command(assignmentId, new LabourQuantityCorrection(6, null, null));

    private static CorrectLabourCommand Command(Guid assignmentId, LabourQuantityCorrection quantity) => new(
        new FarmId(Farm), assignmentId, new UserId(Owner), "device-1", "req-1", "मोजून पाहिलं",
        quantity, DurationHours: null, AttributionAdds: null, AttributionRemovals: null);

    private static CorrectLabourHandler Handler(Repo repo, IDailyRichnessDerivationService richness) =>
        new(repo, new MutationStore(), new Ids(), new FixedClock(CorrectedAt), NullLogger<CorrectLabourHandler>.Instance,
            richness);

    private sealed class RecordingRichness : IDailyRichnessDerivationService
    {
        public List<(Guid FarmId, DateOnly Day)> Calls { get; } = [];

        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
        {
            Calls.Add((farmId, localDate));
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingRichness : IDailyRichnessDerivationService
    {
        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => throw new InvalidOperationException("recompute failed");
    }

    private sealed class Ids : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>The sync store's contract: true the first time a (device, request) pair is stored, false after.</summary>
    private sealed class MutationStore : ISyncMutationStore
    {
        private readonly Dictionary<(string, string), StoredSyncMutation> _stored = [];

        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
            => Task.FromResult(_stored.TryGetValue((deviceId, clientRequestId), out var m) ? m : null);

        public Task<bool> TryStoreSuccessAsync(
            string deviceId, string clientRequestId, string mutationType,
            string responsePayloadJson, DateTime processedAtUtc, CancellationToken ct = default)
        {
            if (_stored.ContainsKey((deviceId, clientRequestId)))
            {
                return Task.FromResult(false);
            }

            _stored[(deviceId, clientRequestId)] = new StoredSyncMutation(
                deviceId, clientRequestId, mutationType, responsePayloadJson, processedAtUtc);
            return Task.FromResult(true);
        }
    }

    private sealed class Repo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<Guid, LabourAssignment> _assignments = new();
        private readonly Dictionary<(Guid FarmId, Guid UserId), AppRole> _roles = new();

        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SeedAssignment(LabourAssignment a) => _assignments[a.Id] = a;
        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
            => Task.FromResult(false);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_assignments.TryGetValue(id, out var a) ? a : null);

        public override Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
            Guid labourAssignmentId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

        public override Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default) => Task.CompletedTask;

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
