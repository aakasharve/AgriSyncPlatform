using Accounts.Application.EventHandlers;
using Accounts.Application.UseCases.Affiliation.GenerateReferralCode;
using Accounts.Application.UseCases.Affiliation.RecordReferral;
using Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;
using Accounts.Domain.Events;
using AgriSync.BuildingBlocks.Persistence.Outbox;
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

        // T-IGH-03-OUTBOX-PUBLISHER-IMPL — first production
        // IDomainEventHandler<T> subscriber. Single class implements all
        // four Subscription* lifecycle interfaces; one Scoped registration
        // per interface so DiDomainEventHandlerRegistry resolves the
        // shared instance for each event type.
        services.AddScoped<SubscriptionLifecycleAuditSubscriber>();
        services.AddScoped<IDomainEventHandler<SubscriptionActivated>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionPastDue>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionExpired>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionCanceled>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());

        return services;
    }
}
