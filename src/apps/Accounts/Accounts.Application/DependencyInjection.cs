using Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;
using Microsoft.Extensions.DependencyInjection;

namespace Accounts.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddAccountsApplication(this IServiceCollection services)
    {
        services.AddScoped<ApplyProviderEventHandler>();
        return services;
    }
}
