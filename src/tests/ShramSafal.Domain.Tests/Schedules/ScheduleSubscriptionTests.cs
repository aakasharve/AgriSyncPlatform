using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleSubscriptionTests
{
    private static ScheduleSubscription NewActive() =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "grape",
            ScheduleTemplateId.New(),
            "v1.0",
            DateTime.UtcNow);

    [Fact]
    public void Adopt_StartsInActiveState()
    {
        var subscription = NewActive();
        Assert.Equal(ScheduleSubscriptionState.Active, subscription.State);
    }

    [Fact]
    public void Migrate_FromActive_TransitionsToMigrated()
    {
        var subscription = NewActive();
        var newId = ScheduleSubscriptionId.New();

        subscription.Migrate(newId, ScheduleMigrationReason.BetterFit, DateTime.UtcNow);

        Assert.Equal(ScheduleSubscriptionState.Migrated, subscription.State);
        Assert.Equal(ScheduleMigrationReason.BetterFit, subscription.MigrationReason);
        Assert.Equal(newId, subscription.MigratedToSubscriptionId);
        Assert.NotNull(subscription.StateChangedAtUtc);
    }

    [Fact]
    public void Migrate_FromMigrated_Throws()
    {
        var subscription = NewActive();
        subscription.Migrate(ScheduleSubscriptionId.New(), ScheduleMigrationReason.BetterFit, DateTime.UtcNow);

        Assert.Throws<InvalidOperationException>(() =>
            subscription.Migrate(ScheduleSubscriptionId.New(), ScheduleMigrationReason.Other, DateTime.UtcNow));
    }

    [Fact]
    public void Migrate_ToSelf_Throws()
    {
        var subscription = NewActive();

        Assert.Throws<InvalidOperationException>(() =>
            subscription.Migrate(subscription.SubscriptionId, ScheduleMigrationReason.Other, DateTime.UtcNow));
    }

    [Fact]
    public void Abandon_FromActive_TransitionsToAbandoned()
    {
        var subscription = NewActive();

        subscription.Abandon(DateTime.UtcNow);

        Assert.Equal(ScheduleSubscriptionState.Abandoned, subscription.State);
        Assert.NotNull(subscription.StateChangedAtUtc);
    }

    [Fact]
    public void Abandon_FromCompleted_Throws()
    {
        var subscription = NewActive();
        subscription.Complete(DateTime.UtcNow);

        Assert.Throws<InvalidOperationException>(() => subscription.Abandon(DateTime.UtcNow));
    }

    [Fact]
    public void Complete_FromActive_TransitionsToCompleted()
    {
        var subscription = NewActive();

        subscription.Complete(DateTime.UtcNow);

        Assert.Equal(ScheduleSubscriptionState.Completed, subscription.State);
    }

    [Fact]
    public void AttachMigratedFrom_OnceOnly()
    {
        var subscription = NewActive();
        subscription.AttachMigratedFrom(ScheduleSubscriptionId.New());

        Assert.Throws<InvalidOperationException>(() =>
            subscription.AttachMigratedFrom(ScheduleSubscriptionId.New()));
    }
}
