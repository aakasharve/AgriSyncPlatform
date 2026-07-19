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
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// spec: dfes-companion-2026-07-11 — "the derivation is never invoked" bug.
///
/// <para>
/// Real founder evidence: a voice log SAVED correctly via <c>POST /sync/push</c>
/// (the daily_log row + its AI job + its typed-ledger children all persisted
/// fine), but <c>ssf.daily_richness_aggregates</c> for that day was NEVER
/// recomputed — no exception, no "Side-car ... rolled back" warning anywhere.
/// The derivation was structurally skipped, not thrown.
/// </para>
///
/// <para>
/// <see cref="CreateDailyLogHandler.HandleAsync"/> is invoked identically by
/// both <c>PushSyncBatchHandler.HandleCreateDailyLogAsync</c> (the sync path —
/// "the ONLY path that matters in practice") and the direct <c>POST /logs</c>
/// pipeline, so this Domain-level test on the shared handler covers both entry
/// points. The bug is the domain idempotency-key early return: on ANY resend
/// of an already-committed log (same device+clientRequestId — a routine,
/// expected occurrence on an offline-first at-least-once-delivery sync queue),
/// the handler returned the cached DTO immediately WITHOUT giving the richness
/// side-car a chance to (re-)run — even when the original attempt's side-car
/// never reached the recompute step in the first place.
/// </para>
/// </summary>
public sealed class CreateDailyLogIdempotentResendRichnessTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("aaaaaaa1-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaa2-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("aaaaaaa3-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("aaaaaaa4-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("aaaaaaa5-5555-5555-5555-555555555555");
    private static readonly Guid AiJobGuid = Guid.Parse("aaaaaaa6-6666-6666-6666-666666666666");
    private static readonly DateOnly LogDate = new(2026, 7, 19);

    private const string DeviceId = "device-resend-1";
    private const string ClientRequestId = "req-resend-1";

    // A rich voice blob (labour + irrigation + inputs) — guarantees HasWork=true
    // once the derivation actually runs. Mirrors the founder's real 5-extraction
    // voice log shape closely enough to exercise the same lens coverage.
    private const string VoiceJson = """
    {
      "summary": "फर्टिगेशन आणि खुरपणी",
      "dayOutcome": "WORK_RECORDED",
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 fertigation four kg",
          "type": "fertilizer",
          "mix": [ { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" } ]
        }
      ],
      "irrigation": [
        { "id": "irr-0", "role": "fertigation", "method": "drip", "source": "borewell", "durationHours": 2.5 }
      ],
      "labour": [
        { "id": "lab-0", "engagementType": "hired_daily", "maleCount": 2, "femaleCount": 3, "rate": 350 }
      ]
    }
    """;

    [Fact]
    public async Task idempotent_resend_of_an_already_committed_log_recomputes_the_missed_richness_aggregate()
    {
        // Arrange — simulate exactly the founder's real scenario: a DailyLog
        // that ALREADY exists (as if committed by a prior sync attempt whose
        // side-car never reached the richness recompute), carrying a real,
        // provenance-verified voice AiJob. NO richness aggregate exists yet —
        // that is the "score stayed 0 / UnaccountedDay" symptom.
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.AddPlot(MakePlot());
        repo.AddCropCycle(MakeCropCycle());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);

        var preExisting = Domain.Logs.DailyLog.Create(
            LogGuid, FarmGuid, PlotGuid, CropCycleGuid, OperatorUserId, LogDate,
            idempotencyKey: $"{DeviceId}:{ClientRequestId}",
            location: null,
            createdAtUtc: new DateTime(2026, 7, 19, 9, 46, 0, DateTimeKind.Utc),
            provenance: new Provenance(Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.2.3"),
            sourceAiJobId: AiJobGuid);
        repo.AddLog(preExisting);

        var job = MakeVoiceJob(VoiceJson);
        var aiJobs = new SeededAiJobRepository(job);

        var handler = BuildHandler(repo, aiJobs);

        // The resend: SAME device + clientRequestId as the log that already
        // exists → hits the domain idempotency-key early return.
        var resendCommand = MakeCommand();

        // Act
        var result = await handler.HandleAsync(resendCommand);

        // Assert — idempotent success semantics are preserved (the caller-
        // visible contract does not change)...
        result.IsSuccess.Should().BeTrue("an idempotent resend must still report success");
        result.Value!.Id.Should().Be(LogGuid, "the resend must return the EXISTING log, not create a new one");

        // ...but the richness side-car must have caught up: this is the exact
        // gap the founder hit — score stuck at 0 forever because no code path
        // ever gave the recompute a second chance.
        repo.SeededRichnessAggregates.Should().ContainSingle(
            "the resend must trigger exactly one richness aggregate for the day, even though the ORIGINAL attempt's side-car never ran");
        var agg = repo.SeededRichnessAggregates.Single();
        agg.FarmId.Should().Be(FarmGuid);
        agg.LocalDate.Should().Be(LogDate);
        agg.HasWork.Should().BeTrue("the voice job carries real labour/irrigation/inputs signals");
        agg.DayClassification.Should().NotBe(DayClassification.UnaccountedDay);
    }

    [Fact]
    public async Task repeated_resends_recompute_in_place_and_never_double_count()
    {
        // Same setup as above, but hit the resend path THREE times to prove
        // the catch-up recompute is genuinely idempotent (recompute-and-
        // overwrite), never accumulating duplicate aggregate rows.
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.AddPlot(MakePlot());
        repo.AddCropCycle(MakeCropCycle());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);

        var preExisting = Domain.Logs.DailyLog.Create(
            LogGuid, FarmGuid, PlotGuid, CropCycleGuid, OperatorUserId, LogDate,
            idempotencyKey: $"{DeviceId}:{ClientRequestId}",
            location: null,
            createdAtUtc: new DateTime(2026, 7, 19, 9, 46, 0, DateTimeKind.Utc),
            provenance: new Provenance(Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.2.3"),
            sourceAiJobId: AiJobGuid);
        repo.AddLog(preExisting);

        var job = MakeVoiceJob(VoiceJson);
        var aiJobs = new SeededAiJobRepository(job);
        var handler = BuildHandler(repo, aiJobs);

        await handler.HandleAsync(MakeCommand());
        await handler.HandleAsync(MakeCommand());
        var third = await handler.HandleAsync(MakeCommand());

        third.IsSuccess.Should().BeTrue();
        repo.SeededRichnessAggregates.Should().ContainSingle(
            "recompute-and-overwrite is idempotent — 3 resends must still leave exactly ONE aggregate row for the day");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static CreateDailyLogCommand MakeCommand()
        => new(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: OperatorUserId,
            OperatorUserId: OperatorUserId,
            LogDate: LogDate,
            Location: null,
            DeviceId: DeviceId,
            ClientRequestId: ClientRequestId,
            DailyLogId: null,
            ActorRole: "worker",
            SourceAiJobId: AiJobGuid,
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
            idempotencyKey: "voice-resend-key-1",
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
                appVersion: "1.2.3"));

        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(normalizedJson, attempt);
        return job;
    }

    // Real DailyRichnessDerivationService (NOT the Null test double) — this
    // test exists specifically to prove the recompute actually runs.
    private static CreateDailyLogHandler BuildHandler(
        InMemoryShramSafalRepository repo, IAiJobRepository aiJobs)
        => new(
            repo,
            new FixedIdGenerator(LogGuid),
            new FixedClock(new DateTime(2026, 7, 19, 9, 46, 0, DateTimeKind.Utc)),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            aiJobs,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<CreateDailyLogHandler>.Instance,
            new LedgerDerivationService(repo),
            new DailyRichnessDerivationService(repo, aiJobs, new FixedIdGenerator2(), new FixedClock(new DateTime(2026, 7, 19, 9, 46, 0, DateTimeKind.Utc))),
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

    // Distinct generator for the richness aggregate's own id (must differ from
    // the log id so the aggregate is never confused with the log in asserts).
    private sealed class FixedIdGenerator2 : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
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
