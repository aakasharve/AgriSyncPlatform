using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Corrections;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Work;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;
using ShramSafal.Domain.Subscriptions;
using ShramSafal.Domain.Tests;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Persistence;

public sealed class ShramSafalDbContext(DbContextOptions<ShramSafalDbContext> options) : DbContext(options)
{
    public DbSet<Farm> Farms => Set<Farm>();
    public DbSet<FarmBoundary> FarmBoundaries => Set<FarmBoundary>();
    public DbSet<FarmMembership> FarmMemberships => Set<FarmMembership>();
    public DbSet<FarmInvitation> FarmInvitations => Set<FarmInvitation>();
    public DbSet<FarmJoinToken> FarmJoinTokens => Set<FarmJoinToken>();
    public DbSet<SubscriptionProjection> SubscriptionProjections => Set<SubscriptionProjection>();
    public DbSet<Plot> Plots => Set<Plot>();
    public DbSet<CropCycle> CropCycles => Set<CropCycle>();
    public DbSet<DailyLog> DailyLogs => Set<DailyLog>();
    public DbSet<LogTask> LogTasks => Set<LogTask>();
    public DbSet<VerificationEvent> VerificationEvents => Set<VerificationEvent>();
    public DbSet<CostEntry> CostEntries => Set<CostEntry>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE sub-phase 02.5 — canonical 13-code cost-category
    /// lookup. Every <see cref="CostEntry.CategoryId"/> is an FK into this set.
    /// Mapped to <c>ssf.cost_categories</c>.
    /// </summary>
    public DbSet<CostCategory> CostCategories => Set<CostCategory>();
    public DbSet<FinanceCorrection> FinanceCorrections => Set<FinanceCorrection>();
    public DbSet<DayLedger> DayLedgers => Set<DayLedger>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<PriceConfig> PriceConfigs => Set<PriceConfig>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<AiJob> AiJobs => Set<AiJob>();
    public DbSet<AiJobAttempt> AiJobAttempts => Set<AiJobAttempt>();
    public DbSet<AiProviderConfig> AiProviderConfigs => Set<AiProviderConfig>();
    public DbSet<ScheduleTemplate> ScheduleTemplates => Set<ScheduleTemplate>();
    public DbSet<TemplateActivity> TemplateActivities => Set<TemplateActivity>();
    public DbSet<PlannedActivity> PlannedActivities => Set<PlannedActivity>();
    public DbSet<CropScheduleTemplate> CropScheduleTemplates => Set<CropScheduleTemplate>();
    public DbSet<ScheduleSubscription> ScheduleSubscriptions => Set<ScheduleSubscription>();
    public DbSet<ScheduleMigrationEvent> ScheduleMigrationEvents => Set<ScheduleMigrationEvent>();
    public DbSet<DocumentExtractionSession> DocumentExtractionSessions => Set<DocumentExtractionSession>();
    public DbSet<TestProtocol> TestProtocols => Set<TestProtocol>();
    public DbSet<TestInstance> TestInstances => Set<TestInstance>();
    public DbSet<TestRecommendation> TestRecommendations => Set<TestRecommendation>();
    public DbSet<ComplianceSignal> ComplianceSignals => Set<ComplianceSignal>();
    public DbSet<JobCard> JobCards => Set<JobCard>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<OrganizationMembership> OrganizationMemberships => Set<OrganizationMembership>();
    public DbSet<OrganizationFarmScope> OrganizationFarmScopes => Set<OrganizationFarmScope>();

    // spec: correctionevent-server-persistence
    public DbSet<CorrectionEvent> CorrectionEvents => Set<CorrectionEvent>();

    // DWC v2 §3.3 / ADR 2026-05-04 wtl-v0-entity-shape — passive
    // server-side worker reuse ledger. NEVER farmer-facing in v0.
    public DbSet<Worker> Workers => Set<Worker>();
    public DbSet<WorkerAssignment> WorkerAssignments => Set<WorkerAssignment>();

    internal DbSet<SyncMutationRecord> SyncMutations => Set<SyncMutationRecord>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 02 sub-phase 02.2: persisted
    /// ref-count index for content-addressed raw blobs parked in the cold tier
    /// (S3). Mapped to <c>ssf.raw_blob_index</c>.
    /// </summary>
    public DbSet<RawBlobIndexEntry> RawBlobIndices => Set<RawBlobIndexEntry>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 02 sub-phase 02.3: warm-tier
    /// transcript projection for AI job attempts. One row per
    /// <see cref="AiJobAttempt"/>. Mapped to <c>ssf.transcripts</c>.
    /// </summary>
    public DbSet<Transcript> Transcripts => Set<Transcript>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.5 — DPDP §8(2) Data
    /// Processing Agreement registry (one row per third-party processor).
    /// Mapped to <c>ssf.dpa_registry</c>. The startup gap-warning in
    /// <c>Program.cs</c> queries this set for <c>IsActive=false</c> rows
    /// and emits one <c>LogWarning</c> listing the pending vendors.
    /// </summary>
    public DbSet<DpaRecord> DpaRecords => Set<DpaRecord>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.6 — append-only log of
    /// outbound calls to non-India processors. Mapped to
    /// <c>ssf.cross_border_transfers</c>. RLS-exempt per OQ-5: admin-only
    /// read path (Phase 08), system-only write path
    /// (<c>GeminiAiProvider</c> via <see cref="AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory{TContext}"/>).
    /// </summary>
    public DbSet<CrossBorderTransfer> CrossBorderTransfers => Set<CrossBorderTransfer>();

    /// <summary>
    /// T-IGH-03-OUTBOX-WIRING: outbox queue. Domain events raised on
    /// any tracked aggregate are flushed into this DbSet by
    /// <see cref="DomainEventToOutboxInterceptor"/> in the same
    /// SaveChanges call as the aggregate's writes, so the OutboxMessage
    /// row is committed atomically with the business state.
    /// </summary>
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("ssf");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ShramSafalDbContext).Assembly);

        // T-IGH-03-OUTBOX-WIRING: outbox table sits alongside the
        // ShramSafal aggregates in the ssf schema so the
        // DomainEventToOutboxInterceptor can write OutboxMessage rows
        // in the same transaction as the aggregate. Configuration is
        // shared with the OutboxDbContext / other writing contexts.
        modelBuilder.ApplyConfiguration(new OutboxMessageConfiguration());
    }
}
