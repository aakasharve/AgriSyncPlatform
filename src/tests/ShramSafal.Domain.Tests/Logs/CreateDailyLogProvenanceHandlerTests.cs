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
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.4 F2 — handler-level coverage
/// of the voice-from-Confirm provenance lift in
/// <see cref="CreateDailyLogHandler"/>. The handler stamps voice provenance at
/// user-Confirm time (not at AI-parse time): when the inbound command carries
/// a <c>SourceAiJobId</c> the handler looks up the matching <see cref="AiJob"/>
/// and lifts that job's <see cref="Provenance"/> (Source.Voice + model + prompt
/// + content hash) onto the new <c>DailyLog</c>, re-stamping the command-time
/// <c>ClientAppVersion</c>. When <c>SourceAiJobId</c> is null the handler
/// stamps a fresh <see cref="Provenance.Manual"/> using the same client app
/// version.
///
/// Tests derive only from the spec — no implementor diff or chat seen.
/// </summary>
public sealed class CreateDailyLogProvenanceHandlerTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");

    private const string AiJobModelVersion = "gemini-2.5-flash";
    private const string AiJobPromptVersion = "v3.2.0";
    private const string AiJobPromptContentHash =
        "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1";
    private const string AiJobAppVersion = "0.9.0-pre-confirm";
    private const string CommandAppVersion = "1.2.3";

    [Fact]
    public async Task voice_lift_branch_writes_voice_provenance_from_looked_up_AiJob()
    {
        // Arrange: seed the farm + plot + crop cycle + membership the body
        // needs after the entitlement gate, plus an in-memory AiJob with a
        // fully populated Voice provenance distinct from the command-time
        // client app version (so the AppVersion re-stamp is observable).
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.AddPlot(MakePlot());
        repo.AddCropCycle(MakeCropCycle());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);

        var seededVoiceJob = MakeAiJobWithVoiceProvenance();
        var aiJobs = new SeededAiJobRepository(seededVoiceJob);

        var handler = BuildHandler(repo, aiJobs);

        var command = MakeCommand(sourceAiJobId: AiJobGuid, clientAppVersion: CommandAppVersion);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert: the handler succeeded and the AiJob was looked up.
        result.IsSuccess.Should().BeTrue();
        aiJobs.GetByIdCallCount.Should().Be(1);
        aiJobs.LastRequestedId.Should().Be(AiJobGuid);

        // The persisted DailyLog carries voice-lifted provenance.
        var saved = await repo.GetDailyLogByIdAsync(LogGuid);
        saved.Should().NotBeNull();
        saved!.Provenance.Should().NotBeNull();
        saved.Provenance.Source.Should().Be(Source.Voice);
        saved.Provenance.ModelVersion.Should().Be(AiJobModelVersion);
        saved.Provenance.PromptVersion.Should().Be(AiJobPromptVersion);
        saved.Provenance.PromptContentHash.Should().Be(AiJobPromptContentHash);

        // The handler re-stamps the AppVersion from the command, NOT from the
        // AiJob — voice provenance is stamped at user-Confirm time.
        saved.Provenance.AppVersion.Should().Be(CommandAppVersion);
        saved.Provenance.AppVersion.Should().NotBe(AiJobAppVersion);

        // SourceAiJobId round-trips from the command onto the row.
        saved.SourceAiJobId.Should().Be(AiJobGuid);
    }

    [Fact]
    public async Task manual_branch_writes_manual_provenance_with_command_appVersion()
    {
        // Arrange: same seed shape as the voice-lift test, but the command
        // carries no SourceAiJobId. The AiJob repository must NOT be touched
        // (Manual fallback path).
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.AddPlot(MakePlot());
        repo.AddCropCycle(MakeCropCycle());
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);

        var aiJobs = new SeededAiJobRepository(seededJob: null);

        var handler = BuildHandler(repo, aiJobs);

        var command = MakeCommand(sourceAiJobId: null, clientAppVersion: CommandAppVersion);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert
        result.IsSuccess.Should().BeTrue();
        aiJobs.GetByIdCallCount.Should().Be(0);

        var saved = await repo.GetDailyLogByIdAsync(LogGuid);
        saved.Should().NotBeNull();
        saved!.Provenance.Should().NotBeNull();
        saved.Provenance.Source.Should().Be(Source.Manual);

        // Provenance.Manual factory contract: model/prompt are "n/a", hash is null.
        saved.Provenance.ModelVersion.Should().Be("n/a");
        saved.Provenance.PromptVersion.Should().Be("n/a");
        saved.Provenance.PromptContentHash.Should().BeNull();

        // AppVersion is the command's ClientAppVersion verbatim.
        saved.Provenance.AppVersion.Should().Be(CommandAppVersion);

        // Manual rows carry no back-reference to an AiJob.
        saved.SourceAiJobId.Should().BeNull();
    }

    // ---- helpers ----

    private static CreateDailyLogCommand MakeCommand(
        Guid? sourceAiJobId,
        string clientAppVersion)
        => new(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: OperatorUserId,
            OperatorUserId: OperatorUserId,
            LogDate: new DateOnly(2026, 5, 14),
            Location: null,
            DeviceId: "device-1",
            ClientRequestId: $"req-{Guid.NewGuid():N}",
            DailyLogId: null,
            ActorRole: "worker",
            SourceAiJobId: sourceAiJobId,
            ClientAppVersion: clientAppVersion);

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

    private static AiJob MakeAiJobWithVoiceProvenance()
    {
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: AiJobModelVersion,
            promptVersion: AiJobPromptVersion,
            promptContentHash: AiJobPromptContentHash,
            appVersion: AiJobAppVersion);

        return AiJob.Create(
            id: AiJobGuid,
            idempotencyKey: "voice-key-1",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: OperatorUserId,
            farmId: FarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: voiceProvenance);
    }

    private static CreateDailyLogHandler BuildHandler(
        InMemoryShramSafalRepository repo,
        IAiJobRepository aiJobs)
    {
        var clock = new FixedClock(new DateTime(2026, 5, 14, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new NoopAnalyticsWriter();
        return new CreateDailyLogHandler(
            repo,
            new FixedIdGenerator(LogGuid),
            clock,
            new AllowAllEntitlementPolicy(),
            analytics,
            aiJobs);
    }

    /// <summary>
    /// In-memory <see cref="IAiJobRepository"/> double that returns a single
    /// pre-seeded <see cref="AiJob"/> from <see cref="GetByIdAsync"/> when the
    /// requested id matches; tracks call count and last requested id so tests
    /// can assert the voice-lift path actually consulted it.
    /// </summary>
    private sealed class SeededAiJobRepository : IAiJobRepository
    {
        private readonly AiJob? _seededJob;

        public SeededAiJobRepository(AiJob? seededJob)
        {
            _seededJob = seededJob;
        }

        public int GetByIdCallCount { get; private set; }
        public Guid? LastRequestedId { get; private set; }

        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
        {
            GetByIdCallCount++;
            LastRequestedId = jobId;
            if (_seededJob is not null && _seededJob.Id == jobId)
            {
                return Task.FromResult<AiJob?>(_seededJob);
            }

            return Task.FromResult<AiJob?>(null);
        }

        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
            => Task.FromResult<AiJob?>(null);

        public Task AddAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;

        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;

        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default)
            => Task.FromResult(AiProviderConfig.CreateDefault());

        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default)
            => Task.FromResult(new List<AiJob>());

        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default)
            => Task.FromResult(new Dictionary<AiProviderType, int>());

        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default)
            => Task.FromResult(new Dictionary<AiProviderType, int>());
    }

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class FixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public FixedIdGenerator(Guid id) { _id = id; }
        public Guid New() => _id;
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
