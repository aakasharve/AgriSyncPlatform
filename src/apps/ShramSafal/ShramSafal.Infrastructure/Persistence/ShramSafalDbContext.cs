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

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — runtime authority for the
    /// provider × operation × mode capability matrix. Seeded from
    /// <c>_COFOUNDER/Projects/AgriSync/Architecture/CAPABILITY_MATRIX.md</c>;
    /// read by <c>AiOrchestrator</c> / <see cref="AiProviderConfig"/> to
    /// resolve which provider handles which operation. Mapped to
    /// <c>ssf.ai_provider_capabilities</c>.
    /// </summary>
    public DbSet<AiProviderCapability> AiProviderCapabilities => Set<AiProviderCapability>();

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.3 — re-transcription audit
    /// ledger (Safeguard S4). One row per
    /// <c>(audio_content_hash, provider, model_version, mode)</c>
    /// transcript produced. Mapped to <c>ssf.transcript_history</c>.
    /// RLS-exempt: global operational lookup with no farm dimension —
    /// audit replay queries run via admin-elevated contexts.
    /// </summary>
    public DbSet<TranscriptHistory> TranscriptHistories => Set<TranscriptHistory>();

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.4 — admin-managed feature
    /// flag table (Safeguard S7) that backs cohort rollout for the
    /// Sarvam pipeline and other gated capabilities. Mapped to
    /// <c>ssf.feature_flags</c>. RLS-exempt: global operational table
    /// administered via the <c>/shramsafal/admin/feature-flags</c>
    /// surface.
    /// </summary>
    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5 — data-driven trigger →
    /// Sarvam-mode-list policy per ADR-DS-016. Mapped to
    /// <c>ssf.mode_policy</c>. RLS-exempt: global operational lookup
    /// read by the voice worker on every clip evaluation.
    /// </summary>
    public DbSet<ModePolicy> ModePolicies => Set<ModePolicy>();

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5a — diarization-as-capability
    /// policy (founder blocker #4: diarization is NOT a Sarvam STT
    /// mode). Mapped to <c>ssf.diarization_policy</c>. RLS-exempt: same
    /// posture as <see cref="ModePolicies"/>.
    /// </summary>
    public DbSet<DiarizationPolicy> DiarizationPolicies => Set<DiarizationPolicy>();
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
    /// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — live consent state
    /// for each user (one row per user, primary key
    /// <see cref="UserConsentState.UserId"/>). Mapped to
    /// <c>ssf.user_consent_state</c>. RLS-exempt: user-keyed not
    /// farm-keyed; handler-level guard via <c>ICurrentUser</c>. See
    /// ADR-DS-008.
    /// </summary>
    public DbSet<UserConsentState> UserConsentStates => Set<UserConsentState>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — append-only ledger
    /// of every consent change. Mapped to <c>ssf.consent_audit</c>;
    /// migration REVOKEs UPDATE + DELETE from <c>agrisync_app</c>.
    /// Append-only by privilege, mirrors the Phase 04 audit-events
    /// doctrine. RLS-exempt: user-keyed; handler-level guard.
    /// </summary>
    public DbSet<ConsentAuditEntry> ConsentAuditEntries => Set<ConsentAuditEntry>();

    /// <summary>
    /// Voice Diary ship (voice-diary-e2e-2026-05-17) — retained-tier
    /// voice clip metadata. One row per clip that the user has chosen
    /// to keep beyond the 30-day local journal (gated by
    /// <see cref="UserConsentState.FullHistoryJournal"/>). Mapped to
    /// <c>ssf.voice_clips_retained</c>. RLS-exempt in this ship
    /// (user-keyed; handler boundary enforces); Phase 07 layers RLS.
    /// The ciphertext lives in S3 via <c>IRetainedBlobStore</c>; this
    /// table holds the envelope metadata + S3 pointer + accounting
    /// fields. Server NEVER decrypts.
    /// </summary>
    public DbSet<VoiceClipRetained> VoiceClipsRetained => Set<VoiceClipRetained>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 — DPDP §12 erasure
    /// request queue. Mapped to <c>ssf.erasure_requests</c>. RLS-exempt
    /// (user-keyed admin-only surface). Processed asynchronously by
    /// <c>ErasureWorker</c> (08.2) per the DS-017 5-rule ANONYMIZE
    /// contract.
    /// </summary>
    public DbSet<ErasureRequest> ErasureRequests => Set<ErasureRequest>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 — DPDP §11 / §11(1)(c)
    /// data-access + portability export queue. Mapped to
    /// <c>ssf.export_requests</c>. RLS-exempt. Processed by
    /// <c>ExportWorker</c> (08.3) which writes a ZIP per the OQ-3
    /// manifest to <c>s3://agrisync-exports/{userId}/{requestId}.zip</c>
    /// and stamps a 24h-TTL presigned URL.
    /// </summary>
    public DbSet<ExportRequest> ExportRequests => Set<ExportRequest>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 / 08.4 — append-only
    /// ledger of every <c>RetentionSweepWorker</c> daily run. Mapped to
    /// <c>ssf.retention_sweep_runs</c>. RLS-exempt.
    /// </summary>
    public DbSet<RetentionSweepRun> RetentionSweepRuns => Set<RetentionSweepRun>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 / 08.5 — DPDP §8(6)
    /// + 2025 Rules Rule 7 breach incident records. Mapped to
    /// <c>ssf.breach_incidents</c>. Scaffolding only in Phase 08 (OQ-5
    /// — no SendGrid dispatch wired yet; Phase 12+ rebinds the dispatch
    /// adapter). RLS-exempt (admin-only surface).
    /// </summary>
    public DbSet<BreachIncident> BreachIncidents => Set<BreachIncident>();

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.2 — third-party PII
    /// review-queue ledger. Mapped to <c>ssf.pii_review_queue</c>.
    /// Admin-only surface so no farm-scoped RLS (allowlisted in
    /// <c>RlsExemptionAllowlistTests</c>); the migration revokes DELETE
    /// to keep the queue append-only. Reviewers transition row status
    /// via <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry.Approve"/> /
    /// <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry.Reject"/>.
    /// </summary>
    public DbSet<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry> PiiReviewQueueEntries =>
        Set<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>();

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
