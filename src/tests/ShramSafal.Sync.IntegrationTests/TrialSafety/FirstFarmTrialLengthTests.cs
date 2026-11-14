// spec: plr-d10 lane R5-SMALL, TRIAL-21 (founder B2 = 21 days) - the length of the FIRST trial a new farm's owner gets from POST /bootstrap/first-farm.
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Endpoints;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// The first-farm bootstrap starts ONE trial, and it is 21 days long (founder B2). Runs the very method the route calls
/// (<see cref="FirstFarmBootstrapEndpoints.StartFirstTrialOrGetCurrentAsync"/>) over an in-memory accounts store: no Postgres needed, so
/// the length is pinned in the ordinary run; the real-Postgres route test (<c>TrialRegrantRealPostgresTests</c>) pins it end to end.
/// A farm created before this change keeps the date it was stored with: nothing here rewrites a stored subscription.
/// </summary>
public sealed class FirstFarmTrialLengthTests
{
    private static AccountsDbContext NewStore(string name) =>
        new(new DbContextOptionsBuilder<AccountsDbContext>().UseInMemoryDatabase(name).Options);

    [Fact]
    public async Task A_new_farms_first_trial_ends_21_days_after_it_starts()
    {
        await using var accounts = NewStore($"trial21-{Guid.NewGuid()}");
        var now = new DateTime(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

        var trial = await FirstFarmBootstrapEndpoints.StartFirstTrialOrGetCurrentAsync(accounts, OwnerAccountId.New(), now, CancellationToken.None);

        trial.Status.Should().Be(SubscriptionStatus.Trialing);
        trial.ValidFromUtc.Should().Be(now);
        trial.TrialEndsAtUtc.Should().Be(now.AddDays(21), "the trial is 21 days (founder B2)");
        trial.ValidUntilUtc.Should().Be(now.AddDays(21));
        (trial.TrialEndsAtUtc!.Value - trial.ValidFromUtc).TotalDays.Should().Be(21);
    }

    [Fact]
    public async Task A_farm_that_already_has_a_trial_keeps_the_date_it_was_stored_with_and_gets_no_second_one()
    {
        await using var accounts = NewStore($"trial21-keep-{Guid.NewGuid()}");
        var account = OwnerAccountId.New();
        var started = new DateTime(2026, 11, 1, 6, 0, 0, DateTimeKind.Utc);
        var old = Subscription.StartTrial(SubscriptionId.New(), account, PlanCode.ShramSafalPro, started, started.AddDays(14)); // a farm created before B2
        accounts.Subscriptions.Add(old);
        await accounts.SaveChangesAsync();

        var again = await FirstFarmBootstrapEndpoints.StartFirstTrialOrGetCurrentAsync(
            accounts, account, started.AddDays(3), CancellationToken.None);

        again.Id.Should().Be(old.Id, "the account's own subscription comes back");
        again.TrialEndsAtUtc.Should().Be(started.AddDays(14), "a stored date is never rewritten to 21 days");
        (await accounts.Subscriptions.CountAsync(s => s.OwnerAccountId == account)).Should().Be(1);
    }
}
