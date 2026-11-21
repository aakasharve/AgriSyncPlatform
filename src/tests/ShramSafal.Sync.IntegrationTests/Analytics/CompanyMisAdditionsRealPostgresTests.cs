// spec: company-mis-real-numbers-2026-11-15 (plan CR-2c, Task 1 real-database tests; amendments E2, E3, E5, E6, E11)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2c, Task 1). Written by the test-writer from the plan
/// (Task 1, Review Focus, amendments E1-E11) and its precedents (CR-2a Task 3 read path; CR-2e C4, C19), never
/// from the implementor's reasoning.
///
/// <para>
/// The CR-2c additions are counted from real rows. Farm rows (stored days, costs, attendance, photos, job cards,
/// crop cycles, task lines) sit behind FORCE row-level security and are read per farm as <c>agrisync_app</c>; the
/// accepted side of sync (<c>ssf.sync_mutations</c>, no farm, no row-level security) and <c>analytics.events</c>
/// (<c>app.seen</c>, <c>sync.mutation_rejected</c>) are read by the app login too. Doctrine E3: every test first
/// asserts that the counting login is neither superuser nor BYPASSRLS (<see cref="AdminCountingRealPostgresHarness.GuardAsync"/>).
/// Where a test says "never through the admin context", the cross-farm factory is a login made for the test that
/// holds privileges ONLY on the farm keys and the audit row (the CR-2a review V2 construction).
/// </para>
///
/// Fixed counting instant: 06:30 UTC on 14 Nov 2026 (12:00 India time). The usual period is 10..13 Nov (previous
/// 6..9 Nov). Made-up GUIDs, obviously fake names and phone numbers only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class CompanyMisAdditionsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly From = new(2026, 11, 10);
    private static readonly DateOnly To = new(2026, 11, 13);

    private static readonly Guid Admin = G("ad01");
    private static readonly Guid U1 = G("101");
    private static readonly Guid U2 = G("102");
    private static readonly Guid U3 = G("103");
    private static readonly Guid Account1 = G("a1");
    private static readonly Guid Account2 = G("a2");
    private static readonly Guid F1 = G("f1");
    private static readonly Guid F2 = G("f2");
    private static readonly Guid P1 = G("e1");
    private static readonly Guid P2 = G("e2");
    private static readonly Guid TestAccount = G("900");

    private const string AppSeen = "app.seen";
    private const string Rejected = "sync.mutation_rejected";

    protected override string ScratchPrefix => "ssf_cr2c_mis";

    /// <summary>
    /// Two real farms (F1 owned by U1, F2 by U2, each the PrimaryOwner), plots P1 (2.5 acres, F1) and P2 (1.5, F2),
    /// two people verified on 11 Nov, one entry each (F1 on 12 Nov, F2 on 13 Nov, no task line), and the October
    /// and November partitions of analytics.events.
    /// </summary>
    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await SeedFarmAsync(db, F1, "Fake Test Farm One", U1, Account1, Ist(10, 1));
        await SeedFarmAsync(db, F2, "Fake Test Farm Two", U2, Account2, Ist(10, 1));
        await SeedMembershipAsync(db, F1, U1, Account1, "PrimaryOwner");
        await SeedMembershipAsync(db, F2, U2, Account2, "PrimaryOwner");
        await PlotAsync(db, P1, F1, 2.5m);
        await PlotAsync(db, P2, F2, 1.5m);
        await SeedUserAsync(db, U1, "9000000101", "Fake Farmer One", Ist(11, 11), Ist(11, 11));
        await SeedUserAsync(db, U2, "9000000102", "Fake Farmer Two", Ist(11, 11), Ist(11, 11, 12));
        await SeedEntryAsync(db, F1, U1, Ist(11, 12));
        await SeedEntryAsync(db, F2, U2, Ist(11, 13));
        await MonthPartitionAsync(db, 2026, 10);
        await MonthPartitionAsync(db, 2026, 11);
    }

    // ── #10, #49: stored days ────────────────────────────────────────────────

    [SkippableFact]
    public async Task Understanding_rows_are_read_through_row_level_security()
    {
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await DayAsync(db, F1, new DateOnly(2026, 11, 11), "BasicWorkDay", Components(0.6));
            await DayAsync(db, F1, new DateOnly(2026, 11, 12), "DeclaredNoWorkDay", Components(0.9)); // E4: not counted
            await DayAsync(db, F1, new DateOnly(2026, 11, 13), "BasicWorkDay", "{}");                // nothing to score
            await DayAsync(db, F2, new DateOnly(2026, 11, 12), "RichWorkDay", Components(0.8));
            await DayAsync(db, F2, new DateOnly(2026, 11, 8), "RichWorkDay", Components(0.3));       // previous period
        }

        // The control: the rows are there, and row-level security hides them from the app login without a farm.
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.daily_richness_aggregates")).Should().Be(5);
        (await CountAsAppAsync("ssf.daily_richness_aggregates")).Should().Be(0,
            "the control: the app login sees no stored day without a farm setting");

        await WithListerAsync(async listerConn =>
        {
            await RefusedToListerAsync(listerConn, "SELECT count(*) FROM ssf.daily_richness_aggregates");

            var dto = await LoadAsync(BuildProvider(migrationConn: listerConn), From, To);
            Output.WriteLine($"[EVIDENCE] scoredDays={dto.Overview.UnderstandingScoredDays.Current.Value} "
                             + $"median={dto.Overview.UnderstandingMedian.Current.Value} "
                             + $"spread={string.Join(",", dto.Quality.UnderstandingSpread.Items.Select(b => b.FarmDays))}");

            dto.FarmsNotReadable.Should().Be(0);
            dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(2m, null),
                "F1 on 11 Nov (6) and F2 on 12 Nov (8), read farm by farm as agrisync_app");
            dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(7.0m, null));
            dto.Overview.UnderstandingMedian.Previous.Should().Be(new MisValueDto(3.0m, null));
            dto.Quality.UnderstandingSpread.Items.Select(b => b.FarmDays).Should().Equal(
                new[] { 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0 });
        });
    }

    [SkippableFact]
    public async Task A_corrupt_components_row_is_left_out_not_zero()
    {
        // E5: a stored breakdown that cannot be read is left OUT of the count, never a 0, and the page answers.
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await DayAsync(db, F1, new DateOnly(2026, 11, 11), "BasicWorkDay", "{\"Execution\":\"x\"}");
            await DayAsync(db, F1, new DateOnly(2026, 11, 12), "BasicWorkDay", "[1,2,3]");
            await DayAsync(db, F2, new DateOnly(2026, 11, 12), "RichWorkDay", Components(0.5));
        }

        var dto = await LoadAsync(BuildProvider(), From, To);

        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(1m, null), "the two corrupt rows are left out");
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(5.0m, null));
        dto.Quality.UnderstandingSpread.Items.Single(b => b.Score == 0).FarmDays.Should().Be(0, "a corrupt row is not a 0");
    }

    // ── #29, #31: feature reads ─────────────────────────────────────────────

    [SkippableFact]
    public async Task Feature_reads_never_count_another_farms_rows()
    {
        // U1 is PrimaryOwner on F1 and a Worker on F2; U2 is PrimaryOwner on F2 only. If one farm's read returned
        // another farm's rows, U2's F2 rows would be put on F1 (where U2 holds no role: "Unknown") and U1's F2
        // attendance under his F1 role: the exact role table below would not hold.
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await SeedMembershipAsync(db, F2, U1, Account2, "Worker");
            await CostAsync(db, F1, P1, U1, Ist(11, 11));
            await AttachmentAsync(db, F1, U1, Ist(11, 12));
            await JobCardAsync(db, F1, P1, U1, Ist(11, 12));
            await CostAsync(db, F2, P2, U2, Ist(11, 12));
            await AttendanceAsync(db, F2, U1, Ist(11, 12));
            await AttachmentAsync(db, F2, U2, Ist(11, 13));
            await CostAsync(db, F2, P2, U3, Ist(11, 1));       // before the reads' start: never counted
        }

        foreach (var table in new[] { "ssf.cost_entries", "ssf.attendance_marks", "ssf.attachments", "ssf.job_cards" })
        {
            (await ScalarAsSuperuserAsync($"SELECT count(*) FROM {table}")).Should().BeGreaterThan(0, table);
            (await CountAsAppAsync(table)).Should().Be(0, $"the control: row-level security hides {table} without a farm setting");
        }

        await WithListerAsync(async listerConn =>
        {
            foreach (var table in new[] { "ssf.cost_entries", "ssf.attendance_marks", "ssf.attachments", "ssf.job_cards" })
            {
                await RefusedToListerAsync(listerConn, $"SELECT count(*) FROM {table}");
            }

            var dto = await LoadAsync(BuildProvider(migrationConn: listerConn), From, To);
            Output.WriteLine("[EVIDENCE] featureUse=" + string.Join("; ", dto.Engagement.FeatureUse.Items.Select(
                f => $"{f.Feature}:{f.People}/{f.SharePct}/{f.NotMeasuredReason}")));
            Output.WriteLine("[EVIDENCE] byRole=" + string.Join("; ", dto.Engagement.FeatureUseByRole.Items.Select(
                r => $"{r.Feature}:{r.Role}:{r.People}")));

            // Base: U1 and U2 each did something counted in the period.
            dto.Engagement.FeatureUse.Items.Should().BeEquivalentTo(new[]
            {
                new MisFeatureUseDto("entries", 2, 100.0m, null),
                new MisFeatureUseDto("voice", 0, 0.0m, null),
                new MisFeatureUseDto("costs", 2, 100.0m, null),
                new MisFeatureUseDto("attendance", 1, 50.0m, null),
                new MisFeatureUseDto("photos", 2, 100.0m, null),
                new MisFeatureUseDto("job_cards", 1, 50.0m, null),
                new MisFeatureUseDto("compare", null, null, "not_recorded"),
            }, "E1: no schedule feature; Compare is not recorded");
            dto.Engagement.FeatureUseByRole.Items.Should().BeEquivalentTo(new[]
            {
                new MisFeatureRoleDto("entries", "PrimaryOwner", 2),
                new MisFeatureRoleDto("costs", "PrimaryOwner", 2),
                new MisFeatureRoleDto("attendance", "Worker", 1),
                new MisFeatureRoleDto("photos", "PrimaryOwner", 2),
                new MisFeatureRoleDto("job_cards", "PrimaryOwner", 1),
            }, "each use carries the person's role on the farm where it happened, and no other farm's rows");
        });
    }

    // ── #59, #26: crop cycles and task lines ────────────────────────────────

    [SkippableFact]
    public async Task Crops_and_entry_kinds_are_read_through_row_level_security()
    {
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await CropAsync(db, F1, P1, "Grapes", new DateOnly(2026, 10, 1), null);
            await CropAsync(db, F2, P2, "Grapes", new DateOnly(2026, 10, 1), null);
            await CropAsync(db, F2, P2, "grapes ", new DateOnly(2026, 11, 1), null);                     // same plot, same crop
            await CropAsync(db, F2, P2, "Onion", new DateOnly(2026, 6, 1), new DateOnly(2026, 11, 9)); // ended before the period
            await CropAsync(db, F1, P1, "Wheat", new DateOnly(2026, 3, 1), new DateOnly(2026, 9, 1));
            await EntryWithTasksAsync(db, F1, U1, Ist(11, 12, 15), null, "irrigation", "spraying");
            await EntryWithTasksAsync(db, F2, U2, Ist(11, 13, 15), "labour");                        // labour, no task line
        }

        foreach (var table in new[] { "ssf.crop_cycles", "ssf.log_tasks" })
        {
            (await ScalarAsSuperuserAsync($"SELECT count(*) FROM {table}")).Should().BeGreaterThan(0, table);
            (await CountAsAppAsync(table)).Should().Be(0, $"the control: row-level security hides {table} without a farm setting");
        }

        await WithListerAsync(async listerConn =>
        {
            await RefusedToListerAsync(listerConn, "SELECT count(*) FROM ssf.crop_cycles");
            await RefusedToListerAsync(listerConn, "SELECT count(*) FROM ssf.log_tasks");

            var dto = await LoadAsync(BuildProvider(migrationConn: listerConn), From, To);

            dto.Farms.CropsOnActiveFarms.Items.Should().Equal(new[] { new MisCropRowDto("Grapes", 2, 4.0m) },
                "one crop on both active farms, with the plots' acres; the ended cycles are left out");
            dto.Engagement.LogsByKind.Items.Should().BeEquivalentTo(new[]
            {
                new MisKindCountDto("water", 1),
                new MisKindCountDto("nutrition", 0),
                new MisKindCountDto("spray", 1),
                new MisKindCountDto("other_work", 0),
                new MisKindCountDto("labour", 1),
                new MisKindCountDto("not_recognised", 2),   // the two seeded entries with no task line
            });
        });
    }

    // ── #47, #50: sync ──────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_non_number_refused_count_does_not_break_the_page()
    {
        // Review Focus 5 + C4: a rejectedWorkItems that is not a plain number of at most nine digits counts nothing
        // and the page answers. E11(6): only server-written rows count. CR-3 fix wave S-N6 (N1-I1): a refusal whose row
        // names a test account (props.personId) is left out; the accepted side cannot be tied to a person and says so.
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            var day = Ist(11, 12, 11);
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", "x")));
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", 9999999999L)));
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", -1)));
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", 1.5)));
            await EventAsync(db, Rejected, day, props: Props(("endpoint", "/sync/push")));
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", 2)));
            await EventAsync(db, Rejected, day, props: Props(("rejectedWorkItems", 1), ("personId", TestAccount.ToString("D"))));
            await ClientEventAsync(db, Rejected, day, U1, Props(("rejectedWorkItems", 5)));   // not written by the server
            await SyncMutationAsync(db, Ist(11, 12, 12));
        }

        var dto = await LoadAsync(BuildProvider(new[] { TestAccount }), From, To);
        Output.WriteLine($"[EVIDENCE] refused={dto.Quality.SyncRefusedChanges.Current.Value} accepted={dto.Quality.SyncAcceptedChanges.Current.Value} pct={dto.Quality.SyncRefusedPct.Current.Value}");

        dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(2m, null),
            "2 only: the test account's refusal is left out (fix wave S-N6); the garbage rows count nothing");
        dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(1m, null));
        dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(66.7m, null), "2 of (2 + 1)");
        dto.Quality.SyncRefusedChanges.CurrentByDay.Should().Equal(0m, 0m, 2m, 0m);
        dto.Quality.SyncAcceptedIncludesTestPhones.Should().BeTrue(
            "the accepted side records a device and no account, so it still counts test phones and the answer says so");

        // The control: with no test accounts listed, the same refusal counts.
        var unlisted = await LoadAsync(BuildProvider(), From, To);
        unlisted.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(3m, null));
    }

    [SkippableFact]
    public async Task Sync_accepted_rows_are_counted_from_sync_mutations()
    {
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await SyncMutationAsync(db, new DateTime(2026, 11, 11, 18, 45, 0, DateTimeKind.Utc)); // 00:15 India time, 12 Nov
            await SyncMutationAsync(db, Ist(11, 12, 16));
            await SyncMutationAsync(db, Ist(11, 13, 9));
            await SyncMutationAsync(db, Ist(11, 8, 9));                                             // previous period
            await SyncMutationAsync(db, CountedAt.AddMinutes(30));                                  // after the count
        }

        // The table has no farm and no row-level security: the app login reads it directly (pre-flight finding).
        (await CountAsAppAsync("ssf.sync_mutations")).Should().Be(5);

        await WithListerAsync(async listerConn =>
        {
            await RefusedToListerAsync(listerConn, "SELECT count(*) FROM ssf.sync_mutations");

            var dto = await LoadAsync(BuildProvider(migrationConn: listerConn), From, To);
            Output.WriteLine($"[EVIDENCE] accepted={dto.Quality.SyncAcceptedChanges.Current.Value} byDay={string.Join(",", dto.Quality.SyncAcceptedChanges.CurrentByDay ?? Array.Empty<decimal?>())}");

            dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(3m, null));
            dto.Quality.SyncAcceptedChanges.CurrentByDay.Should().Equal(new decimal?[] { 0m, 0m, 2m, 1m },
                "the 00:15 row is on 12 Nov in India time; the row after the count is not counted");
            dto.Quality.SyncAcceptedChanges.Previous.Should().Be(new MisValueDto(1m, null));
            dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(0m, null));
            dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(0.0m, null), "0 refused of 3 sent is a real 0%");
        });
    }

    [SkippableFact]
    public async Task A_refused_change_sent_twice_counts_twice_accepted_once()
    {
        // E2: the phone resends a refused change; each refusal is one sync.mutation_rejected row and counts. The
        // accepted side is one sync_mutations row per change (a unique index removes repeats).
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, Rejected, Ist(11, 12, 10), props: Props(("rejectedWorkItems", 1)));
            await EventAsync(db, Rejected, Ist(11, 12, 10, 5), props: Props(("rejectedWorkItems", 1)));
            await SyncMutationAsync(db, Ist(11, 12, 10, 10), device: "fake-device-1", request: "fake-request-1");

            // The construction: the same change accepted again is refused by the unique index.
            var again = async () => await SyncMutationAsync(db, Ist(11, 12, 10, 15), device: "fake-device-1", request: "fake-request-1");
            (await again.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("23505");
        }

        var dto = await LoadAsync(BuildProvider(), From, To);

        dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(2m, null), "refused twice: two attempts");
        dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(1m, null), "accepted once: one change");
        dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(66.7m, null), "2 of (2 + 1)");
    }

    // ── #52: app versions ───────────────────────────────────────────────────

    [SkippableFact]
    public async Task App_seen_is_read_from_analytics()
    {
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            // The first row the server wrote: 19:00 UTC on 19 Oct = 00:30 India time on 20 Oct.
            await EventAsync(db, AppSeen, new DateTime(2026, 10, 19, 19, 0, 0, DateTimeKind.Utc), props: SeenProps(U2, "1.0.15", null));
            await EventAsync(db, AppSeen, Ist(11, 10), props: SeenProps(U1, "1.0.16", "android"));
            await EventAsync(db, AppSeen, Ist(11, 12), props: SeenProps(U1, "1.0.17", "android"));
            await EventAsync(db, AppSeen, Ist(11, 11), props: SeenProps(U2, "1.0.17", null));
            await EventAsync(db, AppSeen, Ist(11, 12), props: SeenProps(TestAccount, "1.0.17", "android"));
            await EventAsync(db, AppSeen, Ist(11, 12), props: Props(("personId", "not-a-person"), ("appVersion", "1.0.17")));
            await ClientEventAsync(db, AppSeen, Ist(11, 12), U3, SeenProps(U3, "1.0.17", "android"));
            await ClientEventAsync(db, AppSeen, Ist(10, 2), U3, SeenProps(U3, "1.0.14", "android"));  // never the start
        }

        var dto = await LoadAsync(BuildProvider(new[] { TestAccount }), From, To);
        Output.WriteLine("[EVIDENCE] versions=" + string.Join("; ", dto.Quality.AppVersions.Items.Select(
            v => $"{v.Version}/{v.Platform}/{v.People}/{v.SharePct}")) + $" since={dto.Quality.AppVersionsSeenSince}");

        dto.Quality.AppVersions.NotMeasuredReason.Should().BeNull();
        dto.Quality.AppVersions.Items.Should().BeEquivalentTo(new[]
        {
            new MisVersionShareDto("1.0.17", "android", 1, 50.0m),
            new MisVersionShareDto("1.0.17", "not_android", 1, 50.0m),
        }, "U1 on his latest version, U2 on hers with no platform; the test account, the row naming no person and the "
           + "rows the server did not write are left out");
        dto.Quality.AppVersionsSeenSince.Should().Be(new DateOnly(2026, 10, 20),
            "the India day of the first app.seen row the server wrote");
    }

    // ── failures escape (Global Constraints, C19) ───────────────────────────

    /// <summary>
    /// A per-farm addition read that fails AFTER its connection opened escapes: the route answers 500, never an
    /// answer with the farm's rows silently missing. Construction (C19 item 1): the app login is refused SELECT on
    /// one table that only a CR-2c per-farm read touches, so the query reaches the server and is refused there.
    /// Bite-proven (C19): with a temporary, uncommitted swallowing catch around the per-farm additions this fails;
    /// restored byte for byte, it passes (both runs in the commit body).
    /// </summary>
    [SkippableTheory]
    [InlineData("daily_richness_aggregates")]
    [InlineData("job_cards")]
    [InlineData("crop_cycles")]
    public async Task A_failed_per_farm_read_escapes(string table)
    {
        await GuardAgrisyncAppAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await DayAsync(db, F1, new DateOnly(2026, 11, 12), "BasicWorkDay", Components(0.6));
            await JobCardAsync(db, F1, P1, U1, Ist(11, 12));
            await CropAsync(db, F1, P1, "Grapes", new DateOnly(2026, 10, 1), null);
        }

        var provider = BuildProvider();

        // The control: while the app login may read the table, the page answers.
        (await LoadAsync(provider, From, To)).Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(1m, null));

        await ExecAsSuperuserAsync($"REVOKE SELECT ON ssf.{table} FROM {IntegrationPostgres.AppRoleUser}");

        // The construction: the app login is now refused that table on the server.
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = $"SELECT count(*) FROM ssf.{table}";
            var refused = async () => await cmd.ExecuteScalarAsync();
            (await refused.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        }

        await using var scope = AdminScope(provider);
        var load = () => Handler(scope.ServiceProvider).HandleAsync(new GetCompanyMisQuery(From, To, Admin, IsPlatformSeat: true));

        var thrown = await load.Should().ThrowAsync<Exception>(
            "a failed per-farm read escapes (the route answers 500), never an answer with that farm's rows missing");
        Output.WriteLine($"[EVIDENCE] table={table} thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("permission denied").And.Contain(table,
            "it is the refused per-farm read that escaped");
    }

    // ── E3: the shared read pays nothing ────────────────────────────────────

    [SkippableFact]
    public async Task The_shared_read_pays_nothing_for_the_additions()
    {
        // E3: the voice check and the silent-farms list call ICompanyMisReader.ReadAsync; the additions are read
        // only by ReadForCompanyMisAsync. With every table only the additions read refused to the app login,
        // ReadAsync still answers, with the additions empty; ReadForCompanyMisAsync does not.
        await GuardAgrisyncAppAsync();
        await ExecAsSuperuserAsync($"""
            REVOKE SELECT ON ssf.daily_richness_aggregates, ssf.cost_entries, ssf.attendance_marks, ssf.attachments,
                             ssf.job_cards, ssf.crop_cycles, ssf.log_tasks, ssf.sync_mutations
                FROM {IntegrationPostgres.AppRoleUser};
            REVOKE SELECT ON analytics.events FROM {IntegrationPostgres.AppRoleUser};
            """);

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var reader = scope.ServiceProvider.GetRequiredService<ICompanyMisReader>();

        var rows = await reader.ReadAsync(Admin, Ist(9, 1), CountedAt, new HashSet<Guid>());

        Output.WriteLine($"[EVIDENCE] ReadAsync farms={rows.Farms.Count} entries={rows.Entries.Count} days={rows.UnderstandingDays.Count} uses={rows.FeatureUses.Count} crops={rows.CropCycles.Count} sync={rows.SyncDays.Count} seen={rows.AppSeen.Count}");
        rows.Farms.Should().HaveCount(2);
        rows.Entries.Should().HaveCount(2);
        rows.UnderstandingDays.Should().BeEmpty();
        rows.FeatureUses.Should().BeEmpty();
        rows.CropCycles.Should().BeEmpty();
        rows.SyncDays.Should().BeEmpty();
        rows.AppSeen.Should().BeEmpty();

        await using var scope2 = AdminScope(provider);
        var additions = () => scope2.ServiceProvider.GetRequiredService<ICompanyMisReader>()
            .ReadForCompanyMisAsync(Admin, Ist(9, 1), Ist(10, 1), CountedAt, new HashSet<Guid>());
        (await additions.Should().ThrowAsync<Exception>("the construction: the additions do read those tables"))
            .Which.ToString().Should().Contain("permission denied");
    }

    // ── E6 / E11(7): the route's time on the largest seed of this class ──────

    [SkippableFact]
    public async Task Route_time_on_the_largest_seed_is_recorded()
    {
        // E11(7): not a gate. 500 farms in all (the live-count ceiling): the two of the class seed plus 498, each with
        // an owner, a plot, a crop, 10 entries with a task line, 10 stored days, 3 costs, 3 attendance marks,
        // 2 photos and a job card; 2,000 accepted changes, 100 refusals, 498 app.seen rows. Period: the 30 days
        // 15 Oct..13 Nov (the page's default length).
        await GuardAgrisyncAppAsync();
        const int extra = 498;
        await using (var db = await OpenSuperuserAsync())
        {
            await ExecAsync(db, LoadSeedSql, ("n", extra), ("components", Components(0.6)));
        }

        var from = new DateOnly(2026, 10, 15);
        var provider = BuildProvider();

        var first = Stopwatch.StartNew();
        var dto = await LoadAsync(provider, from, To);
        first.Stop();
        var second = Stopwatch.StartNew();
        await LoadAsync(provider, from, To);
        second.Stop();

        Output.WriteLine($"[EVIDENCE] route time, {dto.FarmsListed} farms, 30-day period: first load {first.ElapsedMilliseconds} ms "
                         + $"(includes model warm-up), second load {second.ElapsedMilliseconds} ms");

        dto.FarmsListed.Should().Be(500);
        dto.FarmsNotReadable.Should().Be(0);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(extra * 10 + 2, null), "every farm was read");
        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(extra * 10, null));
        dto.Quality.SyncAcceptedChanges.Current.Value.Should().BeGreaterThan(0);
        dto.Engagement.FeatureUse.Items.Single(f => f.Feature == "costs").People.Should().Be(extra);
        dto.Farms.CropsOnActiveFarms.Items.Should().NotBeEmpty();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Doctrine E3, the first assertion of every test: the counting connection (the services' ShramSafalDb, UserDb
    /// and analytics connection are all <see cref="AdminCountingRealPostgresHarness.AppConn"/>) logs in as
    /// agrisync_app, which is neither superuser nor BYPASSRLS.
    /// </summary>
    private async Task GuardAgrisyncAppAsync()
    {
        await GuardAsync();

        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText = "SELECT current_user::text";
        var user = (string)(await cmd.ExecuteScalarAsync())!;
        Output.WriteLine($"[EVIDENCE] counting login current_user='{user}'");
        user.Should().Be("agrisync_app", "doctrine E3: the counts are read as the app login");
    }

    private static GetCompanyMisHandler Handler(IServiceProvider sp) =>
        new(sp.GetRequiredService<ICompanyMisReader>(), sp.GetRequiredService<IAdminOpsRepository>(),
            sp.GetRequiredService<CompanyMisExclusions>(), new FixedClock(CountedAt));

    private static async Task<CompanyMisDto> LoadAsync(ServiceProvider provider, DateOnly from, DateOnly to)
    {
        await using var scope = AdminScope(provider);
        var result = await Handler(scope.ServiceProvider)
            .HandleAsync(new GetCompanyMisQuery(from, to, Admin, IsPlatformSeat: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        return result.Value!.Data;
    }

    private async Task<long> CountAsAppAsync(string table)
    {
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {table}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>
    /// A login made for the test as the cross-farm factory's connection: past row-level security (BYPASSRLS) but
    /// with privileges ONLY on the farm keys and the audit row (CR-2a review V2). Any other read through the admin
    /// context is refused, so the page would throw.
    /// </summary>
    private async Task WithListerAsync(Func<string, Task> body)
    {
        var role = $"cr2c_lister_{Guid.NewGuid():N}"[..24];
        var listerConn = new NpgsqlConnectionStringBuilder(SuperuserConn) { Username = role, Password = "x" }.ConnectionString;
        await ExecAsSuperuserAsync($"""
            CREATE ROLE {role} LOGIN PASSWORD 'x' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
            GRANT CONNECT ON DATABASE "{ScratchDbName}" TO {role};
            GRANT USAGE ON SCHEMA ssf TO {role};
            GRANT SELECT ("Id", owner_account_id) ON ssf.farms TO {role};
            GRANT INSERT ON ssf.audit_events TO {role};
            """);
        try
        {
            await body(listerConn);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await ExecAsSuperuserAsync(
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{role}'; DROP OWNED BY {role};");
            await using var admin = new NpgsqlConnection(AdminConn);
            await admin.OpenAsync();
            await ExecAsync(admin, $"REVOKE ALL ON DATABASE \"{ScratchDbName}\" FROM {role}; DROP ROLE {role};");
        }
    }

    private static async Task RefusedToListerAsync(string listerConn, string sql)
    {
        await using var lister = new NpgsqlConnection(listerConn);
        await lister.OpenAsync();
        await using var cmd = lister.CreateCommand();
        cmd.CommandText = sql;
        var refused = async () => await cmd.ExecuteScalarAsync();
        (await refused.Should().ThrowAsync<PostgresException>(sql)).Which.SqlState.Should().Be("42501", sql);
    }

    /// <summary>A stored breakdown the day screen's reader understands: one applicable part, this much covered.</summary>
    private static string Components(double coverage) =>
        JsonSerializer.Serialize(new LensInput([new ScoredDimension("FAKE_PART", 10, true, coverage, 1.0)], [], []));

    private static string SeenProps(Guid person, string version, string? platform) =>
        Props(("appVersion", version), ("personId", person.ToString("D")), ("platform", platform));

    private static Task MonthPartitionAsync(NpgsqlConnection db, int year, int month)
    {
        var start = new DateOnly(year, month, 1);
        var end = start.AddMonths(1);
        return ExecAsync(db,
            $"CREATE TABLE IF NOT EXISTS analytics.events_p_{year:D4}_{month:D2} PARTITION OF analytics.events "
            + $"FOR VALUES FROM ('{start:yyyy-MM-dd}') TO ('{end:yyyy-MM-dd}');");
    }

    /// <summary>A row a client wrote (an actor and role 'user'): never one the server wrote.</summary>
    private static Task ClientEventAsync(NpgsqlConnection db, string type, DateTime at, Guid actor, string props) =>
        ExecAsync(db, """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id, actor_role, trigger, schema_version, props)
            VALUES (@id, @type, @at, @actor, NULL, 'user', 'client', 'v1', @props::jsonb);
            """,
            ("id", Guid.NewGuid()), ("type", type), ("at", at), ("actor", actor), ("props", props));

    private static Task PlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, decimal acres) =>
        ExecAsync(db, """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, 'Fake Plot', @acres, NOW(), NOW());
            """,
            ("id", plotId), ("farm", farmId), ("acres", acres));

    private static Task DayAsync(NpgsqlConnection db, Guid farmId, DateOnly day, string classification, string componentsJson) =>
        ExecAsync(db, """
            INSERT INTO ssf.daily_richness_aggregates
              ("Id", farm_id, local_date, time_zone, day_classification,
               has_work, has_meaningful_observation, has_learning, has_experiment_outcome,
               has_disturbance, has_declared_no_work_reason, advances_streak, advances_bar,
               shram_points_earned, reward_reasons, score_engine_version, components_json,
               created_at_utc, updated_at_utc)
            VALUES (@id, @farm, @day, 'Asia/Kolkata', @class,
               true, false, false, false, false, false, true, false,
               5, '[]'::jsonb, 'cr2c-test', @components::jsonb, NOW(), NOW());
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("day", day), ("class", classification), ("components", componentsJson));

    private static Task CostAsync(NpgsqlConnection db, Guid farmId, Guid plotId, Guid by, DateTime at) =>
        ExecAsync(db, """
            INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date,
                                          created_by_user_id, created_at_utc, modified_at_utc, source, model_version,
                                          prompt_version, category_id)
            VALUES (@id, @farm, @plot, 'fake cost', 100, 'INR', @date, @by, @at, @at, 'manual', 'unknown', 'unknown', 'other');
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("plot", plotId), ("date", DateOnly.FromDateTime(at + IstOffset)),
            ("by", by), ("at", at));

    private static Task AttendanceAsync(NpgsqlConnection db, Guid farmId, Guid recordedBy, DateTime at) =>
        ExecAsync(db, """
            INSERT INTO ssf.attendance_marks ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                                              recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (@id, @farm, @operator, @date, 1, 0, @by, @at, @at);
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("operator", Guid.NewGuid()),
            ("date", DateOnly.FromDateTime(at + IstOffset)), ("by", recordedBy), ("at", at));

    private static Task AttachmentAsync(NpgsqlConnection db, Guid farmId, Guid by, DateTime at) =>
        ExecAsync(db, """
            INSERT INTO ssf.attachments ("Id", farm_id, linked_entity_id, linked_entity_type, file_name, mime_type, status,
                                         created_by_user_id, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @linked, 'DailyLog', 'fake-photo.jpg', 'image/jpeg', 'Finalized', @by, @at, @at);
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("linked", Guid.NewGuid()), ("by", by), ("at", at));

    private static Task JobCardAsync(NpgsqlConnection db, Guid farmId, Guid plotId, Guid by, DateTime at) =>
        ExecAsync(db, """
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, created_by_user_id, planned_date, status, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @by, @date, 'Draft', @at, @at);
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("plot", plotId), ("by", by),
            ("date", DateOnly.FromDateTime(at + IstOffset)), ("at", at));

    private static Task CropAsync(NpgsqlConnection db, Guid farmId, Guid plotId, string name, DateOnly start, DateOnly? end) =>
        ExecAsync(db, """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, end_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @name, 'Vegetative', @start, @end, NOW(), NOW());
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("plot", plotId), ("name", name), ("start", start), ("end", end));

    /// <summary>One ssf.daily_logs row with its capture scope and one log_tasks row per activity type.</summary>
    private static async Task EntryWithTasksAsync(
        NpgsqlConnection db, Guid farmId, Guid operatorUserId, DateTime at, string? captureScope, params string[] activityTypes)
    {
        var logId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        await ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope,
                                        operator_user_id, log_date, created_at_utc,
                                        source, model_version, prompt_version, content_version, capture_scope)
            VALUES (@id, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @op, @date, @at, 'manual', 'unknown', 'unknown', 1, @scope);
            """,
            ("id", logId), ("farm", farmId), ("plot", plotId), ("cycle", Guid.NewGuid()), ("op", operatorUserId),
            ("date", DateOnly.FromDateTime(at + IstOffset)), ("at", at), ("scope", captureScope));

        foreach (var activity in activityTypes)
        {
            await ExecAsync(db, """
                INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, occurred_at_utc)
                VALUES (@id, @log, @activity, @at);
                """,
                ("id", Guid.NewGuid()), ("log", logId), ("activity", activity), ("at", at));
        }
    }

    private static Task SyncMutationAsync(NpgsqlConnection db, DateTime processedAt, string? device = null, string? request = null) =>
        ExecAsync(db, """
            INSERT INTO ssf.sync_mutations ("Id", device_id, client_request_id, mutation_type, response_payload_json, processed_at_utc)
            VALUES (@id, @device, @request, 'create_daily_log', '{}', @at);
            """,
            ("id", Guid.NewGuid()), ("device", device ?? "fake-device-" + Guid.NewGuid().ToString("N")[..8]),
            ("request", request ?? Guid.NewGuid().ToString("N")), ("at", processedAt));

    /// <summary>The E11(7) load seed (<c>@n</c> farms more, made-up rows only), in one statement batch.</summary>
    private const string LoadSeedSql = """
        INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
        SELECT md5('cr2c-farm-' || g)::uuid, 'Fake Load Farm ' || g, md5('cr2c-owner-' || g)::uuid, md5('cr2c-account-' || g)::uuid,
               TIMESTAMPTZ '2026-09-01 04:30:00+00', TIMESTAMPTZ '2026-09-01 04:30:00+00', 3.0, 'Unchecked'
        FROM generate_series(1, @n) g;

        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
        SELECT md5('cr2c-member-' || g)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-owner-' || g)::uuid, 'PrimaryOwner',
               NOW(), NOW(), md5('cr2c-account-' || g)::uuid, 3
        FROM generate_series(1, @n) g;

        INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
        SELECT md5('cr2c-plot-' || g)::uuid, md5('cr2c-farm-' || g)::uuid, 'Fake Load Plot', 1.5, NOW(), NOW()
        FROM generate_series(1, @n) g;

        INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
        SELECT md5('cr2c-cycle-' || g)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-plot-' || g)::uuid,
               (ARRAY['Grapes', 'Onion', 'Pomegranate'])[1 + g % 3], 'Vegetative', DATE '2026-06-01', NOW(), NOW()
        FROM generate_series(1, @n) g;

        INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date,
                                    created_at_utc, source, model_version, prompt_version, content_version)
        SELECT md5('cr2c-log-' || g || '-' || d)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-plot-' || g)::uuid,
               md5('cr2c-cycle-' || g)::uuid, ARRAY[md5('cr2c-plot-' || g)::uuid], 'Plot', md5('cr2c-owner-' || g)::uuid,
               DATE '2026-10-16' + d * 3, TIMESTAMPTZ '2026-10-16 04:30:00+00' + d * INTERVAL '3 days',
               'manual', 'unknown', 'unknown', 1
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 9) d;

        INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, occurred_at_utc)
        SELECT md5('cr2c-task-' || g || '-' || d)::uuid, md5('cr2c-log-' || g || '-' || d)::uuid,
               (ARRAY['irrigation', 'spraying', 'pruning', 'fertilizer'])[1 + d % 4],
               TIMESTAMPTZ '2026-10-16 04:30:00+00' + d * INTERVAL '3 days'
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 9) d;

        INSERT INTO ssf.daily_richness_aggregates
          ("Id", farm_id, local_date, time_zone, day_classification, has_work, has_meaningful_observation, has_learning,
           has_experiment_outcome, has_disturbance, has_declared_no_work_reason, advances_streak, advances_bar,
           shram_points_earned, reward_reasons, score_engine_version, components_json, created_at_utc, updated_at_utc)
        SELECT md5('cr2c-day-' || g || '-' || d)::uuid, md5('cr2c-farm-' || g)::uuid, DATE '2026-10-16' + d * 3, 'Asia/Kolkata',
               'BasicWorkDay', true, false, false, false, false, false, true, false, 5, '[]'::jsonb, 'cr2c-test',
               @components::jsonb, NOW(), NOW()
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 9) d;

        INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                      created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
        SELECT md5('cr2c-cost-' || g || '-' || d)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-plot-' || g)::uuid,
               'fake load cost', 100, 'INR', DATE '2026-10-20' + d * 7, md5('cr2c-owner-' || g)::uuid,
               TIMESTAMPTZ '2026-10-20 05:30:00+00' + d * INTERVAL '7 days', NOW(), 'manual', 'unknown', 'unknown', 'other'
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 2) d;

        INSERT INTO ssf.attendance_marks ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                                          recorded_by_user_id, recorded_at_utc, modified_at_utc)
        SELECT md5('cr2c-mark-' || g || '-' || d)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-worker-' || g || '-' || d)::uuid,
               DATE '2026-10-21' + d * 7, 1, 0, md5('cr2c-owner-' || g)::uuid,
               TIMESTAMPTZ '2026-10-21 05:30:00+00' + d * INTERVAL '7 days', NOW()
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 2) d;

        INSERT INTO ssf.attachments ("Id", farm_id, linked_entity_id, linked_entity_type, file_name, mime_type, status,
                                     created_by_user_id, created_at_utc, modified_at_utc)
        SELECT md5('cr2c-photo-' || g || '-' || d)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-log-' || g || '-' || d)::uuid,
               'DailyLog', 'fake-photo.jpg', 'image/jpeg', 'Finalized', md5('cr2c-owner-' || g)::uuid,
               TIMESTAMPTZ '2026-10-22 05:30:00+00' + d * INTERVAL '9 days', NOW()
        FROM generate_series(1, @n) g CROSS JOIN generate_series(0, 1) d;

        INSERT INTO ssf.job_cards (id, farm_id, plot_id, created_by_user_id, planned_date, status, created_at_utc, modified_at_utc)
        SELECT md5('cr2c-card-' || g)::uuid, md5('cr2c-farm-' || g)::uuid, md5('cr2c-plot-' || g)::uuid,
               md5('cr2c-owner-' || g)::uuid, DATE '2026-11-05', 'Draft', TIMESTAMPTZ '2026-11-04 05:30:00+00', NOW()
        FROM generate_series(1, @n) g;

        INSERT INTO ssf.sync_mutations ("Id", device_id, client_request_id, mutation_type, response_payload_json, processed_at_utc)
        SELECT md5('cr2c-sync-' || i)::uuid, 'fake-load-device-' || (i % 50), 'fake-load-request-' || i, 'create_daily_log', '{}',
               TIMESTAMPTZ '2026-10-15 06:00:00+00' + (i % 29) * INTERVAL '1 day'
        FROM generate_series(1, 2000) i;

        INSERT INTO analytics.events (event_id, event_type, occurred_at_utc, actor_user_id, farm_id, actor_role, trigger, schema_version, props)
        SELECT md5('cr2c-rejected-' || i)::uuid, 'sync.mutation_rejected', TIMESTAMPTZ '2026-10-16 07:00:00+00' + (i % 28) * INTERVAL '1 day',
               NULL, NULL, 'system', 'middleware', 'v1', jsonb_build_object('rejectedWorkItems', 1 + i % 3)
        FROM generate_series(1, 100) i;

        INSERT INTO analytics.events (event_id, event_type, occurred_at_utc, actor_user_id, farm_id, actor_role, trigger, schema_version, props)
        SELECT md5('cr2c-seen-' || g)::uuid, 'app.seen', TIMESTAMPTZ '2026-11-01 07:00:00+00' + (g % 12) * INTERVAL '1 day',
               NULL, NULL, 'system', 'middleware', 'v1',
               CASE WHEN g % 2 = 0
                    THEN jsonb_build_object('personId', md5('cr2c-owner-' || g)::uuid::text, 'appVersion', '1.0.' || (10 + g % 8), 'platform', 'android')
                    ELSE jsonb_build_object('personId', md5('cr2c-owner-' || g)::uuid::text, 'appVersion', '1.0.' || (10 + g % 8))
               END
        FROM generate_series(1, @n) g;
        """;

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }
}
