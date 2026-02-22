using System.Globalization;
using AgriSync.BuildingBlocks.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;

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

        services.Configure<GeminiOptions>(options =>
        {
            var section = configuration.GetSection(GeminiOptions.SectionName);

            if (!string.IsNullOrWhiteSpace(section["ApiKey"]))
            {
                options.ApiKey = section["ApiKey"]!.Trim();
            }

            if (!string.IsNullOrWhiteSpace(section["Model"]))
            {
                options.Model = section["Model"]!.Trim();
            }

            if (decimal.TryParse(section["Temperature"], NumberStyles.Float, CultureInfo.InvariantCulture, out var temperature))
            {
                options.Temperature = temperature;
            }

            if (int.TryParse(section["MaxTokens"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var maxTokens))
            {
                options.MaxTokens = maxTokens;
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

        services.AddScoped<IShramSafalRepository, ShramSafalRepository>();
        services.AddScoped<ISyncMutationStore, SyncMutationStore>();
        services.AddScoped<IAiParsingService, GeminiParsingService>();
        services.AddScoped<IAuthorizationEnforcer, ShramSafalAuthorizationEnforcer>();
        return services;
    }
}
