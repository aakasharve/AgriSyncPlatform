using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Single source of truth for the integration-test migration chain.
///
/// Applies the 4-phase interleaving that production (Program.cs) uses and that
/// <see cref="AnalyticsMigrationTests"/> proves. The naive "full SSF then
/// analytics" order fails with <c>42P01 relation "analytics.events" does not
/// exist</c> because the late SSF migration <c>AddAdminScopeHealthView</c>
/// references <c>analytics.events</c> (created only by the analytics chain),
/// and analytics' <c>DwcV2Matviews</c> in turn needs <c>ssf.workers</c> from a
/// late SSF migration — two crossed dependencies that only the interleaving
/// resolves:
///   A) SSF up to <c>AlterCostEntriesAddJobCardId</c>
///   B) Analytics up to <c>RestoreBuckets234Matviews</c> (creates analytics.events)
///   C) SSF full (AddAdminScopeHealthView + WtlV0Entities -> ssf.workers)
///   D) Analytics full (DwcV2Matviews -> needs ssf.workers)
/// </summary>
internal static class IntegrationMigrationChain
{
    private const string SsfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
    private const string AnalyticsPhase1Target = "20260502020000_RestoreBuckets234Matviews";

    public static async Task ApplyAsync(string conn)
    {
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(conn).Options;
        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(
                    typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;

        // A) SSF Phase A — pre-admin tables.
        await using (var ssfA = new ShramSafalDbContext(ssfOpts))
        {
            await ssfA.Database.GetService<IMigrator>().MigrateAsync(SsfPhaseATarget);
        }

        // B) Analytics Phase 1 — creates analytics.events.
        await using (var analyticsB = new AnalyticsDbContext(analyticsOpts))
        {
            await analyticsB.Database.GetService<IMigrator>().MigrateAsync(AnalyticsPhase1Target);
        }

        // C) SSF Phase B — AddAdminScopeHealthView (needs analytics.events) + WtlV0Entities (ssf.workers).
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }

        // D) Analytics Phase 2 — DwcV2Matviews (needs ssf.workers).
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }
    }
}
