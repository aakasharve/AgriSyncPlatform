using System.Globalization;
using Amazon;
using Amazon.S3;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
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

        services.AddDbContext<ShramSafalDbContext>((sp, options) =>
            options.UseNpgsql(
                connectionString,
                npgsql =>
                {
                    npgsql.MigrationsHistoryTable("__ef_migrations", "ssf");
                    // PushSyncBatchHandler routes its transactional block
                    // through dbContext.Database.CreateExecutionStrategy()
                    // so user-initiated BeginTransactionAsync stays
                    // compatible with the retrying strategy.
                    npgsql.EnableRetryOnFailure(
                        maxRetryCount: 5,
                        maxRetryDelay: TimeSpan.FromSeconds(10),
                        errorCodesToAdd: null);
                })
                .AddInterceptors(
                    sp.GetRequiredService<DomainEventToOutboxInterceptor>(),
                    sp.GetRequiredService<OutboxTransactionInterceptor>()));
        services.AddScoped<DbContext>(provider => provider.GetRequiredService<ShramSafalDbContext>());

        services.Configure<GeminiOptions>(options =>
        {
            var section = configuration.GetSection(GeminiOptions.SectionName);

            if (!string.IsNullOrWhiteSpace(section["ApiKey"]))
            {
                options.ApiKey = section["ApiKey"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["ModelId"]))
            {
                options.ModelId = section["ModelId"]!.Trim();
            }
            else if (!string.IsNullOrWhiteSpace(section["Model"]))
            {
                options.ModelId = section["Model"]!.Trim();
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

        services.AddScoped<IShramSafalRepository, ShramSafalRepository>();
        services.AddScoped<IUserDirectory, UserDirectoryService>();
        services.AddScoped<IMisReportRepository, MisReportRepository>();
        services.AddScoped<IAdminOpsRepository, AdminOpsRepository>();

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
        services.AddScoped<ShramSafal.Application.Admin.IAdminAuditEmitter,
            ShramSafal.Infrastructure.Admin.AdminAuditEmitter>();

        services.AddSingleton<AiResponseNormalizer>();
        services.AddSingleton<AiPromptTemplateRegistry>();
        services.AddSingleton<AiCircuitBreakerRegistry>();
        services.AddSingleton<AiFailureClassifier>();
        services.AddSingleton<AiAttemptCostEstimator>();
        services.AddScoped<IAiPromptBuilder, AiPromptBuilder>();
        services.AddScoped<SarvamSttClient>();
        services.AddScoped<SarvamChatClient>();
        services.AddScoped<SarvamVisionClient>();
        services.AddScoped<SarvamDocIntelClient>();
        services.AddScoped<IAiProvider, SarvamAiProvider>();
        services.AddScoped<IAiProvider, GeminiAiProvider>();
        services.AddScoped<IAiOrchestrator, AiOrchestrator>();
        services.AddHostedService<ExtractionVerificationWorker>();

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
            services.AddSingleton<IAmazonS3>(sp =>
            {
                var storageOptions = sp.GetRequiredService<IOptions<StorageOptions>>().Value;
                var regionName = string.IsNullOrWhiteSpace(storageOptions.Region) ? "ap-south-1" : storageOptions.Region.Trim();
                return new AmazonS3Client(new AmazonS3Config
                {
                    RegionEndpoint = RegionEndpoint.GetBySystemName(regionName)
                });
            });
            services.AddSingleton<IAttachmentStorageService, S3AttachmentStorageService>();
        }
        else
        {
            services.AddSingleton<IAttachmentStorageService, LocalFileStorageService>();
        }
        return services;
    }
}
