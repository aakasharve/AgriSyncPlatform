using Accounts.Application.EventHandlers;
using Accounts.Application.UseCases.Affiliation.GenerateReferralCode;
using Accounts.Application.UseCases.Affiliation.RecordReferral;
using Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;
using Microsoft.Extensions.DependencyInjection;

namespace Accounts.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddAccountsApplication(this IServiceCollection services)
    {
        services.AddScoped<ApplyProviderEventHandler>();
        services.AddScoped<GenerateReferralCodeHandler>();
        services.AddScoped<RecordReferralHandler>();
        services.AddScoped<ReferralQualificationHandler>();
        return services;
    }
}
