using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Fix F1 (ai-intelligence-plan-2026-06-25) — the confirm-time Track-B ledger
/// derivation is a NON-BLOCKING side-car: a DB failure inside
/// <see cref="LedgerDerivationService.DeriveAsync"/> must NEVER discard the
/// farmer's <c>DailyLog</c>. The two-phase persistence contract commits the log
/// FIRST (its own SaveChanges) and runs the side-car afterwards under a
/// savepoint / isolated try-catch, so a derivation throw is swallowed and the
/// handler still returns success with the log durable.
///
/// <para>The 23505 transient-double-current-row race itself needs a real
/// Postgres partial-unique index (that is the Sync integration test's job);
/// here we prove the isolation contract with an <em>injected</em> repository
/// failure on the derivation write path. The DailyLog was staged + committed in
/// Phase 1 before the side-car ran, so it survives.</para>
///
/// Tests derive only from the fix ruling + Domain factory signatures — no
/// implementor diff seen.
/// </summary>
public sealed class CreateDailyLogDerivationIsolationTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");

    // A voice blob with an inputs[] array so the derivation reaches the
    // FarmOperation write path (where the injected failure fires).
    private const string VoiceJson = """
    {
      "summary": "s",
      "dayOutcome": "WORK_RECORDED",
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 fertigation",
          "type": "fertilizer",
          "mix": [ { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" } ]
        }
      ]
    }
    """;

    [Fact]
    public async Task derivation_failure_never_discards_the_daily_log()
    {
        // Arrange — seed the farm graph, an AiJob with a derivable voice blob,
        // and a repo whose FIRST derivation write throws (simulating the
        // Postgres 23505 / any DB error inside the non-blocking side-car).
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.AddPlot(MakePlot());
        repo.AddCropCycle(MakeCropCycle());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);

        var derivationAttempted = false;
        repo.OnAddFarmOperation = () =>
        {
            derivationAttempted = true;
            throw new InvalidOperationException("simulated derivation DB failure (23505 stand-in)");
        };

        var job = MakeVoiceJob(VoiceJson);
        var aiJobs = new SeededAiJobRepository(job);

        var handler = BuildHandler(repo, aiJobs);
        var command = MakeCommand(sourceAiJobId: AiJobGuid);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert — the side-car blew up, but the log is durable and the handler
        // reports success.
        derivationAttempted.Should().BeTrue("the derivation must have run to exercise the failure path");
        result.IsSuccess.Should().BeTrue("a derivation failure is non-blocking and must never reject the log");

        var saved = await repo.GetDailyLogByIdAsync(LogGuid);
        saved.Should().NotBeNull("the DailyLog is committed in Phase 1 BEFORE the side-car runs");
        saved!.Id.Should().Be(LogGuid);

        // No current FarmOperation survived the failed side-car (the throw fired
        // before any row was captured).
        repo.CapturedOperations.Should().BeEmpty();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static CreateDailyLogCommand MakeCommand(Guid? sourceAiJobId)
        => new(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: OperatorUserId,
            OperatorUserId: OperatorUserId,
            LogDate: new DateOnly(2026, 6, 20),
            Location: null,
            DeviceId: "device-1",
            ClientRequestId: $"req-{Guid.NewGuid():N}",
            DailyLogId: null,
            ActorRole: "worker",
            SourceAiJobId: sourceAiJobId,
            ClientAppVersion: "1.2.3");

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

    private static AiJob MakeVoiceJob(string normalizedJson)
    {
        var job = AiJob.Create(
            id: AiJobGuid,
            idempotencyKey: "voice-key-1",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: OperatorUserId,
            farmId: FarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: null,
                appVersion: "1.0.0"));

        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(normalizedJson, attempt);
        return job;
    }

    private static CreateDailyLogHandler BuildHandler(
        IShramSafalRepository repo, IAiJobRepository aiJobs)
        => new(
            repo,
            new FixedIdGenerator(LogGuid),
            new FixedClock(new DateTime(2026, 6, 20, 12, 0, 0, DateTimeKind.Utc)),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            aiJobs,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<CreateDailyLogHandler>.Instance,
            new LedgerDerivationService(repo),
            new Common.NullDailyRichnessDerivationService(),
            dbContext: null);

    private sealed class SeededAiJobRepository(AiJob seededJob) : IAiJobRepository
    {
        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
            => Task.FromResult<AiJob?>(seededJob.Id == jobId ? seededJob : null);
        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => Task.FromResult<AiJob?>(null);
        public Task AddAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;
        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;
        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => Task.FromResult(AiProviderConfig.CreateDefault());
        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) => Task.FromResult(new List<AiJob>());
        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) => Task.FromResult(new Dictionary<AiProviderType, int>());
        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) => Task.FromResult(new Dictionary<AiProviderType, int>());
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FixedIdGenerator(Guid id) : IIdGenerator
    {
        public Guid New() => id;
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
