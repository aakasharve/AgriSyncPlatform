using Accounts.Domain.Events;
using Accounts.Domain.Subscriptions;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.Subscriptions;

/// <summary>
/// Lifecycle + invariant coverage for the <see cref="Subscription"/>
/// aggregate. Maps to plan spec §3.4 invariants I6/I7 and §8.5.3.
/// </summary>
public sealed class SubscriptionLifecycleTests
{
    private static readonly SubscriptionId SubId = new(Guid.Parse("abcdef00-0000-0000-0000-000000000001"));
    private static readonly OwnerAccountId AccountId = new(Guid.Parse("0a000000-0000-0000-0000-000000000001"));
    private static readonly DateTime Now = new(2026, 4, 18, 10, 0, 0, DateTimeKind.Utc);

    [Fact(DisplayName = "StartTrial produces Trialing status and a SubscriptionActivated event")]
    public void StartTrial_produces_trialing_status()
    {
        var trial = Subscription.StartTrial(SubId, AccountId, PlanCode.ShramSafalPro, Now, Now.AddDays(14));

        Assert.Equal(SubscriptionStatus.Trialing, trial.Status);
        Assert.True(trial.IsCurrentlyValid);
        Assert.True(trial.AllowsOwnerWrites);
        Assert.False(trial.AllowsOwnerReadsOnly);

        var evt = Assert.IsType<SubscriptionActivated>(trial.DomainEvents.Single());
        Assert.True(evt.IsTrial);
    }

    [Fact(DisplayName = "Activate on Trialing moves to Active and raises event")]
    public void Activate_on_trialing_moves_to_active()
    {
        var sub = Subscription.StartTrial(SubId, AccountId, PlanCode.ShramSafalPro, Now, Now.AddDays(14));
        sub.ClearDomainEvents();

        sub.Activate(Now.AddDays(14), Now.AddDays(14).AddMonths(1), billingProviderCustomerId: "cust_1", utcNow: Now.AddDays(14));

        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.True(sub.AllowsOwnerWrites);

        var evt = Assert.IsType<SubscriptionActivated>(sub.DomainEvents.Single());
        Assert.False(evt.IsTrial);
    }

    [Fact(DisplayName = "MarkPastDue flips to PastDue and exposes read-only mode")]
    public void MarkPastDue_flips_to_past_due()
    {
        var sub = Subscription.StartTrial(SubId, AccountId, PlanCode.ShramSafalPro, Now, Now.AddDays(14));
        sub.Activate(Now.AddDays(14), Now.AddDays(14).AddMonths(1), null, Now.AddDays(14));
        sub.ClearDomainEvents();

        sub.MarkPastDue(gracePeriodEndsAtUtc: Now.AddDays(14).AddDays(7), utcNow: Now.AddDays(44));

        Assert.Equal(SubscriptionStatus.PastDue, sub.Status);
        Assert.False(sub.AllowsOwnerWrites);
        Assert.True(sub.AllowsOwnerReadsOnly);
        Assert.IsType<SubscriptionPastDue>(sub.DomainEvents.Single());
    }

    [Fact(DisplayName = "Expire is terminal and cannot be re-activated")]
    public void Expire_is_terminal_and_blocks_reactivation()
    {
        var sub = Subscription.StartTrial(SubId, AccountId, PlanCode.ShramSafalPro, Now, Now.AddDays(14));
        sub.Expire(Now.AddDays(15));

        Assert.Equal(SubscriptionStatus.Expired, sub.Status);

        Assert.Throws<InvalidOperationException>(
            () => sub.Activate(Now.AddDays(16), Now.AddDays(30), null, Now.AddDays(16)));
    }

    [Fact(DisplayName = "Cancel is idempotent")]
    public void Cancel_is_idempotent()
    {
        var sub = Subscription.StartTrial(SubId, AccountId, PlanCode.ShramSafalPro, Now, Now.AddDays(14));
        sub.Cancel(Now.AddDays(2));
        sub.ClearDomainEvents();

        sub.Cancel(Now.AddDays(3));

        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.Empty(sub.DomainEvents); // no duplicate event
    }

    [Fact(DisplayName = "Invariant I7: Status has no public setter")]
    public void Status_property_has_no_public_setter()
    {
        var property = typeof(Subscription).GetProperty(nameof(Subscription.Status));
        Assert.NotNull(property);
        Assert.Null(property!.SetMethod?.IsPublic == true ? property.SetMethod : null);
    }
}
