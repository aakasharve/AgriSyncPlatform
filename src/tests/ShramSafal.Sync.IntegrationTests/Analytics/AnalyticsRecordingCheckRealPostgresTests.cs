// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9, N1-C1 code half)
using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// The analytics recording check (<see cref="IAnalyticsRecordingCheck"/>) on a real database, through the production
/// composition: it tells "nothing happened" apart from "nothing was recorded". Recording = the current UTC month's
/// partition of <c>analytics.events</c> exists, and when an entry was saved in the last 24 hours, the newest
/// <c>log.created</c> is not more than 60 minutes older than the newest entry. Doctrine E3: as the application role,
/// <see cref="AdminCountingRealPostgresHarness.GuardAsync"/> first. Made-up GUIDs only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AnalyticsRecordingCheckRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly Guid Admin = G("ad09");
    private static readonly Guid Owner = G("1901");
    private static readonly Guid Account = G("a901");
    private static readonly Guid Farm = G("f901");

    protected override string ScratchPrefix => "ssf_cr3_recording";

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await SeedUserAsync(db, Owner, "0000009901", "Fake Recording Owner", Ist(10, 1), Ist(10, 1));
        await SeedFarmAsync(db, Farm, "Fake Recording Farm", Owner, Account, Ist(10, 1));
        await SeedMembershipAsync(db, Farm, Owner, Account, "PrimaryOwner");

        // Rows a day or more old can fall in the previous UTC month: its partition must exist for them to be written.
        await ExecAsync(db, """
            DO $$
            DECLARE
                cur_start  date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
                prev_start date := (date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '1 month')::date;
            BEGIN
                EXECUTE format(
                    'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.events FOR VALUES FROM (%L) TO (%L);',
                    to_char(prev_start, '"events_p_"YYYY_MM'), prev_start, cur_start);
            END
            $$;
            """);
    }

    [SkippableFact]
    public async Task Healthy_recording_gives_numbers_and_the_check_is_cached()
    {
        await GuardAsync();
        await SeedEntryAndEventAsync(entryMinutesAgo: 5, logCreatedMinutesAgo: 4);

        var provider = BuildProvider();
        var state = await CheckAsync(provider);

        Output.WriteLine($"[EVIDENCE] recording={state.IsRecording} stoppedAt={state.StoppedAtUtc:O}");
        state.Should().Be(AnalyticsRecording.Recording);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "the newest entry is one audited cross-farm read");

        (await CheckAsync(provider)).Should().Be(AnalyticsRecording.Recording);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "a check within a minute is reused: nothing is read again");
    }

    [SkippableFact]
    public async Task An_entry_newer_than_the_newest_log_created_by_more_than_an_hour_is_not_recording()
    {
        await GuardAsync();
        await SeedEntryAndEventAsync(entryMinutesAgo: 5, logCreatedMinutesAgo: 120);

        var state = await CheckAsync(BuildProvider());

        Output.WriteLine($"[EVIDENCE] recording={state.IsRecording} stoppedAt={state.StoppedAtUtc:O}");
        state.IsRecording.Should().BeFalse("entries keep arriving but no log.created was written for them");
        state.NotMeasuredReason.Should().Be("analytics_not_recording");
        state.StoppedAtUtc.Should().NotBeNull("recording stopped at the newest log.created written");
        state.StoppedAtUtc!.Value.Should().BeCloseTo(DateTime.UtcNow.AddMinutes(-120), TimeSpan.FromMinutes(2));
    }

    [SkippableFact]
    public async Task A_missing_month_partition_is_not_recording()
    {
        await GuardAsync();
        var now = DateTime.UtcNow;
        var partition = $"analytics.events_p_{now.Year:D4}_{now.Month:D2}";
        await ExecAsSuperuserAsync($"DROP TABLE IF EXISTS {partition};");

        var state = await CheckAsync(BuildProvider());

        Output.WriteLine($"[EVIDENCE] dropped {partition}; recording={state.IsRecording} stoppedAt={state.StoppedAtUtc:O}");
        state.IsRecording.Should().BeFalse("every insert this month is refused without its partition");
        state.StoppedAtUtc.Should().Be(new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc),
            "inserts are refused from the first instant of the month");
    }

    [SkippableFact]
    public async Task A_quiet_day_with_no_recent_entry_is_still_recording()
    {
        await GuardAsync();
        await SeedEntryAndEventAsync(entryMinutesAgo: 2 * 24 * 60, logCreatedMinutesAgo: 3 * 24 * 60);

        var state = await CheckAsync(BuildProvider());

        state.Should().Be(AnalyticsRecording.Recording, "with no entry in the last 24 hours there is no lag to judge: nothing happened");
    }

    // ── harness ────────────────────────────────────────────────────────────

    private async Task SeedEntryAndEventAsync(int entryMinutesAgo, int logCreatedMinutesAgo)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await SeedEntryAsync(db, Farm, Owner, DateTime.UtcNow.AddMinutes(-entryMinutesAgo));
        await ExecAsync(db, """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id,
                 owner_account_id, actor_role, trigger, schema_version, props)
            VALUES (@id, 'log.created', @at, @actor, @farm, NULL, 'operator', 'manual', 'v1', '{}'::jsonb);
            """,
            ("id", Guid.NewGuid()), ("at", DateTime.UtcNow.AddMinutes(-logCreatedMinutesAgo)), ("actor", Owner), ("farm", Farm));
    }

    private static async Task<AnalyticsRecording> CheckAsync(Microsoft.Extensions.DependencyInjection.ServiceProvider provider)
    {
        await using var scope = AdminScope(provider);
        return await scope.ServiceProvider.GetRequiredService<IAnalyticsRecordingCheck>().CheckAsync(Admin, CancellationToken.None);
    }
}
