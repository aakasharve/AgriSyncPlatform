// spec: data-principle-spine-2026-05-05/05.1
//
// Sub-phase 05.1 — backend CoVe handler tests.
// Exercises the two paths the envelope requires:
//   (a) a low-score Gemini response demotes the result to lowConfidence
//   (b) entitlement denial returns a Forbidden error without calling Gemini
// All Gemini calls go through a hand-rolled FakeAiProvider — no network.

using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.CoVeReverify;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class CoVeReverifyHandlerTests
{
    private static readonly Guid FarmGuid = Guid.NewGuid();
    private static readonly Guid OwnerGuid = Guid.NewGuid();
    private static readonly DateTime Now = new(2026, 5, 17, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task LowGeminiScore_FlipsLowConfidenceTrue_AndStampsDemotionReason()
    {
        var (handler, gemini, repo) = BuildHandler(entitlementAllowed: true);
        // Gemini returns a 0.40 confidence — well below the 0.7 threshold.
        gemini.EnqueueVoiceResult(SuccessfulCoVeResult(0.40m));

        var result = await handler.HandleAsync(BuildCommand());

        result.IsSuccess.Should().BeTrue();
        result.Value!.VerificationScore.Should().Be(0.40m);
        result.Value.LowConfidence.Should().BeTrue();
        result.Value.DemotionReason.Should().NotBeNull();
        result.Value.DemotionReason!.Should().Contain("0.40");

        gemini.VoiceParseCallCount.Should().Be(1);
        repo.AuditEvents.Should().HaveCount(1);
        var audit = repo.AuditEvents.Single();
        audit.EntityType.Should().Be("AiJob");
        audit.Action.Should().Be("CoVeReverified");
    }

    [Fact]
    public async Task EntitlementDenied_ReturnsForbidden_AndNeverCallsGemini()
    {
        var (handler, gemini, repo) = BuildHandler(entitlementAllowed: false);

        var result = await handler.HandleAsync(BuildCommand());

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().StartWith("entitlement.");
        gemini.VoiceParseCallCount.Should().Be(0);
        repo.AuditEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task HighGeminiScore_KeepsLowConfidenceFalse_AndOmitsDemotionReason()
    {
        var (handler, gemini, _) = BuildHandler(entitlementAllowed: true);
        gemini.EnqueueVoiceResult(SuccessfulCoVeResult(0.92m));

        var result = await handler.HandleAsync(BuildCommand());

        result.IsSuccess.Should().BeTrue();
        result.Value!.VerificationScore.Should().Be(0.92m);
        result.Value.LowConfidence.Should().BeFalse();
        result.Value.DemotionReason.Should().BeNull();
    }

    // ---- builders ----

    private static CoVeReverifyCommand BuildCommand() => new(
        UserId: OwnerGuid,
        FarmId: FarmGuid,
        Transcript: "आज सकाळी द्राक्षांना खत टाकले",
        ParsedJson: """{"date":"2026-05-17","crop":"grapes","action":"fertilizer"}""",
        SourceAiJobId: Guid.NewGuid(),
        ClientAppVersion: "test-v1",
        ActorRole: "Owner",
        AuditDeviceId: "test-device",
        AuditIpHash: "sha256:test");

    private static VoiceParseCanonicalResult SuccessfulCoVeResult(decimal score) =>
        new()
        {
            Success = true,
            ModelUsed = "gemini-2.0-flash",
            NormalizedJson = $$"""{"confidence":{{score}},"summary":"ok"}""",
            OverallConfidence = score,
        };

    private static (CoVeReverifyHandler Handler, FakeGeminiProvider Gemini, RecordingRepo Repo)
        BuildHandler(bool entitlementAllowed)
    {
        var farm = Farm.Create(new FarmId(FarmGuid), "Test Farm", new UserId(OwnerGuid), Now);
        var repo = new RecordingRepo(farm, isUserMember: true);
        var gemini = new FakeGeminiProvider();
        var policy = new ToggleableEntitlementPolicy(entitlementAllowed);

        var handler = new CoVeReverifyHandler(repo, new IAiProvider[] { gemini }, policy);
        return (handler, gemini, repo);
    }

    // ---- doubles ----

    private sealed class ToggleableEntitlementPolicy(bool allowed) : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(allowed
                ? new EntitlementDecision(true, EntitlementReason.Allowed, null)
                : new EntitlementDecision(false, EntitlementReason.SubscriptionMissing, null));
    }

    private sealed class FakeGeminiProvider : IAiProvider
    {
        private readonly Queue<VoiceParseCanonicalResult> _voiceResults = new();

        public AiProviderType ProviderType => AiProviderType.Gemini;
        public int VoiceParseCallCount { get; private set; }

        public void EnqueueVoiceResult(VoiceParseCanonicalResult result) => _voiceResults.Enqueue(result);

        public Task<bool> HealthCheckAsync(CancellationToken ct = default) => Task.FromResult(true);
        public bool CanHandle(AiOperationType operation) => true;

        public Task<VoiceParseCanonicalResult> ParseVoiceAsync(
            Stream audioStream, string mimeType, string languageHint, string systemPrompt, CancellationToken ct = default)
        {
            VoiceParseCallCount++;
            return Task.FromResult(_voiceResults.TryDequeue(out var r)
                ? r
                : new VoiceParseCanonicalResult { Success = true, OverallConfidence = 0.9m, NormalizedJson = "{}" });
        }

        public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
            Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
            Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class RecordingRepo : IShramSafalRepository
    {
        private readonly Farm _farm;
        private readonly bool _isUserMember;

        public RecordingRepo(Farm farm, bool isUserMember)
        {
            _farm = farm;
            _isUserMember = isUserMember;
        }

        public List<AuditEvent> AuditEvents { get; } = new();

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult<Farm?>(_farm.Id.Value == farmId ? _farm : null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_isUserMember);

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // ---- everything else: NotSupportedException so any unexpected
        // codepath fails loudly. ----
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => Task.FromResult<CropScheduleTemplate?>(null);
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ScheduleSubscription?>(null);
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
    }
}
