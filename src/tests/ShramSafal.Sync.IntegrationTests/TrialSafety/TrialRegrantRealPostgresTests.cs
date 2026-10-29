// spec: pre-launch repair R-11 (a) — "Remove both accidental trial resets"
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Migrations;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec R-11 (a) (founder N-1, 26 Oct: "Remove both accidental trial resets: server restart and
/// repeated farm creation") — on real Postgres as the app role:
/// <list type="bullet">
/// <item>the startup backfill (what every server restart runs) starts a trial ONLY for an owner
/// account that never had a subscription — an expired, past-due, cancelled or suspended account is
/// left exactly as it is, run after run;</item>
/// <item><c>POST /bootstrap/first-farm</c> never starts a second trial on an account that already had
/// one — it hands back the same farm and the account's real (expired) subscription.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TrialRegrantRealPostgresTests(TrialSafetyDatabase db) : IClassFixture<TrialSafetyDatabase>
{
    [Fact]
    public async Task A_restart_never_restarts_an_ended_trial_and_starts_a_first_one_only_for_a_never_subscribed_account()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var expired = Guid.NewGuid();
        var pastDue = Guid.NewGuid();
        var canceled = Guid.NewGuid();
        var neverSubscribed = Guid.NewGuid();
        foreach (var account in new[] { expired, pastDue, canceled, neverSubscribed })
        {
            await db.SeedAccountAsync(account, Guid.NewGuid());
        }

        await db.SeedSubscriptionAsync(expired, 4, DateTime.UtcNow.AddDays(-2));
        await db.SeedSubscriptionAsync(pastDue, 3, DateTime.UtcNow.AddDays(-1));
        await db.SeedSubscriptionAsync(canceled, 5, DateTime.UtcNow.AddDays(-9));

        // Three "restarts": the hosted service exactly as Program.cs registers it.
        await using var app = await db.BuildHostAsync();
        for (var restart = 0; restart < 3; restart++)
        {
            var backfill = new BackfillFarmOwnerAccounts(app.Services, NullLogger<BackfillFarmOwnerAccounts>.Instance);
            await backfill.StartAsync(CancellationToken.None);
        }

        foreach (var account in new[] { expired, pastDue, canceled })
        {
            (await SubscriptionCountAsync(account)).Should().Be(1, $"account {account} keeps only the row it had");
            (await LiveRowCountAsync(account)).Should().Be(0, $"account {account} gets no new Trialing/Active row from a restart");
        }

        // CONTROL — proves the backfill actually ran to its trial step (it swallows its own errors).
        (await SubscriptionCountAsync(neverSubscribed)).Should().Be(1, "a never-subscribed account gets its FIRST trial, once");
        (await LiveRowCountAsync(neverSubscribed)).Should().Be(1);
        (await db.CountAsync("""
            SELECT count(*) FROM accounts.subscriptions
            WHERE owner_account_id = @a AND status = 1
              AND valid_until_utc BETWEEN NOW() + INTERVAL '13 days' AND NOW() + INTERVAL '15 days'
            """, ("a", neverSubscribed))).Should().Be(1, "the trial length is unchanged: 14 days");
    }

    [Fact]
    public async Task The_backfill_trial_step_alone_never_regrants_and_is_idempotent()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var expired = Guid.NewGuid();
        var neverSubscribed = Guid.NewGuid();
        await db.SeedAccountAsync(expired, Guid.NewGuid());
        await db.SeedAccountAsync(neverSubscribed, Guid.NewGuid());
        await db.SeedSubscriptionAsync(expired, 4, DateTime.UtcNow.AddDays(-30));

        var options = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(db.AppConn).Options;
        for (var run = 0; run < 2; run++)
        {
            await using var accounts = new AccountsDbContext(options);
            await BackfillFarmOwnerAccounts.StartTrialsForNewOwnerAccountsAsync(
                accounts, DateTime.UtcNow, NullLogger.Instance, CancellationToken.None);
        }

        (await SubscriptionCountAsync(expired)).Should().Be(1);
        (await LiveRowCountAsync(expired)).Should().Be(0);
        (await SubscriptionCountAsync(neverSubscribed)).Should().Be(1, "the second run adds nothing");
    }

    [Fact]
    public async Task The_first_farm_wizard_never_starts_a_second_trial_and_returns_the_same_farm()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var owner = Guid.NewGuid();
        var account = Guid.NewGuid();
        var farm = Guid.NewGuid();
        await db.SeedAccountAsync(account, owner, bootstrappedFarm: farm);
        await db.SeedFarmAsync(farm, owner, account, code: RandomCode());
        await db.SeedSubscriptionAsync(account, 4, DateTime.UtcNow.AddDays(-3));

        await using var app = await db.BuildHostAsync();
        using var client = app.GetTestClient();

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            using var response = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/bootstrap/first-farm", owner,
                new { farmName = "पुन्हा शेत", farmerName = "मालक" });
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, body);
            var json = await TrialSafetyDatabase.JsonAsync(response);
            json.GetProperty("farmId").GetGuid().Should().Be(farm, "the wizard hands back the same farm");
            json.GetProperty("wasAlreadyBootstrapped").GetBoolean().Should().BeTrue();
            json.GetProperty("subscription").GetProperty("status").GetString().Should().Be("Expired",
                $"attempt {attempt}: the account's real subscription, not a fresh trial");
            json.GetProperty("subscription").GetProperty("allowsOwnerWrites").GetBoolean().Should().BeFalse();
        }

        (await SubscriptionCountAsync(account)).Should().Be(1, "no second trial row");
        (await LiveRowCountAsync(account)).Should().Be(0);
    }

    [Fact]
    public async Task CONTROL_a_brand_new_owner_still_gets_the_first_14_day_trial_once()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var owner = Guid.NewGuid();
        await using var app = await db.BuildHostAsync();
        using var client = app.GetTestClient();

        Guid farmId = Guid.Empty;
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            using var response = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/bootstrap/first-farm", owner,
                new { farmName = "नवीन शेत" });
            response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            var json = await TrialSafetyDatabase.JsonAsync(response);
            json.GetProperty("subscription").GetProperty("status").GetString().Should().Be("Trialing");
            farmId = json.GetProperty("farmId").GetGuid();
        }

        var account = (Guid)(await ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness.ScalarAsync(db.SuperuserConn,
            "SELECT owner_account_id FROM accounts.owner_accounts WHERE primary_owner_user_id = @o", ("o", owner)))!;
        (await SubscriptionCountAsync(account)).Should().Be(1, "the first trial is started once, not per attempt");
        farmId.Should().NotBe(Guid.Empty);
    }

    // ── helpers ──

    private Task<long> SubscriptionCountAsync(Guid account) =>
        db.CountAsync("SELECT count(*) FROM accounts.subscriptions WHERE owner_account_id = @a", ("a", account));

    private Task<long> LiveRowCountAsync(Guid account) =>
        db.CountAsync("SELECT count(*) FROM accounts.subscriptions WHERE owner_account_id = @a AND status IN (1, 2)", ("a", account));

    private static string RandomCode() => ShramSafal.Domain.Farms.FarmCode.New();
}
