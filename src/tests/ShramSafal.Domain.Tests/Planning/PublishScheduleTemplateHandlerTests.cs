using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PublishScheduleTemplateHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid AuthorId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static ScheduleTemplate MakeTemplate(Guid authorId, Guid? templateId = null)
    {
        return ScheduleTemplate.Create(
            templateId ?? Guid.NewGuid(),
            "Grape May",
            "Flowering",
            Now.AddDays(-10),
            createdByUserId: new UserId(authorId),
            tenantScope: TenantScope.Private);
    }

    private static PublishScheduleTemplateHandler CreateHandler(FakePublishRepo repo)
    {
        var clock = new FakeClock(Now);
        var mutations = new FakeSyncMutationStore();
        return new PublishScheduleTemplateHandler(repo, mutations, clock);
    }

    [Fact]
    public async Task Publish_AuthorOnly_NonAuthor_Returns_Forbidden()
    {
        var template = MakeTemplate(AuthorId);
        var repo = new FakePublishRepo(template);
        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: OtherId, // NOT the author
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal("ShramSafal.Forbidden", result.Error.Code);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Publish_SetsPublishedAtUtc_And_EmitsAuditEvent()
    {
        var template = MakeTemplate(AuthorId);
        var repo = new FakePublishRepo(template);
        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null));

        Assert.True(result.IsSuccess);
        Assert.Equal(Now, result.Value.PublishedAtUtc);
        Assert.Equal(1, result.Value.Version);
        Assert.NotNull(template.PublishedAtUtc);
        Assert.Equal(Now, template.PublishedAtUtc!.Value);

        Assert.Single(repo.AuditEvents);
        Assert.Equal("schedule.published", repo.AuditEvents[0].Action);
        Assert.Equal(1, repo.SaveCalls);
    }

    // ---------------------------------------------------------------------------
    //  Private fake infrastructure
    // ---------------------------------------------------------------------------

    private sealed class FakePublishRepo : IShramSafalRepository
    {
        private readonly ScheduleTemplate? _template;

        public FakePublishRepo(ScheduleTemplate? template)
        {
            _template = template;
        }

        public List<AuditEvent> AuditEvents { get; } = new();
        public int SaveCalls { get; private set; }

        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
            Task.FromResult(_template?.Id == templateId ? _template : null);

        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(false);

        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) =>
            Task.CompletedTask;

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }

        // --- stubs ---
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();

        // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
        // required interface members; no-op in this test stub.
        public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeClock : AgriSync.BuildingBlocks.Abstractions.IClock
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
