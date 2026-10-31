// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M — money follows the record)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>Lane OF-M — an edit makes or corrects its money (F89), on the record's own place and day (R4-3)</b>, on the real
/// <c>/sync/push</c> → Postgres → <c>/sync/pull</c> path as the non-superuser <c>agrisync_app</c> role (doctrine E3: every
/// fact first proves the role is neither superuser nor BYPASSRLS). Each fact builds its OWN scratch database.
///
/// <para>The money ids of a record's lines are RFC 4122 v5 of <c>"&lt;logId&gt;:&lt;kind&gt;:&lt;lineId&gt;"</c> under
/// the phone's money namespace — computed OUTSIDE the code under test (Python <c>uuid.uuid5</c>).</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class EditMoneyRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a2");
    private static readonly Guid AccountA = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a3");
    private static readonly Guid PlotA1 = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a4");
    private static readonly Guid CycleA1 = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a5");
    private static readonly Guid PlotA2 = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a6");
    private static readonly Guid CycleA2 = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000a7");
    private static readonly Guid WorkerA = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000aa");
    private static readonly Guid MukadamA = Guid.Parse("0f5e7a00-0000-4000-8000-0000000000ab");

    private static readonly Guid FarmB = Guid.Parse("0f5e7b00-0000-4000-8000-0000000000b1");
    private static readonly Guid OwnerB = Guid.Parse("0f5e7b00-0000-4000-8000-0000000000b2");
    private static readonly Guid AccountB = Guid.Parse("0f5e7b00-0000-4000-8000-0000000000b3");
    private static readonly Guid PlotB = Guid.Parse("0f5e7b00-0000-4000-8000-0000000000b4");
    private static readonly Guid CycleB = Guid.Parse("0f5e7b00-0000-4000-8000-0000000000b5");

    private const string SavedDay = "2026-10-30";

    // The record and its crew, and the money ids of its lines (Python uuid.uuid5, namespace 3f0c9a52-…-5e2f17a3d6b9).
    private static readonly Guid EditLog = Guid.Parse("0f5e7000-0000-4000-8000-000000000001");
    private static readonly Guid Crew = Guid.Parse("0f5e7000-0000-4000-8000-000000000002");
    private static readonly Guid In1Money = Guid.Parse("9bd9e936-9d5b-5f9b-8099-113a8520bd14"); // "<EditLog>:input:in-1"
    private static readonly Guid In2Money = Guid.Parse("cdae477d-62bf-5aac-9202-92aa44c26c19"); // "<EditLog>:input:in-2"
    private static readonly Guid MachMoney = Guid.Parse("b079665f-8eb3-5e30-b94b-34e30674cd8a"); // "<EditLog>:machinery:mach-1"
    private static readonly Guid ExpMoney = Guid.Parse("a2720dc8-c4a9-50d3-956e-2c7696136e11"); // "<EditLog>:activity-expense:exp-1"
    private static readonly Guid CrewMoney = Guid.Parse("2d480d19-9bbc-5a16-904e-e8f1ce86acb2"); // "<EditLog>:labour:<Crew>"

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_ofm_money_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'OF-M Farm A', @ownerA, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'OF-M Farm B', @ownerB, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @farmA, @ownerA, 'PrimaryOwner', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @workerA, 'Worker', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmB, @ownerB, 'PrimaryOwner', NOW(), NOW(), @accountB, 3);
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @mukadamA, 'Mukadam', NOW(), NOW(), @accountA, 3, TRUE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA1, @farmA, 'Plot A1', 1.0, NOW(), NOW()),
                       (@plotA2, @farmA, 'Plot A2', 1.0, NOW(), NOW()),
                       (@plotB, @farmB, 'Plot B', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA1, @farmA, @plotA1, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleA2, @farmA, @plotA2, 'Sugarcane', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleB, @farmB, @plotB, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("ownerA", OwnerA), ("accountA", AccountA), ("workerA", WorkerA), ("mukadamA", MukadamA),
                ("plotA1", PlotA1), ("cycleA1", CycleA1), ("plotA2", PlotA2), ("cycleA2", CycleA2),
                ("farmB", FarmB), ("ownerB", OwnerB), ("accountB", AccountB), ("plotB", PlotB), ("cycleB", CycleB));

            await UpgradedSeats.CarryAsync(raw, FarmA);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch (Exception ex)
        {
            // Best-effort teardown, never silent: a leaked scratch DB is harmless but is said.
            output.WriteLine($"[TEARDOWN] scratch database {_scratchDbName} was not dropped: {ex.GetType().Name}");
        }
    }

    // ── 1. A changed amount: one correction, the old amount kept; replay once ─────────────────────────────────

    [Fact]
    public async Task F89_an_amount_changed_by_an_edit_is_corrected_once_and_the_old_amount_stays_in_the_trail()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        var edit = RevisePayload(1, new { schema = 1, inputs = new object[] { Input("in-1", 800) } });
        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-800", edit);

        var trail = await ReadCorrectionsAsync(In1Money);
        output.WriteLine($"[EVIDENCE] corrections of the ₹500 line after the edit: {string.Join(" | ", trail)}");
        trail.Should().ContainSingle();
        trail[0].Should().Be(new Correction(500m, 800m, OwnerA));
        (await ReadMoneyAsync(In1Money)).Amount.Should().Be(500m, "the entry keeps what was first said; the correction says what it is now");
        (await ReadAuditCountAsync(In1Money, "Corrected")).Should().Be(1);

        var data = AnswerOf(answer);
        output.WriteLine($"[EVIDENCE] revise answer keys: {string.Join(",", data.EnumerateObject().Select(p => p.Name))}");
        data.GetProperty("moneyChanged").EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).Should().Equal(In1Money);
        var corrected = Assert.Single(data.GetProperty("moneyCorrections").EnumerateArray().ToList());
        corrected.GetProperty("costEntryId").GetGuid().Should().Be(In1Money);
        corrected.GetProperty("correctedAmount").GetDecimal().Should().Be(800m);
        data.GetProperty("moneyNotFollowed").GetArrayLength().Should().Be(0);

        // The pull carries the same correction to every phone: the money book reads ₹800.
        var pulled = await PullAsync(OwnerA);
        pulled.FinanceCorrections.Should().ContainSingle(c => c.CostEntryId == In1Money).Which.CorrectedAmount.Should().Be(800m);

        // Replay once: the same request answers from the store in the same shape, with the same correction; nothing new.
        var again = await PushAsync(OwnerA, "revise_log_content", "req-ofm-edit-800", edit);
        var replay = Assert.Single(again.Value!.Results);
        replay.Status.Should().Be("duplicate");
        var replayData = AnswerOf(replay);
        Assert.Single(replayData.GetProperty("moneyCorrections").EnumerateArray().ToList())
            .GetProperty("id").GetGuid().Should().Be(corrected.GetProperty("id").GetGuid());

        // Save pressed twice: a second request with the same content changes nothing more.
        var twice = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-800-twice", RevisePayload(2, new { schema = 1, inputs = new object[] { Input("in-1", 800) } }));
        AnswerOf(twice).GetProperty("moneyCorrections").GetArrayLength().Should().Be(0);
        (await ReadCorrectionsAsync(In1Money)).Should().ContainSingle("one change of the amount is one correction, however often it is sent");
    }

    // ── 2. A priced line added: one entry under its derived id, on the record's place and day ─────────────────

    [Fact]
    public async Task F89_a_priced_line_added_by_an_edit_makes_one_entry_under_its_derived_id_on_the_records_place_and_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-add", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 500), new { id = "in-2", productName = "युरिया", quantity = 2, unit = "bag", cost = 300 } },
            machinery = new object[] { new { id = "mach-1", type = "tractor", hoursUsed = 2, rentalCost = 1000, fuelCost = 200 } },
            activityExpenses = new object[] { new { id = "exp-1", reason = "वाहतूक", category = "Transport", vendor = "राजू", totalAmount = 150 } },
        }));

        var added = await ReadMoneyRowAsync(In2Money);
        output.WriteLine($"[EVIDENCE] the added line's money: {added}");
        added.Should().Be(new MoneyRow(FarmA, PlotA1, CycleA1, SavedDay, 300m, "other", "Expense", OwnerA, "युरिया"));
        (await ReadMoneyRowAsync(MachMoney)).Should().Be(new MoneyRow(FarmA, PlotA1, CycleA1, SavedDay, 1200m, "machinery_rent", "Expense", OwnerA, "tractor"));
        (await ReadMoneyRowAsync(ExpMoney)).Should().Be(new MoneyRow(FarmA, PlotA1, CycleA1, SavedDay, 150m, "transport", "Expense", OwnerA, "वाहतूक"));
        (await ReadCorrectionsAsync(In1Money)).Should().BeEmpty("an unchanged line's money is never touched");
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE farm_id = @id", FarmA)).Should().Be(4L);

        AnswerOf(answer).GetProperty("moneyChanged").EnumerateArray().Select(e => e.GetProperty("id").GetGuid())
            .Should().BeEquivalentTo([In2Money, MachMoney, ExpMoney]);
    }

    // ── 3. A priced line removed: corrected to nothing, the trail kept ────────────────────────────────────────

    [Fact]
    public async Task F89_a_priced_line_removed_by_an_edit_is_corrected_to_nothing_and_its_trail_is_kept()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-remove", RevisePayload(1, new { schema = 1 }));

        (await ReadCorrectionsAsync(In1Money)).Should().Equal(new Correction(500m, 0m, OwnerA));
        (await ReadMoneyAsync(In1Money)).Amount.Should().Be(500m, "the entry is never deleted: what was said stays");
        var pulled = await PullAsync(OwnerA);
        pulled.CostEntries.Should().Contain(e => e.Id == In1Money);
        pulled.FinanceCorrections.Should().ContainSingle(c => c.CostEntryId == In1Money).Which.CorrectedAmount.Should().Be(0m);

        // Brought back with a new amount: the same entry is corrected again — never a second entry beside it.
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-restore", RevisePayload(2, new { schema = 1, inputs = new object[] { Input("in-1", 600) } }));
        (await ReadCorrectionsAsync(In1Money)).Select(c => c.Corrected).Should().Equal(0m, 600m);
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE farm_id = @id", FarmA)).Should().Be(1L);
    }

    // ── 4. Shared-out or job-card money is not changed; the answer says why ───────────────────────────────────

    [Fact]
    public async Task F89_money_shared_out_across_plots_or_tied_to_a_job_card_is_not_changed_and_the_answer_says_why()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 500) },
            machinery = new object[] { new { id = "mach-1", type = "tractor", rentalCost = 1200 } },
        });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-mach", CostPayload(MachMoney, "machinery_rent", 1200m));
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                         created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @fid, @money, DATE '2026-10-30', 'equal', @uid, NOW(), NOW());
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, line_items)
            VALUES (@jc, @fid, @pid, @cid, @uid, DATE '2026-10-30', 'PaidOut', NOW(), NOW(), '[]'::jsonb);
            UPDATE ssf.cost_entries SET job_card_id = @jc WHERE "Id" = @mach;
            """, ("fid", FarmA), ("money", In1Money), ("uid", OwnerA), ("jc", Guid.NewGuid()), ("pid", PlotA1), ("cid", CycleA1),
            ("mach", MachMoney));

        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-tied", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 900) },
            machinery = new object[] { new { id = "mach-1", type = "tractor", rentalCost = 1500 } },
        }));

        (await ReadCorrectionsAsync(In1Money)).Should().BeEmpty("money shared out across plots is never changed under its shares");
        (await ReadCorrectionsAsync(MachMoney)).Should().BeEmpty("a job card's money is never changed by an edit");
        (await ReadVersionAsync()).Should().Be(2, "the edit itself landed: the money never holds the farmer's words back (P9)");
        var said = NotFollowed(answer);
        output.WriteLine($"[EVIDENCE] not followed: {string.Join(", ", said)}");
        said.Should().BeEquivalentTo(["input:in-1:shared", "machinery:mach-1:jobCard"]);
        (await ReadAuditPayloadsAsync(EditLog, "RecordMoneyFollowed")).Should().ContainSingle();
    }

    // ── 5. Old money (random ids, 1.0.15–1.0.17) is never found and never doubled ─────────────────────────────

    [Fact]
    public async Task F89_money_saved_the_old_way_is_never_found_never_doubled_and_the_answer_says_so()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        var oldWay = Guid.NewGuid(); // a 1.0.15–1.0.17 phone sent a fresh random id for the line's ₹500
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-old-way", CostPayload(oldWay, "other", 500m));

        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-old", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 800), new { id = "in-2", productName = "युरिया", cost = 300 } },
        }));

        (await ReadCorrectionsAsync(oldWay)).Should().BeEmpty("money the server cannot tie to the line is never guessed at");
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE \"Id\" = @id", In1Money)).Should().Be(0L,
            "no second entry is made beside the old one");
        (await ReadMoneyAsync(oldWay)).Amount.Should().Be(500m);
        (await ReadMoneyAsync(In2Money)).Amount.Should().Be(300m, "a line never priced before is new money: nothing old can stand for it");
        NotFollowed(answer).Should().Equal("input:in-1:notFound");
    }

    [Fact]
    public async Task F89_a_record_whose_create_time_details_the_server_never_held_changes_no_money_and_says_so()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // A 1.0.15–1.0.17 voice save, or a create whose details stayed on the phone: no create-time document.
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofm-create-bare", CreatePayload(EditLog, OwnerA, content: null));
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-bare", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 800), new { id = "in-2", productName = "युरिया", cost = 300 } },
        }));

        (await ReadCorrectionsAsync(In1Money)).Should().BeEmpty();
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE \"Id\" = @id", In2Money)).Should().Be(0L,
            "without the record's first details nobody can tell which lines already had money");
        NotFollowed(answer).Should().BeEquivalentTo(["input:in-1:detailsNotHeld", "input:in-2:detailsNotHeld"]);
    }

    // ── 6. R4-3 — edit money that arrives after a move lands at the record's current place and day ───────────

    [Fact]
    public async Task R4_3_edit_money_that_arrives_after_a_move_lands_at_the_records_current_plot_season_and_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        // Another phone moves the record first.
        await PushAppliedAsync(MukadamA, "move_daily_log", "req-ofm-move", new Dictionary<string, object?>
        {
            ["dailyLogId"] = EditLog,
            ["baseVersion"] = 1,
            ["newPlotIds"] = new[] { PlotA2 },
            ["newLogDate"] = "2026-10-27",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

        // Then his edit, made offline on the version he saw (1), arrives: it prices a new line and changes the old one.
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-late", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 650), new { id = "in-2", productName = "युरिया", cost = 300 } },
        }));

        var late = await ReadMoneyRowAsync(In2Money);
        output.WriteLine($"[EVIDENCE] edit money after the move: {late}");
        late.PlotId.Should().Be(PlotA2);
        late.CropCycleId.Should().Be(CycleA2);
        late.EntryDate.Should().Be("2026-10-27");
        var moved = await ReadMoneyRowAsync(In1Money);
        moved.PlotId.Should().Be(PlotA2, "the first money moved with the record");
        (await ReadCorrectionsAsync(In1Money)).Should().Equal(new Correction(500m, 650m, OwnerA));
    }

    // ── 7. Tenancy both ways ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Tenancy_an_edit_never_reaches_another_farms_money_and_another_farm_never_reaches_this_records()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateRecordAsync(OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-money-in1", CostPayload(In1Money, "other", 500m));

        // Foreign child: farm B already holds a money entry under the id this record's new line would take.
        var foreign = CostPayload(In2Money, "other", 999m);
        foreign["farmId"] = FarmB;
        foreign["plotId"] = PlotB;
        foreign["cropCycleId"] = CycleB;
        await PushAppliedAsync(OwnerB, "add_cost_entry", "req-ofm-foreign-money", foreign);

        var answer = await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofm-edit-tenancy", RevisePayload(1, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 500), new { id = "in-2", productName = "युरिया", cost = 300 } },
        }));
        var farmBRow = await ReadMoneyRowAsync(In2Money);
        output.WriteLine($"[EVIDENCE] the id held by farm B after farm A's edit: {farmBRow}");
        farmBRow.FarmId.Should().Be(FarmB);
        farmBRow.Amount.Should().Be(999m);
        (await ReadCorrectionsAsync(In2Money)).Should().BeEmpty();
        (await ReadVersionAsync()).Should().Be(2, "farm A's edit landed; farm B's row only kept its money from following");
        NotFollowed(answer).Should().Equal("input:in-2:idTaken");

        // Foreign parent: farm B's owner edits farm A's record: refused, and no money moves on either farm.
        var refused = await PushFailedAsync(OwnerB, "revise_log_content", "req-ofm-edit-foreign", RevisePayload(2, new
        {
            schema = 1,
            inputs = new object[] { Input("in-1", 1), new { id = "in-3", productName = "x", cost = 77 } },
        }));
        output.WriteLine($"[EVIDENCE] farm B editing farm A's record: {refused.ErrorCode}");
        (await ReadCorrectionsAsync(In1Money)).Should().BeEmpty();
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE farm_id = @id", FarmB)).Should().Be(1L);
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE farm_id = @id", FarmA)).Should().Be(1L);
    }

    // ── 8. Authority — the rule that let the first save make the money ────────────────────────────────────────

    [Fact]
    public async Task Authority_the_records_maker_corrects_its_money_by_editing_it_under_his_first_saves_rule()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // A worker saved the record and its money (any member may: add_cost_entry asks membership, nothing more).
        await CreateRecordAsync(WorkerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        await PushAppliedAsync(WorkerA, "add_cost_entry", "req-ofm-worker-money", CostPayload(In1Money, "other", 500m));

        // He may not review money entries in the money book…
        var direct = await PushFailedAsync(WorkerA, "correct_cost_entry", "req-ofm-worker-direct", new Dictionary<string, object?>
        {
            ["costEntryId"] = In1Money,
            ["correctedAmount"] = 800m,
            ["currencyCode"] = "INR",
            ["reason"] = "x",
        });
        direct.ErrorCode.Should().Be("ShramSafal.Forbidden");

        // …but his own record's money follows his edit, as it followed his first save.
        await PushAppliedAsync(WorkerA, "revise_log_content", "req-ofm-worker-edit", RevisePayload(1, new { schema = 1, inputs = new object[] { Input("in-1", 800) } }));
        (await ReadCorrectionsAsync(In1Money)).Should().Equal(new Correction(500m, 800m, WorkerA));
    }

    // ── 9. Labour — a worker-count correction never changes a crew's stated total (P7, NO-MULTIPLY) ───────────

    [Fact]
    public async Task Labour_a_worker_count_correction_never_changes_a_crews_stated_total_or_its_money()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var payload = CreatePayload(EditLog, OwnerA, new { schema = 1 });
        payload["labour"] = new object[] { new { labourAssignmentId = Crew, engagementType = "hired_daily", workerCount = 8, wagePerPerson = 350, totalCost = 2800 } };
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofm-crew-create", payload);
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-crew-money", CostPayload(CrewMoney, "labour_misc", 2800m));

        await PushAppliedAsync(MukadamA, "correct_labour_assignment", "req-ofm-crew-count", new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = Crew,
            ["dailyLogId"] = EditLog,
            ["farmId"] = FarmA,
            ["quantity"] = new { workerCount = 6 },
            ["seen"] = new { workerCount = 8 },
            ["correctedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", Crew)).Should().Be(6);
        (await ScalarAsync("SELECT total_cost FROM ssf.labour_assignments WHERE \"Id\" = @id", Crew)).Should().Be(2800m,
            "the total is what he said; 6 × ₹350 is never computed (NO-MULTIPLY)");
        (await ReadMoneyAsync(CrewMoney)).Amount.Should().Be(2800m);
        (await ReadCorrectionsAsync(CrewMoney)).Should().BeEmpty("a crew's money follows its stated total, which a count never changes");
    }

    // ── 10. R4-1 — a money-not-found refusal names exactly the missing money ──────────────────────────────────

    [Fact]
    public async Task R4_1_a_money_not_found_refusal_names_exactly_the_money_the_server_could_not_find()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var payload = CreatePayload(EditLog, OwnerA, new { schema = 1, inputs = new object[] { Input("in-1", 500) } });
        payload["labour"] = new object[] { new { labourAssignmentId = Crew, engagementType = "hired_daily", workerCount = 8, totalCost = 2800 } };
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofm-r41-create", payload);
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofm-r41-crew", CostPayload(CrewMoney, "labour_misc", 2800m));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofm-r41-move", new Dictionary<string, object?>
        {
            ["dailyLogId"] = EditLog,
            ["baseVersion"] = 1,
            ["newPlotIds"] = new[] { PlotA2 },
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        output.WriteLine($"[EVIDENCE] refusal: {refused.ErrorCode} | {refused.ErrorMessage}");
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveMoneyNotFound.Conflict", "the code every phone already reads is unchanged");
        refused.ErrorMessage.Should().Contain($"[money:{In1Money:D}]", "the refusal names the money it could not find");
        refused.ErrorMessage.Should().NotContain(CrewMoney.ToString("D"), "money that IS there is never named");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private static object Input(string id, decimal cost) => new { id, productName = "इथरेल", quantity = 250, unit = "मिली", cost };

    private async Task CreateRecordAsync(Guid actor, object content) =>
        await PushAppliedAsync(actor, "create_daily_log", "req-ofm-create", CreatePayload(EditLog, actor, content));

    /// <summary>A create as THIS build sends it (with its details), or with none (<paramref name="content"/> null).</summary>
    private static Dictionary<string, object?> CreatePayload(Guid dailyLogId, Guid operatorId, object? content)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA1,
            ["cropCycleId"] = CycleA1,
            ["operatorUserId"] = operatorId,
            ["logDate"] = SavedDay,
        };
        if (content is not null) payload["content"] = content;
        return payload;
    }

    private static Dictionary<string, object?> RevisePayload(int baseVersion, object content) => new()
    {
        ["dailyLogId"] = EditLog,
        ["baseVersion"] = baseVersion,
        ["content"] = content,
        ["reason"] = "दुरुस्ती",
        ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
    };

    private static Dictionary<string, object?> CostPayload(Guid id, string category, decimal amount) => new()
    {
        ["costEntryId"] = id,
        ["farmId"] = FarmA,
        ["categoryId"] = category,
        ["description"] = "from the record",
        ["amount"] = amount,
        ["currencyCode"] = "INR",
        ["entryDate"] = SavedDay,
        ["plotId"] = PlotA1,
        ["cropCycleId"] = CycleA1,
        ["direction"] = "Expense",
    };

    private static JsonElement AnswerOf(SyncMutationResultDto result) => JsonSerializer.SerializeToElement(result.Data, Web);

    /// <summary>"kind:lineId:reason" for every line whose money did not follow, as the answer says it.</summary>
    private static string[] NotFollowed(SyncMutationResultDto result) =>
        AnswerOf(result).GetProperty("moneyNotFollowed").EnumerateArray()
            .Select(e => $"{e.GetProperty("kind").GetString()}:{e.GetProperty("lineId").GetString()}:{e.GetProperty("reason").GetString()}")
            .ToArray();

    private sealed record Correction(decimal Original, decimal Corrected, Guid By);

    private async Task<List<Correction>> ReadCorrectionsAsync(Guid costEntryId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT original_amount, corrected_amount, corrected_by_user_id FROM ssf.finance_corrections
            WHERE cost_entry_id = @id ORDER BY corrected_at_utc
            """;
        cmd.Parameters.AddWithValue("id", costEntryId);
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<Correction>();
        while (await r.ReadAsync())
        {
            rows.Add(new Correction(r.GetDecimal(0), r.GetDecimal(1), r.GetGuid(2)));
        }

        return rows;
    }

    private sealed record Money(decimal Amount);

    private async Task<Money> ReadMoneyAsync(Guid costEntryId) => new((await ReadMoneyRowAsync(costEntryId)).Amount);

    private sealed record MoneyRow(
        Guid FarmId, Guid? PlotId, Guid? CropCycleId, string EntryDate, decimal Amount, string Category, string? Direction, Guid CreatedBy,
        string Description);

    private async Task<MoneyRow> ReadMoneyRowAsync(Guid costEntryId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT farm_id, plot_id, crop_cycle_id, entry_date, amount, category_id, direction, created_by_user_id, description
            FROM ssf.cost_entries WHERE "Id" = @id
            """;
        cmd.Parameters.AddWithValue("id", costEntryId);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue($"the money entry {costEntryId} must exist");
        return new MoneyRow(
            r.GetGuid(0),
            r.IsDBNull(1) ? null : r.GetGuid(1),
            r.IsDBNull(2) ? null : r.GetGuid(2),
            Day(r.GetValue(3)),
            r.GetDecimal(4),
            r.GetString(5),
            r.IsDBNull(6) ? null : r.GetString(6),
            r.GetGuid(7),
            r.GetString(8));
    }

    private async Task<int> ReadVersionAsync() =>
        (int)(await ScalarAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", EditLog))!;

    private async Task<long> ReadAuditCountAsync(Guid entityId, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.audit_events WHERE entity_id = @id AND action = @action";
        cmd.Parameters.AddWithValue("id", entityId);
        cmd.Parameters.AddWithValue("action", action);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<List<JsonElement>> ReadAuditPayloadsAsync(Guid entityId, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT payload::text FROM ssf.audit_events WHERE entity_id = @id AND action = @action ORDER BY occurred_at_utc";
        cmd.Parameters.AddWithValue("id", entityId);
        cmd.Parameters.AddWithValue("action", action);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<JsonElement>();
        while (await reader.ReadAsync())
        {
            rows.Add(JsonDocument.Parse(reader.GetString(0)).RootElement.Clone());
        }

        return rows;
    }

    /// <summary>A Postgres <c>date</c> as yyyy-MM-dd, whichever CLR type the driver hands back.</summary>
    private static string Day(object? value) => value switch
    {
        DateOnly d => d.ToString("yyyy-MM-dd"),
        DateTime t => t.ToString("yyyy-MM-dd"),
        _ => throw new InvalidOperationException($"not a date: {value?.GetType().Name ?? "null"}"),
    };

    private async Task<SyncMutationResultDto> PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(actor, mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
        return result;
    }

    private async Task<SyncMutationResultDto> PushFailedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(actor, mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the batch itself is answered: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[EVIDENCE] {mutationType} {clientRequestId} -> {result.Status} {result.ErrorCode}");
        result.Status.Should().Be("failed");
        return result;
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: $"device-ofm-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "PrimaryOwner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<SyncPullResponseDto> PullAsync(Guid user)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(user);
        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, user));
        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!;
    }

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText =
            "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), current_database()";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        var role = reader.GetString(0);
        var canBypass = reader.GetBoolean(1);
        var database = reader.GetString(2);

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse("an RLS proof run as a superuser or BYPASSRLS role proves nothing (E3)");
        database.Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, System.Threading.CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, System.Threading.CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, System.Threading.CancellationToken ct = default) => Task.CompletedTask;
    }
}
