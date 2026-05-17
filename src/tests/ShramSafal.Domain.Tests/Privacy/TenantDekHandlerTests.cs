// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — handler-level tests for IssueTenantDek + ResolveTenantDek.
// These are fast (no KMS, no Docker) and cover the auth surface explicitly
// flagged in the envelope:
//
//   (c) handler returns auth-failure when TenantContext.OwnerAccountId is null
//
// The KMS round-trip itself is exercised by
// TenantDekServiceIntegrationTests against a LocalStack KMS container —
// see src/tests/ShramSafal.Sync.IntegrationTests/Security/. Splitting auth
// surface (here) from wire surface (there) keeps the dev-loop fast.

using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Security;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Privacy.IssueTenantDek;
using ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;
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

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class TenantDekHandlerTests
{
    private static readonly Guid OwnerUserId = Guid.NewGuid();
    private static readonly Guid OwnerAccountId = Guid.NewGuid();
    private static readonly Guid FarmGuid = Guid.NewGuid();

    [Fact]
    public async Task Issue_NoOwnerAccountInTenantContext_ReturnsAuthFailure_AndDoesNotIssueDek()
    {
        var dek = new RecordingTenantDekService();
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext(); // OwnerAccountId stays null
        var handler = new IssueTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildIssueCommand());

        result.IsSuccess.Should().BeFalse(
            "no tenant claim means no plaintext DEK should ever be issued");
        result.Error.Code.Should().Be("join.unauthenticated");
        dek.IssueCallCount.Should().Be(0,
            "the handler must short-circuit BEFORE touching the DEK service");
        repo.AuditEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task Issue_HappyPath_ReturnsDekAndEmitsOneAuditRow()
    {
        var dek = new RecordingTenantDekService();
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(FarmGuid, OwnerAccountId, OwnerUserId);
        var handler = new IssueTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildIssueCommand());

        result.IsSuccess.Should().BeTrue();
        result.Value!.DekId.Should().NotBeNullOrWhiteSpace();
        result.Value.DekBase64.Should().NotBeNullOrWhiteSpace();
        // Verifies the AES-256 contract end-to-end: the 32-byte plaintext
        // round-trips through base64 to a 44-char string.
        Convert.FromBase64String(result.Value.DekBase64).Length.Should().Be(32);

        dek.IssueCallCount.Should().Be(1);
        dek.LastIssueOwner.Should().Be(OwnerAccountId,
            "the DEK must be bound to the tenant from TenantContext, not from the command");
        repo.AuditEvents.Should().HaveCount(1);
        var audit = repo.AuditEvents.Single();
        audit.EntityType.Should().Be("TenantDek");
        audit.Action.Should().Be("Issued");
        audit.ActorUserId.Value.Should().Be(OwnerUserId);
        audit.FarmId.Should().Be(FarmGuid);
    }

    [Fact]
    public async Task Resolve_NoOwnerAccountInTenantContext_ReturnsAuthFailure_AndDoesNotCallKms()
    {
        var dek = new RecordingTenantDekService();
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext();
        var handler = new ResolveTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildResolveCommand("some-dek-id"));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("join.unauthenticated");
        dek.ResolveCallCount.Should().Be(0);
        repo.AuditEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task Resolve_EmptyDekId_ReturnsValidationFailure()
    {
        var dek = new RecordingTenantDekService();
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(FarmGuid, OwnerAccountId, OwnerUserId);
        var handler = new ResolveTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildResolveCommand(""));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.InvalidCommand");
        dek.ResolveCallCount.Should().Be(0);
    }

    [Fact]
    public async Task Resolve_WhenKmsReturnsNull_EmitsResolveFailedAudit_AndReturnsNotFound()
    {
        var dek = new RecordingTenantDekService { NextResolveResult = null };
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(FarmGuid, OwnerAccountId, OwnerUserId);
        var handler = new ResolveTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildResolveCommand("wrong-tenant-dek-id"));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TenantDekNotFound");
        repo.AuditEvents.Should().HaveCount(1);
        var audit = repo.AuditEvents.Single();
        audit.Action.Should().Be("ResolveFailed",
            "audit must record failed unwrap attempts so DPDP §16 export can replay them");
    }

    [Fact]
    public async Task Resolve_HappyPath_EmitsResolvedAudit_AndReturnsPlaintext()
    {
        var dek = new RecordingTenantDekService { NextResolveResult = new byte[32] };
        var repo = new RecordingRepo();
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(FarmGuid, OwnerAccountId, OwnerUserId);
        var handler = new ResolveTenantDekHandler(repo, dek, tenantContext);

        var result = await handler.HandleAsync(BuildResolveCommand("valid-dek-id"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.DekBase64.Should().NotBeNullOrWhiteSpace();
        repo.AuditEvents.Single().Action.Should().Be("Resolved");
    }

    // ---- builders ----

    private static IssueTenantDekCommand BuildIssueCommand() => new(
        UserId: OwnerUserId,
        ClientAppVersion: "test-v1",
        ActorRole: "Owner",
        AuditDeviceId: "test-device",
        AuditIpHash: "sha256:test");

    private static ResolveTenantDekCommand BuildResolveCommand(string dekId) => new(
        UserId: OwnerUserId,
        DekId: dekId,
        ClientAppVersion: "test-v1",
        ActorRole: "Owner",
        AuditDeviceId: "test-device",
        AuditIpHash: "sha256:test");

    // ---- doubles ----

    /// <summary>
    /// Hand-rolled fake — the codebase has no mocking framework, only fakes
    /// (consistent with CoVeReverifyHandlerTests.FakeGeminiProvider). Records
    /// inputs so tests can assert that the handler short-circuited before
    /// hitting the port when expected.
    /// </summary>
    private sealed class RecordingTenantDekService : ITenantDekService
    {
        public int IssueCallCount { get; private set; }
        public int ResolveCallCount { get; private set; }
        public Guid LastIssueOwner { get; private set; }

        public byte[]? NextResolveResult { get; set; } = new byte[32];

        public Task<TenantDek> IssueAsync(Guid ownerAccountId, CancellationToken ct)
        {
            IssueCallCount++;
            LastIssueOwner = ownerAccountId;
            return Task.FromResult(new TenantDek(
                DekId: "test-dek-id",
                DekBytes: new byte[32],
                ExpiresAtUtc: DateTime.UtcNow.AddHours(24)));
        }

        public Task<byte[]?> ResolveAsync(Guid ownerAccountId, string dekId, CancellationToken ct)
        {
            ResolveCallCount++;
            return Task.FromResult(NextResolveResult);
        }
    }

    private sealed class RecordingRepo : IShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = new();

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // ---- every other method throws so any unexpected codepath fails loudly ----
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
