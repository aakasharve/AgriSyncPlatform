// spec: data-principle-spine-2026-05-05/phase-07-spine-hardening
//
// ADR-DS-009 §"Audit-payload kid stamp" — every PersistVoiceClipRetained
// success path MUST emit an AuditEvent whose Payload JSON contains
// consentTokenKid = UserConsentState.CurrentTokenKid at the time of persist.
//
// Verifier reads this field on right-to-access export to prove which signed
// token authorized the retention.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class PersistVoiceClipRetainedHandlerKidStampTest
{
    [Fact(DisplayName = "PersistVoiceClipRetained stamps consent_token_kid into AuditEvent payload")]
    public async Task PersistVoiceClipRetained_StampsConsentTokenKid()
    {
        var userId = Guid.NewGuid();
        var clipId = Guid.NewGuid();
        const string kid = "kid-2026-05-21-test";
        var nowUtc = new DateTime(2026, 5, 21, 12, 0, 0, DateTimeKind.Utc);

        // Seed UserConsentState with FullHistoryJournal=true and a kid.
        var consentState = UserConsentState
            .Create(userId)
            .Update(
                fullHistoryJournal: true,
                crossFarmAggregation: null,
                researchCorpusExport: null,
                consentTextVersion: 1,
                currentTokenKid: kid,
                nowUtc: nowUtc);

        var repo = new FakeRepository(consentState);
        var enforcer = new StubConsentEnforcer(allow: true);
        var blobStore = new StubRetainedBlobStore();
        var clock = new FixedClock(nowUtc);

        var handler = new PersistVoiceClipRetainedHandler(enforcer, blobStore, repo, clock);

        var cipherBytes = new byte[] { 0x01, 0x02, 0x03 };
        var command = new PersistVoiceClipRetainedCommand(
            ClipId: clipId,
            UserId: userId,
            RecordedAtUtc: nowUtc,
            CipherBase64: Convert.ToBase64String(cipherBytes),
            DekId: "dek-1",
            IvBase64: "AAAA",
            AuthTagBase64: "AAAA",
            DurationSeconds: 5,
            Language: "mr-IN");

        var result = await handler.HandleAsync(command, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ClipId.Should().Be(clipId);

        repo.AuditEvents.Should().HaveCount(1);
        var persistAudit = repo.AuditEvents[0];
        persistAudit.EntityType.Should().Be("VoiceClipRetained");
        persistAudit.Action.Should().Be("Persisted");
        persistAudit.EntityId.Should().Be(clipId);

        // The factory serialised the payload with camelCase policy; the
        // kid value must be embedded.
        persistAudit.Payload.Should().Contain($"\"consentTokenKid\":\"{kid}\"");
        repo.SaveCount.Should().BeGreaterThanOrEqualTo(1,
            "the handler must persist the audit row via SaveChangesAsync");
    }

    [Fact(DisplayName = "PersistVoiceClipRetained tolerates null consent token kid (pre-issuance)")]
    public async Task PersistVoiceClipRetained_NullKid_StillEmitsAudit()
    {
        var userId = Guid.NewGuid();
        var clipId = Guid.NewGuid();
        var nowUtc = new DateTime(2026, 5, 21, 12, 0, 0, DateTimeKind.Utc);

        // Granted but no token issued yet → CurrentTokenKid is null.
        var consentState = UserConsentState
            .Create(userId)
            .Update(
                fullHistoryJournal: true,
                crossFarmAggregation: null,
                researchCorpusExport: null,
                consentTextVersion: 1,
                currentTokenKid: null,
                nowUtc: nowUtc);

        var repo = new FakeRepository(consentState);
        var enforcer = new StubConsentEnforcer(allow: true);
        var blobStore = new StubRetainedBlobStore();
        var clock = new FixedClock(nowUtc);

        var handler = new PersistVoiceClipRetainedHandler(enforcer, blobStore, repo, clock);

        var command = new PersistVoiceClipRetainedCommand(
            ClipId: clipId,
            UserId: userId,
            RecordedAtUtc: nowUtc,
            CipherBase64: Convert.ToBase64String(new byte[] { 0x01 }),
            DekId: "dek-1",
            IvBase64: "AAAA",
            AuthTagBase64: "AAAA",
            DurationSeconds: 5,
            Language: "mr-IN");

        var result = await handler.HandleAsync(command, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        repo.AuditEvents.Should().HaveCount(1);
        // The payload still carries the field — with a JSON null value.
        repo.AuditEvents[0].Payload.Should().Contain("\"consentTokenKid\":null");
    }

    private sealed class StubConsentEnforcer(bool allow) : IConsentEnforcer
    {
        public Task<ConsentDecision> RequireGrantAsync(
            Guid userId, ConsentPurpose purpose, CancellationToken ct)
            => Task.FromResult(allow
                ? ConsentDecision.Allowed
                : ConsentDecision.Denied("test_deny"));
    }

    private sealed class StubRetainedBlobStore : IRetainedBlobStore
    {
        public Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
            => Task.CompletedTask;

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
            => Task.FromResult(metadata.ClipId);

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
            => Task.FromResult<RetainedClipResult?>(null);

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
            => Task.FromResult<IReadOnlyList<VoiceClipRetainedListItem>>(Array.Empty<VoiceClipRetainedListItem>());
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    /// <summary>
    /// Minimal IShramSafalRepository for the kid-stamp test. Only the
    /// methods the handler touches (GetUserConsentStateAsync,
    /// AddAuditEventAsync, SaveChangesAsync) are wired; everything else
    /// throws so a refactor that routes through a new path can't slip
    /// past silently.
    /// </summary>
    private sealed class FakeRepository(UserConsentState consentState) : IShramSafalRepository
    {
        private readonly UserConsentState _consentState = consentState;
        public List<AuditEvent> AuditEvents { get; } = new();
        public int SaveCount { get; private set; }

        public Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult<UserConsentState?>(
                userId == _consentState.UserId ? _consentState : null);

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCount++;
            return Task.CompletedTask;
        }

        // Everything below is intentionally unwired.
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmBoundary?> GetActiveFarmBoundaryAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotImplementedException();
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
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => throw new NotImplementedException();
    }
}
