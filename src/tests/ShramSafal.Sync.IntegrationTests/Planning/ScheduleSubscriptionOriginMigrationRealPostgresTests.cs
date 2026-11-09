// spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-1F: migration 20261108150000_AddScheduleSubscriptionOriginAndCheck.
//
// Two NULLABLE columns on ssf.schedule_subscriptions (origin, check_state_at_adopt), each with a CHECK that holds only its names.
// ADDITIVE (E8): a row written the way the deployed binary writes it (neither column named) is still accepted; Down() drops only the two
// CHECKs and the two columns and keeps every subscription. Real Postgres as agrisync_app (E3 first), full chain on a fresh database.
using System;
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
public sealed class ScheduleSubscriptionOriginMigrationRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private const string ThisMigration = "20261108150000_AddScheduleSubscriptionOriginAndCheck";
    private const string MigrationBefore = "20261108120000_AddScheduleCheckAndStoredDays";

    private async Task<long> ColumnCountAsync() => await CountAsync("""
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name IN ('origin', 'check_state_at_adopt')
        """);

    [Fact]
    public async Task Both_columns_are_nullable_and_a_row_written_the_old_way_is_accepted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await ColumnCountAsync()).Should().Be(2);
        (await CountAsync("""
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions'
              AND column_name IN ('origin', 'check_state_at_adopt') AND is_nullable = 'YES'
            """)).Should().Be(2);

        // The deployed binary names neither column: its INSERT must still work (P11).
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @template, 'v1', NOW(), 0);
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("template", BuiltInGrapes));
        (await SubscriptionsAsync()).Should().ContainSingle();
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL AND check_state_at_adopt IS NULL")).Should().Be(1);
    }

    [Fact]
    public async Task The_checks_refuse_a_name_the_columns_do_not_hold()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var (column, bad) in new[] { ("origin", "Other"), ("check_state_at_adopt", "Withdrawn") })
        {
            var write = async () => await ExecOnSuperuserAsync($"""
                INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                        schedule_version_tag, adopted_at_utc, state, {column})
                VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @template, 'v1', NOW(), 0, '{bad}');
                """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("template", BuiltInGrapes));
            (await write.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("23514", column);
        }
    }

    [Fact]
    public async Task Down_drops_only_the_two_columns_and_Up_brings_them_back_and_the_chain_boots_twice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var adopted = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);
        adopted.Status.Should().Be(System.Net.HttpStatusCode.OK, adopted.Body);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin = 'Outside' AND check_state_at_adopt = 'NotChecked'")).Should().Be(1);

        await MigrateAsync(MigrationBefore);

        (await ColumnCountAsync()).Should().Be(0, "Down drops what Up added");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions")).Should().Be(1, "every subscription itself remains");
        (await CountAsync("SELECT count(*) FROM pg_constraint WHERE conname IN ('ck_sched_sub_origin', 'ck_sched_sub_check_state_at_adopt')")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(0);

        await MigrateAsync(null);

        (await ColumnCountAsync()).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(1);
        // lane L8b-3 (deliberate): re-applying the chain runs the 3 + 1 back-fill, which reads a NULL origin as Outside; the check mark stays NULL.
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin = 'Outside' AND check_state_at_adopt IS NULL")).Should().Be(1, "the marks were lost with Down (origin read as Outside again by L8b-3); the row was not");
    }

    private async Task MigrateAsync(string? target)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);
        var migrator = db.Database.GetService<IMigrator>();
        if (target is null)
        {
            await migrator.MigrateAsync();
        }
        else
        {
            await migrator.MigrateAsync(target);
        }
    }
}
