// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RLS-2 (register F113).
//
// Migration 20261107034303_AddRlsToDayLedgersLogTasksAndPlannedActivities puts the day ledger and its share lines, a log's
// task lines, a season's planned steps and the two February ledger tables under ENABLE + FORCE RLS. Proven here as
// agrisync_app on the one seeded farm (RoleScopedFarm: owner, मुकादम, कामगार, a paused seat, a second farm), E3 first:
//   1. each table: another farm's scope and no scope see nothing and can write nothing; the farm's own scope can;
//   2. the user-scoped reads: the registrant and an ACTIVE seat read the rows across their farms, a paused, waiting or
//      removed seat reads none;
//   3. the real doors still work under the wall (a split bill with its share lines, a log's task line, plan generation and
//      a step added, moved and removed), and the cron path (the compliance sweeper's farm scope) still reads them;
//   4. P11: the pull for the owner and for a member, the money summary and the attention board answer exactly what they
//      answer on the base schema (the migration taken down), and Down / Up keep every row.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmWorkTablesRlsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    /// <summary>The ShramSafal migration lane RLS-2's migration follows (lane BILL-1): the base schema.</summary>
    private const string BaseMigration = "20261106221812_AddCostEntryApprovals";

    private static readonly Guid OwnerTask = Guid.Parse("3d030000-0000-4000-8000-0000000002a1");
    private static readonly Guid FarmBTask = Guid.Parse("3d030000-0000-4000-8000-0000000002a2");
    private static readonly Guid Allocation = Guid.Parse("3d030000-0000-4000-8000-0000000002a3");
    private static readonly Guid LedgerB = Guid.Parse("3d030000-0000-4000-8000-0000000002a4");
    private static readonly Guid PlannedB = Guid.Parse("3d030000-0000-4000-8000-0000000002a5");
    private static readonly Guid LegacyLedger = Guid.Parse("3d030000-0000-4000-8000-0000000002a6");
    private static readonly Guid Waiting = Guid.Parse("3d030000-0000-4000-8000-0000000002b1");
    private static readonly Guid Removed = Guid.Parse("3d030000-0000-4000-8000-0000000002b2");
    private static readonly Guid TwoFarms = Guid.Parse("3d030000-0000-4000-8000-0000000002b3");

    /// <summary>Each walled table and how a farm-A row of it is counted (superuser), so "nothing lost" is per table.</summary>
    private static readonly string[] Tables =
    [
        "day_ledgers", "day_ledger_allocations", "log_tasks", "planned_activities",
        "day_ledgers_legacy_financev2", "day_ledger_plot_allocations_legacy_financev2",
    ];

    [Fact]
    public async Task Each_table_is_walled_by_farm_and_read_by_seat_as_agrisync_app()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedEveryTableAsync();

        foreach (var table in Tables)
        {
            var aRows = await CountAsync($"SELECT count(*) FROM ssf.{table} WHERE {FarmAPredicate(table)}");
            aRows.Should().BeGreaterThan(0, "{0} holds a farm-A row (else the proof is vacuous)", table);

            // Another farm's scope, and no scope at all: none of farm A's rows.
            (await CountAsAppAsync(FarmB, OwnerB, table, FarmAPredicate(table))).Should().Be(0, "{0} under farm B's scope", table);
            (await CountAsAppAsync(null, null, table, FarmAPredicate(table))).Should().Be(0, "{0} with no scope", table);
            // The farm's own scope: all of them.
            (await CountAsAppAsync(FarmA, Owner, table, FarmAPredicate(table))).Should().Be(aRows, "{0} under farm A's scope", table);

            // Writes naming a farm-A row under farm B's scope: the insert is refused, update and delete touch nothing.
            var insert = async () => await ExecAsAppAsync(FarmB, OwnerB, InsertFarmARow(table));
            (await insert.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", table);
            (await ExecAsAppAsync(FarmB, OwnerB, UpdateFarmARows(table))).Should().Be(0, "{0}: farm B updates nothing of A", table);
            (await ExecAsAppAsync(FarmB, OwnerB, $"DELETE FROM ssf.{table} WHERE {FarmAPredicate(table)}")).Should().Be(0, table);
            (await ExecAsAppAsync(null, null, $"DELETE FROM ssf.{table} WHERE {FarmAPredicate(table)}")).Should().Be(0, table);

            // Under farm A's own scope the same writes go through (rolled back: nothing is kept).
            (await ExecAsAppAsync(FarmA, Owner, InsertFarmARow(table))).Should().Be(1, "{0}: farm A inserts its own row", table);
            (await ExecAsAppAsync(FarmA, Owner, UpdateFarmARows(table))).Should().Be(aRows, table);
            (await ExecAsAppAsync(FarmA, Owner, $"DELETE FROM ssf.{table} WHERE {FarmAPredicate(table)}")).Should().Be(aRows, table);
            (await CountAsync($"SELECT count(*) FROM ssf.{table} WHERE {FarmAPredicate(table)}")).Should().Be(aRows, "rolled back");
        }

        // The user-scoped reads (no farm scope, only agrisync.user_id): the registrant and an ACTIVE seat read farm A;
        // a paused, a waiting and a removed seat read nothing; a person with an ACTIVE seat on both farms reads both.
        foreach (var table in new[] { "day_ledgers", "day_ledger_allocations", "log_tasks", "planned_activities" })
        {
            var aRows = await CountAsync($"SELECT count(*) FROM ssf.{table} WHERE {FarmAPredicate(table)}");
            var bRows = await CountAsync($"SELECT count(*) FROM ssf.{table} WHERE {FarmBPredicate(table)}");
            bRows.Should().BeGreaterThan(0, "{0} holds a farm-B row", table);
            (await CountAsAppAsync(null, Owner, table, FarmAPredicate(table))).Should().Be(aRows, "{0}: the registrant", table);
            (await CountAsAppAsync(null, Mukadam, table, FarmAPredicate(table))).Should().Be(aRows, "{0}: an active seat", table);
            (await CountAsAppAsync(null, Owner, table, FarmBPredicate(table))).Should().Be(0, "{0}: not his farm", table);
            foreach (var (seat, why) in new[] { (Paused, "paused"), (Waiting, "waiting"), (Removed, "removed"), (OwnerB, "another farm's owner") })
            {
                (await CountAsAppAsync(null, seat, table, "true")).Should().Be(
                    seat == OwnerB ? bRows : 0, "{0}: a {1} seat reads none of farm A", table, why);
            }

            (await CountAsAppAsync(null, TwoFarms, table, "true")).Should().Be(aRows + bRows, "{0}: active on both farms", table);
        }

        // The February tables have no user read: no code reads them.
        (await CountAsAppAsync(null, Owner, "day_ledgers_legacy_financev2", "true")).Should().Be(0);

        // All six are FORCEd (the app role owns them on every real cluster).
        (await ForcedCountAsync()).Should().Be(Tables.Length);
    }

    [Fact]
    public async Task The_real_doors_still_write_and_read_under_the_wall()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A whole-farm bill split over the plots: the day ledger and its share lines in ONE SaveChanges (owned children).
        var bill = Guid.NewGuid();
        var ledger = Guid.NewGuid();
        await PushAppliedAsync(Owner, "add_cost_entry", "rls2-bill", new Dictionary<string, object?>
        {
            ["costEntryId"] = bill,
            ["farmId"] = FarmA,
            ["categoryId"] = "fertilizer",
            ["description"] = "सगळ्या शेतासाठी",
            ["amount"] = 1234.56m,
            ["currencyCode"] = "INR",
            ["entryDate"] = WorkDay,
            ["direction"] = "Expense",
        });
        await PushAppliedAsync(Owner, "allocate_global_expense", "rls2-split", new Dictionary<string, object?>
        {
            ["dayLedgerId"] = ledger,
            ["costEntryId"] = bill,
            ["allocationBasis"] = "equal",
            ["allocations"] = Array.Empty<object>(),
        });
        (await CountAsync("SELECT count(*) FROM ssf.day_ledger_allocations WHERE day_ledger_id = @l", ("l", ledger)))
            .Should().BeGreaterThan(0, "the share lines were written with their ledger");
        var (_, pulled) = await PullAsync(Owner);
        var share = ArrayOf(pulled, "dayLedgers").Single(l => l.GetProperty("id").GetGuid() == ledger);
        share.GetProperty("allocations").GetArrayLength().Should().BeGreaterThan(0, "the pull reads them back");

        // A task line on a saved log (the add_log_task door), read back by the pull.
        var task = Guid.NewGuid();
        await PushAppliedAsync(Owner, "add_log_task", "rls2-task", TaskPayload(task, OwnerLog));
        (_, pulled) = await PullAsync(Owner);
        ArrayOf(pulled, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == OwnerLog)
            .GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("id").GetGuid()).Should().Contain(task);

        // Plan generation, then a step added, moved and removed — the REST doors.
        var (status, body) = await CallAsync(HttpMethod.Post, "/shramsafal/plan/generate", Owner, new
        {
            cropCycleId = CycleA,
            templateName = "RLS-2 योजना",
            stage = "Vegetative",
            planStartDate = "2026-11-01",
            activities = new[] { new { activityName = "फवारणी", offsetDays = 0 }, new { activityName = "पाणी", offsetDays = 3 } },
        });
        ((int)status).Should().BeInRange(200, 299, body);
        var planned = await CountAsync("SELECT count(*) FROM ssf.planned_activities WHERE crop_cycle_id = @c", ("c", CycleA));
        planned.Should().BeGreaterThanOrEqualTo(3, "the seeded step and the two generated ones");

        var step = Guid.NewGuid();
        (status, body) = await CallAsync(HttpMethod.Post, "/shramsafal/planned-activities", Owner, new
        {
            cropCycleId = CycleA,
            farmId = FarmA,
            activityName = "खुरपणी",
            stage = "Vegetative",
            plannedDate = "2026-11-05",
            reason = "RLS-2",
            newActivityId = step,
        });
        ((int)status).Should().BeInRange(200, 299, body);
        (status, body) = await CallAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{step}/override", Owner, new
        {
            farmId = FarmA,
            newPlannedDate = "2026-11-07",
            reason = "RLS-2",
        });
        ((int)status).Should().BeInRange(200, 299, body);
        (await CountAsync("SELECT count(*) FROM ssf.planned_activities WHERE \"Id\" = @s AND planned_date = DATE '2026-11-07'", ("s", step)))
            .Should().Be(1, "the step moved");
        (status, body) = await CallAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{step}/remove", Owner, new
        {
            farmId = FarmA,
            reason = "RLS-2",
        });
        ((int)status).Should().BeInRange(200, 299, body);
        (await CountAsync("SELECT count(*) FROM ssf.planned_activities WHERE \"Id\" = @s AND removed_at_utc IS NOT NULL", ("s", step)))
            .Should().Be(1, "the step is removed (soft)");

        // The cron path with no request: the compliance sweeper's farm scope (RlsIdentityScope.RunAsFarmAsync on the scoped
        // context after elevation, ComplianceEvaluatorSweeper) reads the planned steps and task lines the evaluation needs,
        // and the evaluation itself runs. Elevation alone (no GUC) reads none: the wall, not a leak.
        await using (var scope = HostServices.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            var db = sp.GetRequiredService<ShramSafalDbContext>();
            var repository = sp.GetRequiredService<IShramSafalRepository>();
            var since = new DateOnly(2026, 9, 1);
            (await repository.GetPlannedActivitiesForFarmSinceAsync(new FarmId(FarmA), since)).Should().BeEmpty("no scope, no rows");
            var (steps, tasks) = await RlsIdentityScope.RunAsFarmAsync(db, FarmA, AccountA, actorUserId: null, async ct =>
                ((await repository.GetPlannedActivitiesForFarmSinceAsync(new FarmId(FarmA), since, ct)).Count,
                 (await repository.GetLogTasksForFarmSinceAsync(new FarmId(FarmA), since, ct)).Count));
            steps.Should().BeGreaterThan(0);
            tasks.Should().BeGreaterThan(0);
        }

        await using (var scope = HostServices.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            var handler = sp.GetRequiredService<IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>>();
            var result = await RlsIdentityScope.RunAsFarmAsync(sp.GetRequiredService<ShramSafalDbContext>(), FarmA, AccountA, null,
                ct => handler.HandleAsync(new EvaluateComplianceCommand(new FarmId(FarmA)), ct));
            result.IsSuccess.Should().BeTrue(result.Error?.ToString());
        }
    }

    [Fact]
    public async Task The_pull_money_summary_and_attention_board_answer_as_on_the_base_and_Down_Up_keep_every_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedEveryTableAsync();

        var walled = await AnswersAsync();
        walled.OwnerLedgers.Should().Contain(Ledger.ToString(), "not vacuous: the owner's pull carries the farm's day ledger");
        walled.OwnerPlanned.Should().Contain(Planned.ToString());
        walled.OwnerTasks.Should().Contain(OwnerTask.ToString());
        var rowsBefore = await RowCountsAsync();
        (await ForcedCountAsync()).Should().Be(Tables.Length);

        // The base schema (this lane's migration taken down): every answer is the same, and no row was lost.
        await MigrateSsfToAsync(BaseMigration);
        (await ForcedCountAsync()).Should().Be(0, "Down() takes every table back out of the row policy");
        (await RowCountsAsync()).Should().Equal(rowsBefore, "Down() keeps every row");
        // spec: plr-d10 lane SCH-OWN carry-in F204 (test only) - on the base schema the PULL cannot answer at all: it reads tables that later
        // migrations created (e.g. ssf.input_identity_assertions), so it fails there with or without this lane's migration. The three
        // reads that exist on the base (the money summary and the two attention boards) are compared with the walled answers; the pulls are
        // compared on the head schema only - before the Down and after each Up.
        var onBase = await BaseAnswersAsync();
        (onBase.OwnerSummary, onBase.OwnerBoard, onBase.MemberBoard).Should().Be(
            (walled.OwnerSummary, walled.OwnerBoard, walled.MemberBoard),
            "the wall changes no answer for the owner or a member (P11)");

        // Up again on a database holding rows in every table: nothing lost, all walled again; and once more round.
        await MigrateSsfToAsync(null);
        (await RowCountsAsync()).Should().Equal(rowsBefore, "Up() on a database with rows keeps every row");
        (await ForcedCountAsync()).Should().Be(Tables.Length);
        (await AnswersAsync()).Should().BeEquivalentTo(walled);
        await MigrateSsfToAsync(BaseMigration);
        await MigrateSsfToAsync(null);
        (await RowCountsAsync()).Should().Equal(rowsBefore);
        (await ForcedCountAsync()).Should().Be(Tables.Length);
    }

    // ── What the doors answer, for the P11 comparison ───────────────────────────────────────────

    private sealed record Answers(
        string OwnerLedgers, string OwnerPlanned, string OwnerTasks,
        string MemberLedgers, string MemberPlanned, string MemberTasks,
        string OwnerSummary, string OwnerBoard, string MemberBoard);

    /// <summary>F204: the reads that exist on the base schema (the money summary and the attention boards), no pull.</summary>
    private sealed record BaseAnswers(string OwnerSummary, string OwnerBoard, string MemberBoard);

    private async Task<BaseAnswers> BaseAnswersAsync() => new(
        await BodyAsync(Owner, "/shramsafal/finance/summary?groupBy=plot&fromDate=2026-01-01&toDate=2026-12-31"),
        await BodyAsync(Owner, "/shramsafal/attention?asOf=2026-10-31T06:00:00Z"),
        await BodyAsync(Mukadam, "/shramsafal/attention?asOf=2026-10-31T06:00:00Z"));

    private async Task<Answers> AnswersAsync()
    {
        var (_, owner) = await PullAsync(Owner);
        var (_, member) = await PullAsync(Mukadam);
        return new Answers(
            Ledgers(owner), Ids(owner, "plannedActivities"), Tasks(owner),
            Ledgers(member), Ids(member, "plannedActivities"), Tasks(member),
            await BodyAsync(Owner, "/shramsafal/finance/summary?groupBy=plot&fromDate=2026-01-01&toDate=2026-12-31"),
            await BodyAsync(Owner, "/shramsafal/attention?asOf=2026-10-31T06:00:00Z"),
            await BodyAsync(Mukadam, "/shramsafal/attention?asOf=2026-10-31T06:00:00Z"));
    }

    private static string Ids(JsonElement root, string name) =>
        string.Join(",", IdsOf(root, name).Select(id => id.ToString()).OrderBy(id => id, StringComparer.Ordinal));

    private static string Ledgers(JsonElement root) =>
        string.Join(";", ArrayOf(root, "dayLedgers")
            .Select(l => $"{l.GetProperty("id").GetGuid()}:{l.GetProperty("allocations").GetRawText()}")
            .OrderBy(s => s, StringComparer.Ordinal));

    private static string Tasks(JsonElement root) =>
        string.Join(",", ArrayOf(root, "dailyLogs")
            .SelectMany(l => l.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("id").GetGuid().ToString()))
            .OrderBy(id => id, StringComparer.Ordinal));

    private async Task<string> BodyAsync(Guid user, string url)
    {
        var (status, body) = await CallAsync(HttpMethod.Get, url, user, null);
        status.Should().Be(HttpStatusCode.OK, $"{url}: {body}");
        // An attention card's id is minted fresh on every call (GetAttentionBoardHandler: Guid.NewGuid()); every other
        // byte of the answer is compared.
        return System.Text.RegularExpressions.Regex.Replace(body, "\"cardId\":\"[0-9a-fA-F-]{36}\"", "\"cardId\":\"*\"");
    }

    private async Task<(HttpStatusCode Status, string Body)> CallAsync(HttpMethod method, string url, Guid user, object? body)
    {
        using var response = await SendAsync(method, url, user, body, "1.0.18");
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[RLS-2] {user} {method} {url} -> {(int)response.StatusCode} {(text.Length > 300 ? text[..300] + "…" : text)}");
        return (response.StatusCode, text);
    }

    // ── Seeds: a row of every table on farm A (and of the four live tables on farm B), and the extra seats ────────

    private async Task SeedEveryTableAsync()
    {
        await PushAppliedAsync(Owner, "add_log_task", "rls2-seed-task", TaskPayload(OwnerTask, OwnerLog));
        await PushAppliedAsync(OwnerB, "add_log_task", "rls2-seed-task-b", TaskPayload(FarmBTask, FarmBLog));
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledger_allocations (id, plot_id, allocated_amount, currency_code, allocated_at_utc, day_ledger_id)
            VALUES (@alloc, @plotA, 9876.54, 'INR', NOW(), @ledger);
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                         created_at_utc, modified_at_utc)
            VALUES (@ledgerB, @farmB, @costB, DATE '2026-10-30', 'equal', @ownerB, NOW(), NOW());
            INSERT INTO ssf.day_ledger_allocations (id, plot_id, allocated_amount, currency_code, allocated_at_utc, day_ledger_id)
            VALUES (gen_random_uuid(), @plotB, 5555.67, 'INR', NOW(), @ledgerB);
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (@plannedB, @cycleB, 'पाणी', 'Vegetative', DATE '2026-10-01', NOW(), NOW());
            INSERT INTO ssf.day_ledgers_legacy_financev2 (id, farm_id, date_key, allocation_strategy, total_global_cost, created_at_utc)
            VALUES (@legacy, @farmA, DATE '2026-02-20', 'equal', 100.00, NOW());
            INSERT INTO ssf.day_ledger_plot_allocations_legacy_financev2 (day_ledger_id, plot_id, crop_cycle_id, allocation_percent, allocated_amount)
            VALUES (@legacy, @plotA, @cycleA, 100.00, 100.00);
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@waiting, '6000000901', 'प्रतीक्षा', 'x', NOW(), NOW(), TRUE, 0, 'mr'),
                   (@removed, '6000000902', 'काढलेला', 'x', NOW(), NOW(), TRUE, 0, 'mr'),
                   (@two, '6000000903', 'दोन-शेत', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmA, @waiting, 'Worker', NOW(), NOW(), @accountA, 2, NULL, FALSE),
                   (gen_random_uuid(), @farmA, @removed, 'Worker', NOW(), NOW(), @accountA, 5, NULL, FALSE),
                   (gen_random_uuid(), @farmA, @two, 'Worker', NOW(), NOW(), @accountA, 3, NULL, FALSE),
                   (gen_random_uuid(), @farmB, @two, 'Worker', NOW(), NOW(), @accountB, 3, NULL, FALSE);
            """,
            ("alloc", Allocation), ("plotA", PlotA), ("ledger", Ledger), ("ledgerB", LedgerB), ("farmB", FarmB), ("costB", CostB),
            ("ownerB", OwnerB), ("plotB", PlotB), ("plannedB", PlannedB), ("cycleB", CycleB), ("legacy", LegacyLedger),
            ("farmA", FarmA), ("cycleA", CycleA), ("waiting", Waiting), ("removed", Removed), ("two", TwoFarms),
            ("accountA", AccountA), ("accountB", AccountB));
    }

    private static Dictionary<string, object?> TaskPayload(Guid task, Guid log) => new()
    {
        ["logTaskId"] = task,
        ["dailyLogId"] = log,
        ["activityType"] = "फवारणी",
        ["notes"] = "RLS-2",
        ["occurredAtUtc"] = "2026-10-30T06:00:00Z",
    };

    // ── Per-table SQL ───────────────────────────────────────────────────────────────────────────

    private static string FarmAPredicate(string table) => FarmPredicate(table, FarmA);

    private static string FarmBPredicate(string table) => FarmPredicate(table, FarmB);

    private static string FarmPredicate(string table, Guid farm) => table switch
    {
        "day_ledgers" or "day_ledgers_legacy_financev2" => $"farm_id = '{farm}'",
        "day_ledger_allocations" => $"day_ledger_id IN (SELECT \"Id\" FROM ssf.day_ledgers WHERE farm_id = '{farm}')",
        "log_tasks" => $"daily_log_id IN (SELECT \"Id\" FROM ssf.daily_logs WHERE farm_id = '{farm}')",
        "planned_activities" => $"crop_cycle_id IN (SELECT \"Id\" FROM ssf.crop_cycles WHERE farm_id = '{farm}')",
        "day_ledger_plot_allocations_legacy_financev2" =>
            $"day_ledger_id IN (SELECT id FROM ssf.day_ledgers_legacy_financev2 WHERE farm_id = '{farm}')",
        _ => throw new ArgumentOutOfRangeException(nameof(table), table, null),
    };

    private static string InsertFarmARow(string table) => table switch
    {
        "day_ledgers" => $"""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                         created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', gen_random_uuid(), DATE '2026-10-31', 'equal', '{Owner}', NOW(), NOW())
            """,
        "day_ledger_allocations" => $"""
            INSERT INTO ssf.day_ledger_allocations (id, plot_id, allocated_amount, currency_code, allocated_at_utc, day_ledger_id)
            VALUES (gen_random_uuid(), '{PlotA}', 1.00, 'INR', NOW(), '{Ledger}')
            """,
        "log_tasks" => $"""
            INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, occurred_at_utc)
            VALUES (gen_random_uuid(), '{OwnerLog}', 'फवारणी', NOW())
            """,
        "planned_activities" => $"""
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), '{CycleA}', 'फवारणी', 'Vegetative', DATE '2026-10-31', NOW(), NOW())
            """,
        "day_ledgers_legacy_financev2" => $"""
            INSERT INTO ssf.day_ledgers_legacy_financev2 (id, farm_id, date_key, allocation_strategy, total_global_cost, created_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', DATE '2026-02-21', 'equal', 1.00, NOW())
            """,
        "day_ledger_plot_allocations_legacy_financev2" => $"""
            INSERT INTO ssf.day_ledger_plot_allocations_legacy_financev2 (day_ledger_id, plot_id, crop_cycle_id, allocation_percent, allocated_amount)
            VALUES ('{LegacyLedger}', '{PlotA}', '{CycleA}', 1.00, 1.00)
            """,
        _ => throw new ArgumentOutOfRangeException(nameof(table), table, null),
    };

    private static string UpdateFarmARows(string table) => table switch
    {
        "day_ledgers" => $"UPDATE ssf.day_ledgers SET allocation_basis = 'moved' WHERE {FarmAPredicate(table)}",
        "day_ledger_allocations" => $"UPDATE ssf.day_ledger_allocations SET allocated_amount = 0 WHERE {FarmAPredicate(table)}",
        "log_tasks" => $"UPDATE ssf.log_tasks SET notes = 'moved' WHERE {FarmAPredicate(table)}",
        "planned_activities" => $"UPDATE ssf.planned_activities SET activity_name = 'moved' WHERE {FarmAPredicate(table)}",
        "day_ledgers_legacy_financev2" => $"UPDATE ssf.day_ledgers_legacy_financev2 SET total_global_cost = 0 WHERE {FarmAPredicate(table)}",
        "day_ledger_plot_allocations_legacy_financev2" =>
            $"UPDATE ssf.day_ledger_plot_allocations_legacy_financev2 SET allocated_amount = 0 WHERE {FarmAPredicate(table)}",
        _ => throw new ArgumentOutOfRangeException(nameof(table), table, null),
    };

    // ── As agrisync_app, in a transaction that is always rolled back ─────────────────────────────

    private async Task<long> CountAsAppAsync(Guid? farm, Guid? user, string table, string predicate)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM ssf.{table} WHERE {predicate}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> ExecAsAppAsync(Guid? farm, Guid? user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var affected = await cmd.ExecuteNonQueryAsync();
        await tx.RollbackAsync();
        return affected;
    }

    /// <summary>The scope exactly as the doors set it: the farm (or the all-zeros sentinel) and the user (or empty).</summary>
    private static async Task SetScopeAsync(NpgsqlConnection db, Guid? farm, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @farm, true), set_config('agrisync.user_id', @user, true)";
        cmd.Parameters.AddWithValue("farm", farm?.ToString() ?? Guid.Empty.ToString());
        cmd.Parameters.AddWithValue("user", user?.ToString() ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }

    // ── As superuser ────────────────────────────────────────────────────────────────────────────

    private async Task<long> CountAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<long[]> RowCountsAsync()
    {
        var counts = new List<long>();
        foreach (var table in Tables)
        {
            counts.Add(await CountAsync($"SELECT count(*) FROM ssf.{table}"));
        }

        return counts.ToArray();
    }

    private Task<long> ForcedCountAsync() => CountAsync($"""
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf' AND c.relname IN ({string.Join(", ", Tables.Select(t => $"'{t}'"))})
          AND c.relrowsecurity AND c.relforcerowsecurity
          AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
        """);

    private async Task MigrateSsfToAsync(string? target)
    {
        // The same options IntegrationMigrationChain migrated this database with (its history table included).
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options;
        await using var ssf = new ShramSafalDbContext(options);
        await ssf.Database.GetService<IMigrator>().MigrateAsync(target);
    }
}
