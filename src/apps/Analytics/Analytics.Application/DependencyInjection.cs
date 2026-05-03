using Analytics.Application.UseCases.IngestEvents;
using Microsoft.Extensions.DependencyInjection;

namespace Analytics.Application;

/// <summary>
/// Registers the handlers and validators that make up the Analytics
/// application layer. Mirrors the pattern used by Accounts.Application
/// (handlers as Scoped, validators as Singleton when stateless).
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddAnalyticsApplication(this IServiceCollection services)
    {
        services.AddSingleton<IngestEventsValidator>();
        services.AddScoped<IngestEventsHandler>();
        return services;
    }
}
