// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 4 ("day 0 and RLS").
//
// ssf.schedule_subscriptions and ssf.schedule_migration_events are ONE farm's choices (each row carries farm_id), yet they
// sat on the RLS exemption inventory as "author-owned". Migration 20261106*_AddScheduleSubscriptionDayZeroAndRls puts both
// under FORCE RLS on farm_id and adds the plot's day 0 (reference_date). Proven here as agrisync_app (E3 first): another
// farm's rows are invisible under its own scope and under a user scope, a write naming another farm is refused, and
// Down() then Up() keeps every subscription (only the day 0 written since is lost, as the migration says).
using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleSubscriptionRlsRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    /// <summary>The ShramSafal migration this lane's migration follows (lane WID).</summary>
    private const string PreviousMigration = "20261102163914_AddWorkerIdentity";

    [Fact]
    public async Task Subscription_rows_are_invisible_to_another_farm_as_agrisync_app()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Two library rows: with rows, only what is listed can be adopted (fix round 1, H2).
        var first = await SeedTemplateRowAsync("Grapes - L8b-1 rls first");
        var second = await SeedTemplateRowAsync("Grapes - L8b-1 rls");
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, first)).Status.Should().Be(HttpStatusCode.OK);
        var migrate = await SendJsonAsync(System.Net.Http.HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/migrate", Owner,
            new { farmId = FarmA, newScheduleTemplateId = second, reason = "Other" });
        migrate.Status.Should().Be(HttpStatusCode.OK, migrate.Body);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE farm_id = @f", ("f", FarmA))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_migration_events WHERE farm_id = @f", ("f", FarmA))).Should().Be(1);

        // Farm B's own scope (the way every farm route and push mutation opens it): nothing of farm A.
        (await CountAsAppAsync(farm: FarmB, user: OwnerB, "ssf.schedule_subscriptions")).Should().Be(0);
        (await CountAsAppAsync(farm: FarmB, user: OwnerB, "ssf.schedule_migration_events")).Should().Be(0);

        // Farm B's owner under a user scope only (the multi-farm read posture): nothing of farm A.
        (await CountAsAppAsync(farm: null, user: OwnerB, "ssf.schedule_subscriptions")).Should().Be(0);
        (await CountAsAppAsync(farm: null, user: OwnerB, "ssf.schedule_migration_events")).Should().Be(0);

        // No scope at all: nothing.
        (await CountAsAppAsync(farm: null, user: null, "ssf.schedule_subscriptions")).Should().Be(0);

        // Not vacuous: farm A's own scope sees its rows.
        (await CountAsAppAsync(farm: FarmA, user: Owner, "ssf.schedule_subscriptions")).Should().Be(2);
        (await CountAsAppAsync(farm: FarmA, user: Owner, "ssf.schedule_migration_events")).Should().Be(1);

        // A write naming farm A under farm B's scope is refused by the row policy (WITH CHECK).
        var refused = async () =>
        {
            await using var db = new NpgsqlConnection(AppConn);
            await db.OpenAsync();
            await using var tx = await db.BeginTransactionAsync();
            await SetScopeAsync(db, FarmB, OwnerB);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                        schedule_version_tag, adopted_at_utc, state)
                VALUES (gen_random_uuid(), @farmA, @plot, gen_random_uuid(), 'grapes', gen_random_uuid(), 'v', NOW(), 1);
                """;
            cmd.Parameters.AddWithValue("farmA", FarmA);
            cmd.Parameters.AddWithValue("plot", Guid.NewGuid());
            await cmd.ExecuteNonQueryAsync();
        };
        (await refused.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");

        // Both tables are FORCEd (the app role owns them on every real cluster).
        (await CountAsync("""
            SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'ssf' AND c.relname IN ('schedule_subscriptions', 'schedule_migration_events')
              AND c.relrowsecurity AND c.relforcerowsecurity
            """)).Should().Be(2);
    }

    [Fact]
    public async Task Down_then_Up_keeps_existing_subscriptions()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);
        var day0 = new System.Collections.Generic.Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot2,
            ["cropCycleId"] = cycle2,
            ["scheduleTemplateId"] = BuiltInGrapes,
            ["actorUserId"] = Owner,
            ["referenceDate"] = "2026-09-15",
        };
        (await PushAsync(Owner, "adopt_schedule", "l8b1-downup", day0)).Status.Should().Be("applied");
        var before = await SubscriptionsAsync();
        before.Should().HaveCount(2);
        before.Single(r => r.Plot == plot2).ReferenceDate.Should().Be(new DateOnly(2026, 9, 15));

        await MigrateSsfToAsync(PreviousMigration);
        (await ColumnExistsAsync("reference_date")).Should().BeFalse("Down() drops the day-0 column");
        (await ForcedCountAsync()).Should().Be(0, "Down() takes both tables out of the row policy again");
        (await SubscriptionsAsync(withReferenceDate: false)).Select(r => r with { ReferenceDate = null })
            .Should().BeEquivalentTo(before.Select(r => r with { ReferenceDate = null }), "Down() keeps every subscription");

        await MigrateSsfToAsync(null);
        (await ColumnExistsAsync("reference_date")).Should().BeTrue();
        (await ForcedCountAsync()).Should().Be(2, "Up() puts both tables back under FORCE RLS");
        var after = await SubscriptionsAsync();
        after.Select(r => r with { ReferenceDate = null }).Should().BeEquivalentTo(before.Select(r => r with { ReferenceDate = null }));
        after.Should().OnlyContain(r => r.ReferenceDate == null, "the day 0 written before Down() is what Down() destroys");

        // The app still adopts after the round trip.
        var (plot3, cycle3) = await SeedSeasonAsync("Grapes");
        (await AdoptAsync(Owner, FarmA, plot3, cycle3, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private async Task<long> CountAsAppAsync(Guid? farm, Guid? user, string table)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {table}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private static async Task SetScopeAsync(NpgsqlConnection db, Guid? farm, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT set_config('agrisync.farm_id', @farm, true), set_config('agrisync.user_id', @user, true);
            """;
        cmd.Parameters.AddWithValue("farm", farm?.ToString() ?? Guid.Empty.ToString());
        cmd.Parameters.AddWithValue("user", user?.ToString() ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task MigrateSsfToAsync(string? target)
    {
        // The same options IntegrationMigrationChain migrated this database with (its history table included).
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options;
        await using var ssf = new ShramSafalDbContext(options);
        await ssf.Database.GetService<IMigrator>().MigrateAsync(target);
    }

    private async Task<bool> ColumnExistsAsync(string column) =>
        await CountAsync("""
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name = @c
            """, ("c", column)) == 1;

    private Task<long> ForcedCountAsync() => CountAsync("""
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf' AND c.relname IN ('schedule_subscriptions', 'schedule_migration_events')
          AND (c.relrowsecurity OR c.relforcerowsecurity)
        """);
}
