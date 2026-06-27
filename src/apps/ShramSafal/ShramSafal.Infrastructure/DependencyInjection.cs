using System.Globalization;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Corrections;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using ShramSafal.Infrastructure.Integrations.Weather;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Infrastructure.Storage;
using ShramSafal.Infrastructure.Reports;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.Events;
using ShramSafal.Infrastructure.Audio;
using ShramSafal.Infrastructure.Wtl;

namespace ShramSafal.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddShramSafalInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString =
            configuration.GetConnectionString("ShramSafalDb") ??
            configuration.GetConnectionString("UserDb") ??
            throw new InvalidOperationException("Connection string 'ShramSafalDb' or 'UserDb' is required.");

        // T-IGH-03-OUTBOX-WIRING: outbox interceptors. The save-side
        // interceptor adds OutboxMessage rows in the same SaveChanges
        // as the aggregate's writes; the transaction-side interceptor
        // closes the explicit-transaction rollback hole that the
        // save-side interceptor cannot cover by itself. Both are
        // singletons (stateless apart from per-context snapshots
        // tracked via ConditionalWeakTable, which scope to the
        // DbContext lifetime).
        services.TryAddSingleton<DomainEventToOutboxInterceptor>(sp =>
            new DomainEventToOutboxInterceptor(TimeProvider.System));
        services.TryAddSingleton<OutboxTransactionInterceptor>(sp =>
            new OutboxTransactionInterceptor(sp.GetRequiredService<DomainEventToOutboxInterceptor>()));

        // DATA_PRINCIPLE_SPINE 03.2 — TenantContext + Interceptor must be
        // registered here (not only in Program.cs) so the Sync Integration
        // test harness picks them up when it calls AddShramSafalInfrastructure
        // without going through Bootstrapper. TryAddScoped is a no-op if
        // Program.cs already registered them; idempotent.
        services.TryAddScoped<AgriSync.BuildingBlocks.Persistence.TenantContext>();
        services.TryAddScoped<AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor>();

        // DATA_PRINCIPLE_SPINE 02-patch — IRawBlobStore must resolve in the
        // test harness too. Production Program.cs registers S3RawBlobStore
        // after AddShramSafalInfrastructure runs; that registration wins
        // (last-in for AddScoped). TryAdd is for test harnesses that
        // never call into Program.cs.
        services.TryAddScoped<ShramSafal.Application.Storage.IRawBlobStore,
            ShramSafal.Infrastructure.Storage.InMemoryRawBlobStore>();

        // voice-diary-e2e-2026-05-17 (B.3 fix) — IConsentEnforcer must
        // resolve in the test harness too. Same pattern as IRawBlobStore
        // above: production Program.cs explicitly AddScoped's the real
        // ConsentEnforcer; TryAddScoped here ensures test harnesses that
        // call AddShramSafalInfrastructure (without going through
        // Bootstrapper) still resolve it. ConsentEnforcer only needs
        // IShramSafalRepository which test harnesses always have.
        services.TryAddScoped<ShramSafal.Application.Privacy.Ports.IConsentEnforcer,
            ShramSafal.Infrastructure.Privacy.ConsentEnforcer>();

        // DATA_PRINCIPLE_SPINE 03.6 — register the writing-context
        // registry singleton (or reuse the existing one) and append
        // ShramSafalDbContext as a writing context the
        // TenantTransactionMiddleware must open a tx on. AddUserInfrastructure
        // performs the symmetric registration for UserDbContext. Order:
        // ShramSafal first, User second (matches historical 03.2 default).
        var ssfWritingContexts = services
            .EnsureTenantScopedRegistry();
        ssfWritingContexts.Register<ShramSafalDbContext>();

        // DATA_PRINCIPLE_SPINE 03.5 — admin cross-tenant escape hatch.
        // Returns a fresh ShramSafalDbContext whose options chain has
        // NO TenantConnectionInterceptor attached (so commands leave
        // without the set_config(...) prelude that would otherwise
        // fail-closed). Every CreateAsync call writes an
        // AuditEvent("admin_cross_tenant","open") row BEFORE returning
        // the primary context. Scoped so it can resolve IConfiguration
        // without dragging in a Singleton constraint on appsettings
        // reload semantics. The 4 existing ElevateToAdminCrossTenant()
        // call sites (ComplianceEvaluatorSweeper, TestOverdueSweeper,
        // WorkerRetentionJob, BackfillFarmOwnerAccounts) migrate to
        // this factory in sub-phase 03.5b — explicitly out of scope here.
        services.AddScoped<
            AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory<ShramSafalDbContext>,
            ShramSafalAdminDbContextFactory>();

        services.AddDbContext<ShramSafalDbContext>((sp, options) =>
            options.UseNpgsql(
                connectionString,
                npgsql =>
                {
                    npgsql.MigrationsHistoryTable("__ef_migrations", "ssf");
                    // DATA_PRINCIPLE_SPINE 03.2/03.6 — EnableRetryOnFailure
                    // was removed because TenantTransactionMiddleware wraps
                    // the entire HTTP request in an explicit transaction
                    // (so set_config(...,true) GUCs propagate across every
                    // command). EF Core's NpgsqlRetryingExecutionStrategy
                    // is incompatible with user-initiated transactions and
                    // throws "execution strategy does not support
                    // user-initiated transactions" on BeginTransactionAsync.
                    // An HTTP pipeline cannot be safely retried anyway;
                    // PushSyncBatchHandler's existing
                    // dbContext.Database.CreateExecutionStrategy() call
                    // becomes a no-op single-shot strategy — its
                    // idempotency story is unchanged.
                })
                // DATA_PRINCIPLE_SPINE 03.2 — TenantConnectionInterceptor
                // (Scoped) stamps each command with the per-request
                // agrisync.farm_id / agrisync.owner_account_id GUCs that
                // Phase 03.3 RLS policies key on. The outbox interceptors
                // remain Singletons; mixing lifetimes inside one
                // AddInterceptors call is supported because EF Core
                // resolves each entry independently via the sp captured
                // by the (sp, options) overload.
                .AddInterceptors(
                    sp.GetRequiredService<DomainEventToOutboxInterceptor>(),
                    sp.GetRequiredService<OutboxTransactionInterceptor>(),
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor>()));
        services.AddScoped<DbContext>(provider => provider.GetRequiredService<ShramSafalDbContext>());

        services.Configure<GeminiOptions>(options =>
        {
            var section = configuration.GetSection(GeminiOptions.SectionName);

            if (!string.IsNullOrWhiteSpace(section["ApiKey"]))
            {
                options.ApiKey = section["ApiKey"]!.Trim();
            }

            var legacyModelId = !string.IsNullOrWhiteSpace(section["ModelId"])
                ? section["ModelId"]!.Trim()
                : !string.IsNullOrWhiteSpace(section["Model"])
                    ? section["Model"]!.Trim()
                    : null;

            if (!string.IsNullOrWhiteSpace(section["StructurerModelId"]))
            {
                options.StructurerModelId = section["StructurerModelId"]!.Trim();
            }
            else if (!string.IsNullOrWhiteSpace(legacyModelId))
            {
                options.StructurerModelId = legacyModelId;
            }

            if (!string.IsNullOrWhiteSpace(section["OcrModelId"]))
            {
                options.OcrModelId = section["OcrModelId"]!.Trim();
            }
            else if (!string.IsNullOrWhiteSpace(legacyModelId))
            {
                options.OcrModelId = legacyModelId;
            }

            if (!string.IsNullOrWhiteSpace(section["VoiceFallbackModelId"]))
            {
                options.VoiceFallbackModelId = section["VoiceFallbackModelId"]!.Trim();
            }
            else if (!string.IsNullOrWhiteSpace(legacyModelId))
            {
                options.VoiceFallbackModelId = legacyModelId;
            }

            if (!string.IsNullOrWhiteSpace(section["BaseUrl"]))
            {
                options.BaseUrl = section["BaseUrl"]!.Trim();
            }

            if (decimal.TryParse(section["Temperature"], NumberStyles.Float, CultureInfo.InvariantCulture, out var temperature))
            {
                options.Temperature = temperature;
            }

            if (int.TryParse(section["MaxTokens"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var maxTokens))
            {
                options.MaxTokens = maxTokens;
            }

            if (int.TryParse(section["TimeoutSeconds"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var timeoutSeconds))
            {
                options.TimeoutSeconds = timeoutSeconds;
            }
        });

        services.PostConfigure<GeminiOptions>(options =>
        {
            var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                options.ApiKey = apiKey.Trim();
            }
        });

        services.Configure<SarvamOptions>(options =>
        {
            var section = configuration.GetSection(SarvamOptions.SectionName);
            if (!string.IsNullOrWhiteSpace(section["ApiSubscriptionKey"]))
            {
                options.ApiSubscriptionKey = section["ApiSubscriptionKey"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["SttEndpoint"]))
            {
                options.SttEndpoint = section["SttEndpoint"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["SttModel"]))
            {
                options.SttModel = section["SttModel"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["SttMode"]))
            {
                options.SttMode = section["SttMode"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["SttLanguage"]))
            {
                options.SttLanguage = section["SttLanguage"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["StreamingSttEndpoint"]))
            {
                options.StreamingSttEndpoint = section["StreamingSttEndpoint"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["StreamingSttModel"]))
            {
                options.StreamingSttModel = section["StreamingSttModel"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["StreamingSttMode"]))
            {
                options.StreamingSttMode = section["StreamingSttMode"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["StreamingSttLanguage"]))
            {
                options.StreamingSttLanguage = section["StreamingSttLanguage"]!.Trim();
            }

            if (int.TryParse(section["StreamingSampleRate"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var streamingSampleRate))
            {
                options.StreamingSampleRate = streamingSampleRate;
            }

            if (!string.IsNullOrWhiteSpace(section["StreamingInputAudioCodec"]))
            {
                options.StreamingInputAudioCodec = section["StreamingInputAudioCodec"]!.Trim();
            }

            if (bool.TryParse(section["StreamingHighVadSensitivity"], out var streamingHighVadSensitivity))
            {
                options.StreamingHighVadSensitivity = streamingHighVadSensitivity;
            }

            if (bool.TryParse(section["StreamingVadSignals"], out var streamingVadSignals))
            {
                options.StreamingVadSignals = streamingVadSignals;
            }

            if (bool.TryParse(section["StreamingFlushSignal"], out var streamingFlushSignal))
            {
                options.StreamingFlushSignal = streamingFlushSignal;
            }

            if (int.TryParse(section["StreamingTimeoutSeconds"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var streamingTimeoutSeconds))
            {
                options.StreamingTimeoutSeconds = streamingTimeoutSeconds;
            }

            if (!string.IsNullOrWhiteSpace(section["ChatEndpoint"]))
            {
                options.ChatEndpoint = section["ChatEndpoint"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["ChatModel"]))
            {
                options.ChatModel = section["ChatModel"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["VisionModel"]))
            {
                options.VisionModel = section["VisionModel"]!.Trim();
            }

            if (decimal.TryParse(section["ChatTemperature"], NumberStyles.Float, CultureInfo.InvariantCulture, out var temperature))
            {
                options.ChatTemperature = temperature;
            }

            if (int.TryParse(section["TimeoutSeconds"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var timeoutSeconds))
            {
                options.TimeoutSeconds = timeoutSeconds;
            }

            if (!string.IsNullOrWhiteSpace(section["DocIntelEndpoint"]))
            {
                options.DocIntelEndpoint = section["DocIntelEndpoint"]!.Trim();
            }

            if (int.TryParse(section["DocIntelTimeoutSeconds"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var docIntelTimeout))
            {
                options.DocIntelTimeoutSeconds = docIntelTimeout;
            }

        });

        services.PostConfigure<SarvamOptions>(options =>
        {
            var key = Environment.GetEnvironmentVariable("SARVAM_API_SUBSCRIPTION_KEY");
            if (!string.IsNullOrWhiteSpace(key))
            {
                options.ApiSubscriptionKey = key.Trim();
            }
        });

        services.Configure<AiPromptOptions>(options =>
        {
            var section = configuration.GetSection(AiPromptOptions.SectionName);
            if (bool.TryParse(section["UseModularPrompt"], out var useModularPrompt))
            {
                options.UseModularPrompt = useModularPrompt;
            }
        });

        // DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — PII detector
        // options + adapter binding. The detector adapter is a Scoped
        // service so each request gets fresh threshold values; the
        // embedded dictionary is loaded once per process via a Lazy<>
        // inside the adapter. The port is consumed by
        // ParseVoiceInputHandler (synchronous wire — OQ-5).
        services.Configure<ShramSafal.Infrastructure.Privacy.PiiOptions>(
            configuration.GetSection(ShramSafal.Infrastructure.Privacy.PiiOptions.SectionName));
        services.AddScoped<
            ShramSafal.Application.Ports.Privacy.IThirdPartyPiiDetector,
            ShramSafal.Infrastructure.Privacy.HeuristicWorkerNameDetector>();

        services.Configure<TomorrowIoOptions>(options =>
        {
            var section = configuration.GetSection(TomorrowIoOptions.SectionName);
            if (!string.IsNullOrWhiteSpace(section["ApiKey"]))
            {
                options.ApiKey = section["ApiKey"]!.Trim();
            }
            if (!string.IsNullOrWhiteSpace(section["BaseUrl"]))
            {
                options.BaseUrl = section["BaseUrl"]!.Trim();
            }
            if (int.TryParse(section["TimeoutSeconds"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var timeoutSeconds))
            {
                options.TimeoutSeconds = timeoutSeconds;
            }
        });

        services.PostConfigure<TomorrowIoOptions>(options =>
        {
            var key = Environment.GetEnvironmentVariable("TOMORROW_IO_API_KEY");
            if (!string.IsNullOrWhiteSpace(key))
            {
                options.ApiKey = key.Trim();
            }
        });

        // spec: correctionevent-server-persistence
        services.AddScoped<ICorrectionEventRepository, CorrectionEventRepository>();
        services.AddScoped<IRecordCorrectionEventHandler, RecordCorrectionEventHandler>();

        services.AddScoped<IShramSafalRepository, ShramSafalRepository>();
        services.AddScoped<IUserDirectory, UserDirectoryService>();
        services.AddScoped<IMisReportRepository, MisReportRepository>();
        services.AddScoped<IAdminOpsRepository, AdminOpsRepository>();
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 3.1 + 3.2 — admin AI
        // observability read port. Reads the two Phase 3 Slice E
        // views (v_ai_provider_health_24h + v_ai_spend_monthly).
        // Scoped to share the request's ShramSafalDbContext.
        services.AddScoped<IAdminAiObservabilityRepository,
            ShramSafal.Infrastructure.Persistence.Repositories.AdminAiObservabilityRepository>();

        // W0-A admin spine — resolver + projector + redactor (wired for W0-B endpoint pivot).
        services.AddScoped<ShramSafal.Application.Admin.Ports.IEntitlementResolver,
            ShramSafal.Infrastructure.Admin.EntitlementResolver>();
        services.AddScoped<ShramSafal.Application.Admin.Ports.IOrgFarmScopeProjector,
            ShramSafal.Infrastructure.Admin.OrgFarmScopeProjector>();
        services.AddSingleton<ShramSafal.Application.Admin.Ports.IResponseRedactor,
            ShramSafal.Infrastructure.Admin.ResponseRedactor>();
        services.AddScoped<IFarmInvitationRepository, FarmInvitationRepository>();
        services.AddScoped<ISubscriptionReader, SubscriptionReader>();
        services.AddScoped<IEntitlementPolicy, DefaultEntitlementPolicy>();
        services.AddScoped<IDocumentExtractionSessionRepository, DocumentExtractionSessionRepository>();
        services.AddScoped<IReportExportService, PdfReportExportService>();
        services.AddScoped<IAuthorizationEnforcer, ShramSafalAuthorizationEnforcer>();
        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope established at the endpoint edge for the AI +
        // farm-read endpoints that self-authorize and never set the tenant claim.
        // Registered here (Infrastructure DI) — not Api DI — because the impl is
        // internal sealed to this assembly, exactly like ShramSafalAuthorizationEnforcer
        // above. The interface lives in ShramSafal.Application.Ports so Api adapters
        // can inject it.
        services.AddScoped<ICallerFarmTenantScope, CallerFarmTenantScope>();
        services.AddScoped<IAiJobRepository, AiJobRepository>();
        services.AddScoped<ISyncMutationStore, SyncMutationStore>();

        // CEI Phase 3 §4.5 — EF Core-backed test-stack repositories.
        services.AddScoped<ITestProtocolRepository, TestProtocolRepository>();
        services.AddScoped<ITestInstanceRepository, TestInstanceRepository>();
        services.AddScoped<ITestRecommendationRepository, TestRecommendationRepository>();

        // CEI Phase 3 §4.6 — compliance signal repository.
        services.AddScoped<IComplianceSignalRepository, ComplianceSignalRepository>();

        // DWC v2 §3.3 / ADR 2026-05-04 wtl-v0-entity-shape — Work Trust
        // Ledger v0. Repository is scoped (DbContext-bound); the regex
        // extractor is a stateless singleton.
        services.AddScoped<IWorkerRepository, WorkerRepository>();
        services.AddSingleton<IWorkerNameExtractor, RegexWorkerNameExtractor>();

        // DWC v2 §2.10 — Work Trust Ledger projector. Subscribes to
        // DailyLogCreatedEvent via the outbox dispatcher and passively
        // captures worker names from voice transcripts. The default
        // transcript store returns null (transcripts are not yet
        // persisted on the DailyLog aggregate); the projector treats
        // null as "no work" and no-ops, so registering the subscriber
        // is safe in production today and activates automatically once
        // a real IDailyLogTranscriptStore implementation lands.
        services.AddScoped<IDailyLogTranscriptStore, NullDailyLogTranscriptStore>();
        services.AddScoped<WorkerNameProjector>();
        services.AddScoped<IWorkerNameProjector>(sp => sp.GetRequiredService<WorkerNameProjector>());
        services.AddScoped<IDomainEventHandler<DailyLogCreatedEvent>>(
            sp => sp.GetRequiredService<WorkerNameProjector>());

        // DWC v2 §3.5 — Mode A drilldown + Mode B cohort patterns.
        // Both repos read AnalyticsDbContext via raw SQL (same pattern
        // as AdminMisRepository / AdminOpsRepository); scoped because
        // the underlying DbContext is.
        services.AddScoped<IAdminFarmerHealthRepository, AdminFarmerHealthRepository>();
        services.AddScoped<IAdminCohortPatternsRepository, AdminCohortPatternsRepository>();

        // DWC v2 §3.8 — admin audit emitter. Routes admin.farmer_lookup
        // events through the existing IAnalyticsWriter (registered by
        // AddAnalytics in the Bootstrapper); the dedicated
        // IAnalyticsEventRepository the plan sketches lands in Phase
        // C.4 and is a one-line constructor swap from there.
        // ICurrentUser + IHttpContextAccessor are required so the
        // emitter stamps actor_user_id on every admin.farmer_lookup
        // row (vocabulary contract — see EventVocabulary.Registry
        // entry for "admin.farmer_lookup").
        services.AddHttpContextAccessor();
        services.TryAddScoped<ICurrentUser, HttpContextCurrentUser>();
        services.AddScoped<ShramSafal.Application.Admin.IAdminAuditEmitter,
            ShramSafal.Infrastructure.Admin.AdminAuditEmitter>();

        services.AddSingleton<AiResponseNormalizer>();
        services.AddSingleton<AiPromptTemplateRegistry>();
        services.AddSingleton<AiCircuitBreakerRegistry>();
        services.AddSingleton<AiFailureClassifier>();
        services.AddSingleton<AiAttemptCostEstimator>();
        services.AddScoped<IAiPromptBuilder, AiPromptBuilder>();
        services.AddScoped<SarvamSttClient>();
        services.AddScoped<SarvamStreamingSttClient>();
        services.AddScoped<SarvamChatClient>();
        services.AddScoped<SarvamVisionClient>();
        services.AddScoped<SarvamDocIntelClient>();
        services.AddScoped<IAiProvider, SarvamAiProvider>();
        services.AddScoped<IAiProvider, GeminiAiProvider>();

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.1 — SarvamStreamingSttClient
        // implements the single-role ITranscriberProvider port (Task 1.9).
        // Registered IN ADDITION to the concrete-class scope above so direct
        // injection (e.g. the legacy AiStreamingEndpoints handler) keeps
        // working AND new orchestrator code resolves through the port.
        services.AddScoped<ITranscriberProvider>(sp => sp.GetRequiredService<SarvamStreamingSttClient>());

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.2 — verbatim REST adapter
        // used by the verbatim D-MOAT sampling worker (Task 2.11). NOT
        // registered as ITranscriberProvider — verbatim is async/background,
        // not part of the interactive transcribe/structure pipeline.
        services.AddScoped<SarvamVerbatimSttClient>();

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.3a — server-side audio
        // transcoder. Singleton because FfmpegAudioTranscoder is stateless
        // and FFMpegCore looks up the ffmpeg binary path once at first use
        // (GlobalFFOptions). Registered alongside the existing Sarvam
        // streaming pieces so the /api/ai/transcribe-stream endpoint
        // (Task 2.3) can pipe browser audio → PCM → Sarvam without the
        // transcriber adapter inspecting MIME types.
        services.AddSingleton<IAudioTranscoder, FfmpegAudioTranscoder>();

        services.AddScoped<IAiOrchestrator, AiOrchestrator>();
        services.AddHostedService<ExtractionVerificationWorker>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.10 — transcript
        // backfill worker. Disabled by default
        // (Ai:TranscriptBackfill:Enabled=false on every environment);
        // production opts in via env var Ai__TranscriptBackfill__Enabled
        // after Phase 1 ships and Phase 2 is stable. The hosted service
        // still spawns in dev/test but ExecuteAsync exits immediately
        // when Enabled is false — zero load.
        services.Configure<TranscriptBackfillOptions>(
            configuration.GetSection(TranscriptBackfillOptions.SectionName));
        services.AddHostedService<TranscriptBackfillWorker>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — rolling
        // 24h fail-rate probe. Disabled by default
        // (Ai:CircuitBreakerProbe:Enabled=false). Production opts in via
        // env var Ai__CircuitBreakerProbe__Enabled after Phase 2 ships
        // and the 24h window has had a chance to populate; until then
        // the probe would emit only "no observations yet" no-ops.
        var probeOptions = new AiProviderRollbackProbeOptions();
        configuration.GetSection(AiProviderRollbackProbeOptions.SectionName).Bind(probeOptions);
        services.AddSingleton(probeOptions);
        services.AddHostedService<AiProviderRollbackProbeWorker>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
        // cost budget guardrail. Disabled by default
        // (Ai:CostBudgetGuard:Enabled=false). Production opts in via
        // env var Ai__CostBudgetGuard__Enabled after Phase 2 ships and
        // the 20260522180000_AddMonthlyBudgetInrToProviderConfig
        // migration has been applied. Aggregator + budget probe both
        // sit behind the same enable flag.
        services.Configure<AiCostBudgetOptions>(
            configuration.GetSection(AiCostBudgetOptions.SectionName));
        services.AddHostedService<AiCostBudgetGuard>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11 — verbatim
        // D-MOAT sampling worker. Disabled by default
        // (Ai:VerbatimSampling:Enabled=false). Three independent gates
        // before any Sarvam call fires:
        //   1. Options.Enabled (env var Ai__VerbatimSampling__Enabled)
        //   2. ssf.feature_flags row 'verbatim_corpus_sampling_enabled'
        //      (Phase 1.4 / Safeguard S7) flipped via the admin surface.
        //   3. ssf.mode_policy row 'verbatim_sample' (Phase 1.5) — cost
        //      cap enforced against the daily ai_provider_spend_daily
        //      rollup (Slice C commit e8a1aac3).
        // Default 10% hash-bucket sampling rate (ADR-DS-014 §C);
        // per-user IConsentEnforcer check against
        // ConsentPurpose.VerbatimTrainingCorpus (Task 1.11) is additional
        // and non-bypassable.
        services.Configure<VerbatimSamplingOptions>(
            configuration.GetSection(VerbatimSamplingOptions.SectionName));
        services.AddHostedService<VerbatimSamplingWorker>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11a — selective
        // diarization worker. Disabled by default
        // (Ai:SelectiveDiarization:Enabled=false). Targets ai_jobs whose
        // linked daily_logs are in the Trust Ladder dispute states
        // (Disputed / CorrectionPending). Gates:
        //   1. Options.Enabled (env var Ai__SelectiveDiarization__Enabled)
        //   2. ssf.diarization_policy row 'dispute_flagged' (Phase 1.5a)
        //      with enabled=true.
        //   3. max_daily_cost_inr cap on the same policy row, checked
        //      against ai_provider_spend_daily for today.
        // Adds an AiJobAttempt with a 1.20× cost multiplier so the
        // AiCostBudgetGuard rollup picks up the diarization spend on
        // its next tick.
        services.Configure<SelectiveDiarizationOptions>(
            configuration.GetSection(SelectiveDiarizationOptions.SectionName));
        services.AddHostedService<SelectiveDiarizationWorker>();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng
        // brief Theme B-2, Safeguard B2) — golden-set feedback capture
        // worker. Disabled by default
        // (Ai:GoldenSetFeedback:Enabled=false on every environment).
        // Projects each non-PII CorrectionEvent into a
        // GoldenSetCandidate row that the future weekly batch
        // promote-job (parking lot — golden-set repo authoring infra
        // deferred) will admit into the active golden set. The
        // hosted service still spawns in dev/test but
        // ExecuteAsync exits immediately when Enabled is false —
        // zero load.
        services.Configure<GoldenSetFeedbackOptions>(
            configuration.GetSection(GoldenSetFeedbackOptions.SectionName));
        services.AddHostedService<GoldenSetFeedbackWorker>();

        services.AddHttpClient("GeminiAiProvider")
            .ConfigureHttpClient((sp, client) =>
            {
                var geminiOptions = sp.GetRequiredService<IOptions<GeminiOptions>>().Value;
                var timeout = geminiOptions.TimeoutSeconds <= 0 ? 30 : geminiOptions.TimeoutSeconds;
                client.Timeout = TimeSpan.FromSeconds(timeout);
            });

        services.AddHttpClient("SarvamAiProvider")
            .ConfigureHttpClient((sp, client) =>
            {
                var sarvamOptions = sp.GetRequiredService<IOptions<SarvamOptions>>().Value;
                var timeout = sarvamOptions.TimeoutSeconds <= 0 ? 45 : sarvamOptions.TimeoutSeconds;
                client.Timeout = TimeSpan.FromSeconds(timeout);
            });

        services.AddHttpClient("SarvamDocIntel")
            .ConfigureHttpClient((sp, client) =>
            {
                var sarvamOptions = sp.GetRequiredService<IOptions<SarvamOptions>>().Value;
                var timeout = sarvamOptions.DocIntelTimeoutSeconds <= 0 ? 120 : sarvamOptions.DocIntelTimeoutSeconds;
                // Add a buffer beyond the job timeout so the HttpClient doesn't cut the connection
                client.Timeout = TimeSpan.FromSeconds(timeout + 30);
            });

        services.AddHttpClient("TomorrowIoWeather")
            .ConfigureHttpClient((sp, client) =>
            {
                var weatherOptions = sp.GetRequiredService<IOptions<TomorrowIoOptions>>().Value;
                var timeout = weatherOptions.TimeoutSeconds <= 0 ? 15 : weatherOptions.TimeoutSeconds;
                client.Timeout = TimeSpan.FromSeconds(timeout);
            });

        services.AddScoped<IWeatherProvider, TomorrowIoWeatherProvider>();

        services.Configure<StorageOptions>(configuration.GetSection("ShramSafal:Storage"));
        var storageProvider = configuration.GetSection("ShramSafal:Storage:Provider").Value ?? "Local";
        if (storageProvider.Equals("S3", StringComparison.OrdinalIgnoreCase))
        {
            // spine-02.1 Delta 1: IAmazonS3 registration hoisted to Program.cs as an
            // unconditional top-level registration so S3AttachmentStorageService (here)
            // and S3RawBlobStore (cold tier) share one client instance.
            services.AddSingleton<IAttachmentStorageService, S3AttachmentStorageService>();
        }
        else
        {
            services.AddSingleton<IAttachmentStorageService, LocalFileStorageService>();
        }

        // W1.P0 Batch A (ai-intelligence-plan-2026-06-25 Task 8) —
        // Domain-knowledge pipeline adapter.  Registered as Singleton because
        // DomainKnowledgePipelineAdapter is stateless (it simply delegates to
        // the static DomainKnowledgePipeline.RunDomainKnowledgePipeline).
        // The port (IDomainKnowledgePipelinePort) is defined in the Application
        // layer; the concrete adapter (DomainKnowledgePipelineAdapter) is
        // internal to this Infrastructure assembly.  This keeps the Application
        // project free of a project reference to Infrastructure, satisfying the
        // Application_Does_Not_Depend_On_Its_Own_Infrastructure architecture test.
        services.AddSingleton<
            ShramSafal.Application.Ports.IDomainKnowledgePipelinePort,
            ShramSafal.Infrastructure.AI.DomainKnowledge.DomainKnowledgePipelineAdapter>();

        return services;
    }
}
