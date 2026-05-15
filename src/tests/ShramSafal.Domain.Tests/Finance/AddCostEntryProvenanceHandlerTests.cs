using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.4 F2 — handler-level coverage
/// of the voice-from-Confirm provenance lift in
/// <see cref="AddCostEntryHandler"/>. Mirror of
/// <c>CreateDailyLogProvenanceHandlerTests</c> for the finance write path:
/// when the inbound command carries a <c>SourceAiJobId</c> the handler looks
/// up the matching <see cref="AiJob"/> and lifts its voice provenance onto
/// the new <see cref="CostEntry"/>, re-stamping the command-time
/// <c>ClientAppVersion</c>. When <c>SourceAiJobId</c> is null the handler
/// stamps a fresh <see cref="Provenance.Manual"/>.
///
/// Tests derive only from the spec — no implementor diff or chat seen.
/// </summary>
public sealed class AddCostEntryProvenanceHandlerTests
{
    private static readonly Guid CreatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid CostEntryGuid = Guid.Parse("77777777-7777-7777-7777-777777777777");
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
        // Arrange: seed farm + membership for the body's auth re-check; no
        // plot/cropCycle on the command so the body skips those lookups.
        var repo = new CapturingFinanceRepository();
        repo.AddFarm(MakeFarm());
        repo.SetMembership(FarmGuid, CreatorUserId);

        var seededVoiceJob = MakeAiJobWithVoiceProvenance();
        var aiJobs = new SeededAiJobRepository(seededVoiceJob);

        var handler = BuildHandler(repo, aiJobs);

        var command = MakeCommand(sourceAiJobId: AiJobGuid, clientAppVersion: CommandAppVersion);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert
        result.IsSuccess.Should().BeTrue();
        aiJobs.GetByIdCallCount.Should().Be(1);
        aiJobs.LastRequestedId.Should().Be(AiJobGuid);

        repo.SavedCostEntry.Should().NotBeNull();
        var saved = repo.SavedCostEntry!;
        saved.Provenance.Should().NotBeNull();
        saved.Provenance.Source.Should().Be(Source.Voice);
        saved.Provenance.ModelVersion.Should().Be(AiJobModelVersion);
        saved.Provenance.PromptVersion.Should().Be(AiJobPromptVersion);
        saved.Provenance.PromptContentHash.Should().Be(AiJobPromptContentHash);

        // Command-time client app version, NOT the AiJob's.
        saved.Provenance.AppVersion.Should().Be(CommandAppVersion);
        saved.Provenance.AppVersion.Should().NotBe(AiJobAppVersion);

        // SourceAiJobId round-trips from the command onto the row.
        saved.SourceAiJobId.Should().Be(AiJobGuid);
    }

    [Fact]
    public async Task manual_branch_writes_manual_provenance_with_command_appVersion()
    {
        // Arrange
        var repo = new CapturingFinanceRepository();
        repo.AddFarm(MakeFarm());
        repo.SetMembership(FarmGuid, CreatorUserId);

        var aiJobs = new SeededAiJobRepository(seededJob: null);

        var handler = BuildHandler(repo, aiJobs);

        var command = MakeCommand(sourceAiJobId: null, clientAppVersion: CommandAppVersion);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert
        result.IsSuccess.Should().BeTrue();
        aiJobs.GetByIdCallCount.Should().Be(0);

        repo.SavedCostEntry.Should().NotBeNull();
        var saved = repo.SavedCostEntry!;
        saved.Provenance.Should().NotBeNull();
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

    private static AddCostEntryCommand MakeCommand(
        Guid? sourceAiJobId,
        string clientAppVersion)
        => new(
            FarmId: FarmGuid,
            PlotId: null,
            CropCycleId: null,
            CategoryId: "other",
            Description: "Urea purchase",
            Amount: 1234.56m,
            CurrencyCode: "INR",
            EntryDate: new DateOnly(2026, 5, 14),
            CreatedByUserId: CreatorUserId,
            Location: null,
            CostEntryId: CostEntryGuid,
            ActorRole: "operator",
            ClientCommandId: $"req-{Guid.NewGuid():N}",
            SourceAiJobId: sourceAiJobId,
            ClientAppVersion: clientAppVersion);

    private static Farm MakeFarm() =>
        Farm.Create(new FarmId(FarmGuid), "Patil Farm",
            new UserId(CreatorUserId), new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

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
            userId: CreatorUserId,
            farmId: FarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: voiceProvenance);
    }

    private static AddCostEntryHandler BuildHandler(
        IShramSafalRepository repo,
        IAiJobRepository aiJobs)
    {
        var clock = new FixedClock(new DateTime(2026, 5, 14, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new NoopAnalyticsWriter();
        return new AddCostEntryHandler(
            repo,
            new FixedIdGenerator(CostEntryGuid),
            clock,
            new AllowAllEntitlementPolicy(),
            analytics,
            aiJobs);
    }

    /// <summary>
    /// Minimal hand-authored <see cref="IShramSafalRepository"/> that captures
    /// the <see cref="CostEntry"/> the handler persists, plus enough plumbing
    /// to satisfy the AddCostEntryHandler body path (farm lookup, membership
    /// re-check, duplicate-detection lookup, audit append, save). Methods
    /// outside that scope throw so a future refactor that newly routes here
    /// fails loudly.
    /// </summary>
    private sealed class CapturingFinanceRepository : IShramSafalRepository
    {
        private readonly Dictionary<Guid, Farm> _farms = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _memberships = new();

        public CostEntry? SavedCostEntry { get; private set; }

        public void AddFarm(Farm farm) => _farms[(Guid)farm.Id] = farm;
        public void SetMembership(Guid farmId, Guid userId)
            => _memberships.Add((farmId, userId));

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_farms.TryGetValue(farmId, out var f) ? f : null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_memberships.Contains((farmId, userId)));

        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(
            FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default)
            => Task.FromResult(new List<CostEntry>());

        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
        {
            SavedCostEntry = costEntry;
            return Task.CompletedTask;
        }

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // --- everything below is intentionally unwired for this test.
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => Task.FromResult<CropScheduleTemplate?>(null);
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ScheduleSubscription?>(null);
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
    }

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
