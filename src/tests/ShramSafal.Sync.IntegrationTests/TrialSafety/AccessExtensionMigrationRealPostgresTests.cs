// spec: pre-launch repair R-11 (b) — the migration that keeps every existing pilot farm working
using System;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using Accounts.Infrastructure.Persistence.Migrations;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShramSafal.Sync.IntegrationTests.Labour;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec R-11 (b) (founder N-1: "Until the continuation path is operational, do not enforce a hard
/// stop on real pilot farms") — <c>20261027040015_AddAccessExtensions</c> on real Postgres:
/// the accounts that exist when it runs and whose trial has expired or will expire before the
/// (PROPOSED) end date get ONE <c>pilot-extension-2026-10</c> extension; a paid, cancelled, suspended
/// or long-trial account gets none; no subscription row is touched; Down removes the table and Up
/// can run again.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AccessExtensionMigrationRealPostgresTests : IAsyncLifetime
{
    private const string PreviousAccountsMigration = "20260605081204_AddOwnerAccountBootstrappedFarmId";
    private static readonly DateTime PilotEndUtc = new(2026, 12, 31, 18, 30, 0, DateTimeKind.Utc);

    private static readonly Guid Expired = Guid.Parse("a1100000-0000-0000-0000-000000000001");
    private static readonly Guid TrialEndingSoon = Guid.Parse("a1100000-0000-0000-0000-000000000002");
    private static readonly Guid NoSubscription = Guid.Parse("a1100000-0000-0000-0000-000000000003");
    private static readonly Guid PastDue = Guid.Parse("a1100000-0000-0000-0000-000000000004");
    private static readonly Guid PaidActive = Guid.Parse("a1100000-0000-0000-0000-000000000005");
    private static readonly Guid Canceled = Guid.Parse("a1100000-0000-0000-0000-000000000006");
    private static readonly Guid Suspended = Guid.Parse("a1100000-0000-0000-0000-000000000007");
    private static readonly Guid LongTrial = Guid.Parse("a1100000-0000-0000-0000-000000000008");
    private static readonly Guid ExpiredThenTrialing = Guid.Parse("a1100000-0000-0000-0000-000000000009");

    private string _maintenance = string.Empty;
    private string _name = string.Empty;
    private string _su = string.Empty;

    public async Task InitializeAsync()
    {
        _maintenance = await PurveshDemoReseedHarness.MaintenanceConnectionAsync();
        _name = PurveshDemoReseedHarness.NewDatabaseName("extmig");
        await PurveshDemoReseedHarness.CreateDatabaseAsync(_maintenance, _name);
        _su = PurveshDemoReseedHarness.SuperuserConnFor(_maintenance, _name);
        // The app role must exist for the migration's grant block to have something to grant to
        // (on a fresh cluster the ssf chain creates it; this test runs the accounts chain alone).
        await PurveshDemoReseedHarness.ExecAsync(_su, """
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                CREATE ROLE agrisync_app LOGIN PASSWORD 'dev_app_change_me' NOSUPERUSER NOBYPASSRLS;
              END IF;
            END $$;
            """);
    }

    public async Task DisposeAsync()
    {
        Npgsql.NpgsqlConnection.ClearAllPools();
        await PurveshDemoReseedHarness.DropDatabaseAsync(_maintenance, _name);
    }

    [Fact]
    public async Task Existing_trial_accounts_get_one_pilot_extension_and_nothing_else_changes()
    {
        await MigrateAccountsAsync(PreviousAccountsMigration);
        var now = DateTime.UtcNow;
        foreach (var account in new[] { Expired, TrialEndingSoon, NoSubscription, PastDue, PaidActive, Canceled, Suspended, LongTrial, ExpiredThenTrialing })
        {
            await SeedAccountAsync(account);
        }

        await SeedSubscriptionAsync(Expired, 4, now.AddDays(-3));
        await SeedSubscriptionAsync(TrialEndingSoon, 1, now.AddDays(5));
        await SeedSubscriptionAsync(PastDue, 3, now.AddDays(-1));
        await SeedSubscriptionAsync(PaidActive, 2, now.AddDays(10));
        await SeedSubscriptionAsync(Canceled, 5, now.AddDays(-30));
        await SeedSubscriptionAsync(Suspended, 6, now.AddDays(-30));
        await SeedSubscriptionAsync(LongTrial, 1, new DateTime(2099, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        // An old expired row and a current trial that ends before the pilot end: the CURRENT row decides.
        await SeedSubscriptionAsync(ExpiredThenTrialing, 4, now.AddDays(-40));
        await SeedSubscriptionAsync(ExpiredThenTrialing, 1, now.AddDays(3));
        var subscriptionsBefore = await SubscriptionFingerprintAsync();

        await MigrateAccountsAsync(null);

        var expectGrant = now < PilotEndUtc;
        foreach (var account in new[] { Expired, TrialEndingSoon, NoSubscription, PastDue, ExpiredThenTrialing })
        {
            (await ExtensionCountAsync(account)).Should().Be(expectGrant ? 1 : 0, $"account {account} had an expiring trial");
        }

        foreach (var account in new[] { PaidActive, Canceled, Suspended, LongTrial })
        {
            (await ExtensionCountAsync(account)).Should().Be(0, $"account {account} is paid, deliberately stopped, or not expiring");
        }

        if (expectGrant)
        {
            var row = await PurveshDemoReseedHarness.RowsAsync(_su,
                "SELECT reason, ends_at_utc, granted_by_user_id, starts_at_utc <= NOW() FROM accounts.access_extensions WHERE owner_account_id = @a",
                ("a", Expired));
            row.Should().ContainSingle();
            row[0][0].Should().Be(AddAccessExtensions.PilotExtensionReason);
            ((DateTime)row[0][1]!).ToUniversalTime().Should().Be(PilotEndUtc);
            row[0][2].Should().Be(Guid.Parse(AddAccessExtensions.SystemActorUserId));
            row[0][3].Should().Be(true);
        }

        (await SubscriptionFingerprintAsync()).Should().Be(subscriptionsBefore, "no subscription row is touched and no trial is started");
    }

    [Fact]
    public async Task Down_removes_the_table_and_Up_runs_again()
    {
        await MigrateAccountsAsync(null);
        (await TableExistsAsync()).Should().BeTrue();

        await MigrateAccountsAsync(PreviousAccountsMigration);
        (await TableExistsAsync()).Should().BeFalse("Down drops accounts.access_extensions");

        await MigrateAccountsAsync(null);
        (await TableExistsAsync()).Should().BeTrue("the migration re-applies cleanly");
        ((bool)(await PurveshDemoReseedHarness.ScalarAsync(_su,
            "SELECT has_table_privilege('agrisync_app', 'accounts.access_extensions', 'INSERT') AND NOT has_table_privilege('agrisync_app', 'accounts.access_extensions', 'UPDATE')"))!)
            .Should().BeTrue("append-only: the app role may add a row, never change one");
    }

    // ── helpers ──

    private async Task MigrateAccountsAsync(string? target)
    {
        var options = new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(_su, n => n.MigrationsHistoryTable("__accounts_migrations_history", AccountsDbContext.SchemaName))
            .Options;
        await using var accounts = new AccountsDbContext(options);
        if (target is null)
        {
            await accounts.Database.MigrateAsync();
        }
        else
        {
            await accounts.Database.GetService<IMigrator>().MigrateAsync(target);
        }
    }

    private Task SeedAccountAsync(Guid account) =>
        PurveshDemoReseedHarness.ExecAsync(_su, """
            INSERT INTO accounts.owner_accounts
                (owner_account_id, account_name, primary_owner_user_id, account_type, status, created_at_utc, modified_at_utc)
            VALUES (@a, 'Probe account', @o, 1, 1, NOW(), NOW());
            """, ("a", account), ("o", Guid.NewGuid()));

    private Task SeedSubscriptionAsync(Guid account, int status, DateTime validUntilUtc) =>
        PurveshDemoReseedHarness.ExecAsync(_su, """
            INSERT INTO accounts.subscriptions
                (subscription_id, owner_account_id, plan_code, status, valid_from_utc, valid_until_utc, trial_ends_at_utc, created_at_utc, updated_at_utc)
            VALUES (@id, @a, 'shramsafal_pro', @s, @until - INTERVAL '14 days', @until, @until, @until - INTERVAL '14 days', @until);
            """, ("id", Guid.NewGuid()), ("a", account), ("s", status), ("until", validUntilUtc));

    private Task<long> ExtensionCountAsync(Guid account) =>
        PurveshDemoReseedHarness.CountAsync(_su, "SELECT count(*) FROM accounts.access_extensions WHERE owner_account_id = @a", ("a", account));

    private async Task<string> SubscriptionFingerprintAsync() =>
        (string)(await PurveshDemoReseedHarness.ScalarAsync(_su,
            "SELECT coalesce(string_agg(subscription_id::text || ':' || status || ':' || valid_until_utc::text || ':' || updated_at_utc::text, ',' ORDER BY subscription_id), '') FROM accounts.subscriptions"))!;

    private async Task<bool> TableExistsAsync() =>
        (bool)(await PurveshDemoReseedHarness.ScalarAsync(_su,
            "SELECT to_regclass('accounts.access_extensions') IS NOT NULL"))!;
}
