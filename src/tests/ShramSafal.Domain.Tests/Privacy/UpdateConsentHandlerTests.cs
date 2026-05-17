// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — handler tests for UpdateConsentHandler. Fakes the
// repository so the test is fast (no DB) and asserts:
//   - first-time toggle on a missing row creates a default + applies
//   - revocation (true→false) stamps WithdrawnAtUtc on the new state
//   - audit row is appended with provenance fields populated
//   - re-update bumps Version when ConsentTextVersion changes

using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class UpdateConsentHandlerTests
{
    private static readonly Guid SampleUserId = Guid.NewGuid();
    private static readonly DateTime FixedNow = new(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task First_time_toggle_creates_default_then_applies()
    {
        var repo = new RecordingConsentRepo(); // no existing row
        var handler = new UpdateConsentHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(BuildCommand(fullHistory: true));

        result.IsSuccess.Should().BeTrue();
        result.Value!.FullHistoryJournal.Should().BeTrue();
        result.Value.Version.Should().Be(1);
        result.Value.GrantedAtUtc.Should().Be(FixedNow);

        repo.AddedStates.Should().HaveCount(1,
            "no prior row → handler must Add (not Update)");
        repo.UpdatedStates.Should().BeEmpty();
        repo.SaveCount.Should().Be(1);
    }

    [Fact]
    public async Task Revocation_stamps_WithdrawnAtUtc_on_new_state()
    {
        var existing = UserConsentState.Create(SampleUserId).Update(
            fullHistoryJournal: true,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 1,
            currentTokenKid: null,
            nowUtc: FixedNow.AddHours(-1));

        var repo = new RecordingConsentRepo { Existing = existing };
        var handler = new UpdateConsentHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(BuildCommand(fullHistory: false));

        result.IsSuccess.Should().BeTrue();
        result.Value!.FullHistoryJournal.Should().BeFalse();
        result.Value.WithdrawnAtUtc.Should().Be(FixedNow,
            "true→false on any purpose must stamp WithdrawnAtUtc");

        repo.UpdatedStates.Should().HaveCount(1);
        repo.AddedStates.Should().BeEmpty();
    }

    [Fact]
    public async Task Audit_row_carries_provenance_fields()
    {
        var repo = new RecordingConsentRepo();
        var handler = new UpdateConsentHandler(repo, new FixedClock(FixedNow));

        var cmd = BuildCommand(fullHistory: true) with
        {
            ClientAppVersion = "android-1.2.3",
            AuditDeviceId = "device-xyz",
            AuditIpHash = "sha256:deadbeef",
        };

        var result = await handler.HandleAsync(cmd);

        result.IsSuccess.Should().BeTrue();
        repo.AuditEntries.Should().HaveCount(1);

        var entry = repo.AuditEntries.Single();
        entry.UserId.Should().Be(SampleUserId);
        entry.ActorUserId.Should().Be(SampleUserId,
            "consent is always self-initiated (DPDP §6(1))");
        entry.ConsentTextVersion.Should().Be(1);
        entry.LanguageShown.Should().Be("mr-IN");
        entry.AppVersion.Should().Be("android-1.2.3");
        entry.DeviceId.Should().Be("device-xyz");
        entry.IpHash.Should().Be("sha256:deadbeef");
        entry.OccurredAtUtc.Should().Be(FixedNow);

        // old/new state snapshots are present so the DPDP §16 export
        // can replay the diff
        entry.OldStateJson.Should().Contain("\"fullHistoryJournal\":false");
        entry.NewStateJson.Should().Contain("\"fullHistoryJournal\":true");
    }

    [Fact]
    public async Task ReUpdate_bumps_Version_when_ConsentTextVersion_changes()
    {
        var existing = UserConsentState.Create(SampleUserId).Update(
            fullHistoryJournal: true,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 1,
            currentTokenKid: null,
            nowUtc: FixedNow.AddDays(-1));

        var repo = new RecordingConsentRepo { Existing = existing };
        var handler = new UpdateConsentHandler(repo, new FixedClock(FixedNow));

        var cmd = BuildCommand(fullHistory: true) with { ConsentTextVersion = 2 };

        var result = await handler.HandleAsync(cmd);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Version.Should().Be(2,
            "ConsentTextVersion delta drives the new row's version");
        repo.UpdatedStates.Should().HaveCount(1);
    }

    [Fact]
    public async Task Empty_userId_returns_auth_failure()
    {
        var repo = new RecordingConsentRepo();
        var handler = new UpdateConsentHandler(repo, new FixedClock(FixedNow));

        var cmd = BuildCommand(fullHistory: true) with { UserId = Guid.Empty };

        var result = await handler.HandleAsync(cmd);

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("join.unauthenticated");
        repo.AuditEntries.Should().BeEmpty();
        repo.AddedStates.Should().BeEmpty();
        repo.UpdatedStates.Should().BeEmpty();
    }

    // ---- helpers ----

    private static UpdateConsentCommand BuildCommand(bool fullHistory) => new(
        UserId: SampleUserId,
        FullHistoryJournal: fullHistory,
        CrossFarmAggregation: null,
        ResearchCorpusExport: null,
        LanguageShown: "mr-IN",
        ConsentTextVersion: 1,
        ClientAppVersion: "test-v1",
        AuditDeviceId: "test-device",
        AuditIpHash: "sha256:test");

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now, TimeSpan.Zero);
    }

    /// <summary>
    /// Hand-rolled IShramSafalRepository fake — mirrors the
    /// TenantDekHandlerTests.RecordingRepo pattern: only the methods the
    /// consent handler touches carry real bodies; everything else throws
    /// NotSupportedException so any unexpected codepath fails loudly.
    /// </summary>
    private sealed class RecordingConsentRepo : IShramSafalRepository
    {
        public UserConsentState? Existing { get; set; }
        public List<UserConsentState> AddedStates { get; } = new();
        public List<UserConsentState> UpdatedStates { get; } = new();
        public List<ConsentAuditEntry> AuditEntries { get; } = new();
        public int SaveCount { get; private set; }

        public Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(Existing);

        public Task AddUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        {
            AddedStates.Add(state);
            Existing = state;
            return Task.CompletedTask;
        }

        public Task UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        {
            UpdatedStates.Add(state);
            Existing = state;
            return Task.CompletedTask;
        }

        public Task AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct = default)
        {
            AuditEntries.Add(entry);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCount++;
            return Task.CompletedTask;
        }

        // ---- every other method throws so any unexpected codepath fails loudly ----
        // Mirrors TenantDekHandlerTests.RecordingRepo exactly so the
        // signature surface stays consistent across consent-domain tests.
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
    }
}
