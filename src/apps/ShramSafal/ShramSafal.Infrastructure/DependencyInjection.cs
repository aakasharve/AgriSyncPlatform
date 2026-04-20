using System.Globalization;
using Amazon;
using Amazon.S3;
using AgriSync.BuildingBlocks.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Infrastructure.Storage;
using ShramSafal.Infrastructure.Reports;

namespace ShramSafal.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddShramSafalInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString =
            configuration.GetConnectionString("ShramSafalDb") ??
            configuration.GetConnectionString("UserDb") ??
            throw new InvalidOperationException("Connection string 'ShramSafalDb' or 'UserDb' is required.");

        services.AddDbContext<ShramSafalDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf")));
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

        services.AddScoped<IShramSafalRepository, ShramSafalRepository>();
        services.AddScoped<IUserDirectory, UserDirectoryService>();
        services.AddScoped<IMisReportRepository, MisReportRepository>();
        services.AddScoped<IAdminOpsRepository, AdminOpsRepository>();
        services.AddScoped<IFarmInvitationRepository, FarmInvitationRepository>();
        services.AddScoped<ISubscriptionReader, SubscriptionReader>();
        services.AddScoped<IEntitlementPolicy, DefaultEntitlementPolicy>();
        services.AddScoped<IDocumentExtractionSessionRepository, DocumentExtractionSessionRepository>();
        services.AddScoped<IReportExportService, PdfReportExportService>();
        services.AddScoped<IAuthorizationEnforcer, ShramSafalAuthorizationEnforcer>();
        services.AddScoped<IAiJobRepository, AiJobRepository>();
        services.AddScoped<ISyncMutationStore, SyncMutationStore>();
        services.AddSingleton<AiResponseNormalizer>();
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
