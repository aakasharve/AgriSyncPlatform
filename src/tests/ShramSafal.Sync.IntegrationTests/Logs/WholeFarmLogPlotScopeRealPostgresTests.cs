// spec: plr-d10 SEC-1 server fixes (D-184), finding F03 (server half) - a seat limited to chosen plots cannot write a record
// that belongs to the WHOLE farm, neither by creating one (scope Farm) nor by moving his plot's record onto the farm
// (wholeFarm). Proved on a real Postgres as agrisync_app (E3 first) through the real host, routes and push path.
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Logs;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// SEC-1 F03 (server half). The phone already hides the "whole farm" choice from a seat limited to chosen plots (sec-phone-1);
/// the server must refuse it too, for a phone that does not, an old phone, or anything that is not a phone:
/// <list type="bullet">
/// <item><c>create_daily_log</c> with scope <c>Farm</c> (REST and sync reach the same handler) and <c>move_daily_log</c> with
/// <c>wholeFarm</c> are refused for a chosen-plots seat with <c>ShramSafal.PlotScope.Forbidden</c> - the code the phone already
/// parks visibly - and NOTHING is written: no record, no move, no ledger row;</item>
/// <item>the same seat still creates and moves records on HIS OWN plots (the refusal is the farm-wide choice, not him);</item>
/// <item>the primary owner, a seat on every plot and an own-work seat are not refused (their answers are unchanged);</item>
/// <item>a record that names no plot by design (a shared, unallocated bill) is NOT refused for him: the old plot question, which
/// answers "no plot named - no refusal" for about 20 doors, is untouched.</item>
/// </list>
///
/// <para>Every fact starts from the same seeded farm as the sibling plot-scope suites (<see cref="RoleScopedFarm"/>); the owner
/// chooses the seat's plots through the real plot-scope route. Written from the SEC-1 test spec alone; the handlers' fix was
/// not read.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class WholeFarmLogPlotScopeRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid P2 = Guid.Parse("5ec10002-0000-4000-8000-0000000000c2");
    private static readonly Guid P4 = Guid.Parse("5ec10002-0000-4000-8000-0000000000c4");
    private static readonly Guid CycleP2 = Guid.Parse("5ec10002-0000-4000-8000-0000000000d2");
    private static readonly Guid CycleP4 = Guid.Parse("5ec10002-0000-4000-8000-0000000000d4");
    private static readonly Guid OwnWorker = Guid.Parse("5ec10002-0000-4000-8000-000000000018");

    private const string Forbidden = "ShramSafal.PlotScope.Forbidden";

    // ── create: scope Farm ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_chosen_plots_seat_cannot_create_a_whole_farm_log_but_his_own_plots_and_every_other_seat_are_unchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        await SetPlotScopeAsync(OwnWorker, "OwnWork");

        // Sync: refused with the plot's own code, and nothing is written.
        var refusedLog = Guid.NewGuid();
        var refused = await PushAsync(Mukadam, "create_daily_log", "sec1-farm-chosen", FarmLog(refusedLog, Mukadam));
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(Forbidden, "a seat on chosen plots may not write the whole farm's record");
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE \"Id\" = @id", refusedLog)).Should().Be(0, "nothing is written");

        // Control: the same seat, the same push path, a record on HIS plot / HIS plots - applied.
        await PushAppliedAsync(Mukadam, "create_daily_log", "sec1-own-plot", PlotLog(Guid.NewGuid(), Mukadam, P2, CycleP2));
        var multi = FarmLog(Guid.NewGuid(), Mukadam);
        multi["scope"] = "MultiPlot";
        multi["plotIds"] = new[] { P2, P4 };
        await PushAppliedAsync(Mukadam, "create_daily_log", "sec1-own-two-plots", multi);

        // Asked again (a new request id): refused again, and still nothing is written.
        var again = await PushAsync(Mukadam, "create_daily_log", "sec1-farm-chosen-again", FarmLog(refusedLog, Mukadam));
        again.ErrorCode.Should().Be(Forbidden);
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE \"Id\" = @id", refusedLog)).Should().Be(0);

        // Everyone else: scope Farm is applied exactly as before.
        await PushAppliedAsync(Owner, "create_daily_log", "sec1-farm-owner", FarmLog(Guid.NewGuid(), Owner));
        await PushAppliedAsync(CoOwner, "create_daily_log", "sec1-farm-all-plots", FarmLog(Guid.NewGuid(), CoOwner));
        await PushAppliedAsync(OwnWorker, "create_daily_log", "sec1-farm-own-work", FarmLog(Guid.NewGuid(), OwnWorker));

        // A record that names no plot by design is not the whole-farm question: his own shared bill is still kept (D-28).
        await SetAuthoritiesAsync(FarmA, Mukadam, ShramSafal.Domain.Farms.FarmAuthority.SeeMoney, ShramSafal.Domain.Farms.FarmAuthority.ReviewMoney);
        var sharedBill = CostPayload(Guid.NewGuid(), FarmA, PlotA, CycleA, 1111.11m);
        sharedBill.Remove("plotId");
        sharedBill.Remove("cropCycleId");
        var shared = await PushAsync(Mukadam, "add_cost_entry", "sec1-shared-bill", sharedBill);
        shared.ErrorCode.Should().NotBe(Forbidden, "a bill that names no plot is not refused for a chosen-plots seat (the old plot question is untouched)");
        shared.Status.Should().Be("applied", "{0}: {1}", shared.ErrorCode, shared.ErrorMessage);
    }

    [Fact]
    public async Task The_REST_door_refuses_a_chosen_plots_seat_the_whole_farm_log_too_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);

        // POST /logs resolves the pipeline-wrapped handler; the route cannot be opened in this host, so the handler is asked
        // exactly as the route asks it (the caller's farm scope opened first). The scope runs in a transaction that is rolled
        // back, so the proof of "nothing written" is the refusal itself plus the count afterwards.
        var refusedLog = Guid.NewGuid();
        var refusal = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp
            .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>()
            .HandleAsync(WholeFarmCommand(Mukadam, refusedLog, "sec1-rest-farm-mukadam"))));
        refusal.Should().Be(Forbidden);
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE \"Id\" = @id", refusedLog)).Should().Be(0);

        // Controls: his own plot through the same door works; the owner's whole-farm log works.
        var own = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp
            .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>()
            .HandleAsync(WholeFarmCommand(Mukadam, Guid.NewGuid(), "sec1-rest-own-plot") with
            {
                Scope = DailyLogScope.Plot,
                PlotId = P2,
                CropCycleId = CycleP2,
            })));
        own.Should().BeNull("the same door on HIS plot works for him");

        var owner = await AsFarmMemberAsync(FarmA, Owner, async sp => Code(await sp
            .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>()
            .HandleAsync(WholeFarmCommand(Owner, Guid.NewGuid(), "sec1-rest-farm-owner"))));
        owner.Should().BeNull("the owner's whole-farm log is unchanged");
    }

    // ── move: wholeFarm ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_chosen_plots_seat_cannot_move_a_record_onto_the_whole_farm_but_can_move_it_between_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        await SetPlotScopeAsync(OwnWorker, "OwnWork");

        // His record on P2.
        var hisLog = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "create_daily_log", "sec1-move-create", PlotLog(hisLog, Mukadam, P2, CycleP2));
        (await ScalarTextAsync("SELECT plot_ids::text FROM ssf.daily_logs WHERE \"Id\" = @id", hisLog)).Should().Be($"{{{P2}}}");

        // Onto the whole farm: refused with the plot's code; the record stays where it was and no move is written.
        var refused = await PushAsync(Mukadam, "move_daily_log", "sec1-move-farm", MovePayload(hisLog, wholeFarm: true));
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(Forbidden, "his plot's record is not his to put on the whole farm");
        (await ScalarTextAsync("SELECT plot_ids::text FROM ssf.daily_logs WHERE \"Id\" = @id", hisLog))
            .Should().Be($"{{{P2}}}", "the record did not move");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'LogMoved'", hisLog))
            .Should().Be(0, "a refused move leaves no move in the ledger");

        // Control: from P2 to his other plot P4 - applied.
        await PushAppliedAsync(Mukadam, "move_daily_log", "sec1-move-own", MovePayload(hisLog, plots: [P4]));
        (await ScalarTextAsync("SELECT plot_ids::text FROM ssf.daily_logs WHERE \"Id\" = @id", hisLog))
            .Should().Be($"{{{P4}}}", "his own-plot move still applies");

        // The owner, a seat on every plot and an own-work seat: moving their own record onto the farm is unchanged.
        foreach (var (who, name) in new[] { (Owner, "owner"), (CoOwner, "all-plots"), (OwnWorker, "own-work") })
        {
            var log = Guid.NewGuid();
            await PushAppliedAsync(who, "create_daily_log", $"sec1-move-{name}-create", PlotLog(log, who, PlotA, CycleA));
            await PushAppliedAsync(who, "move_daily_log", $"sec1-move-{name}-farm", MovePayload(log, wholeFarm: true));
            (await ScalarTextAsync("SELECT plot_ids::text FROM ssf.daily_logs WHERE \"Id\" = @id", log))
                .Should().Be("{}", $"the {name} seat's whole-farm move still applies");
        }
    }

    // ── seed ─────────────────────────────────────────────────────────────────────────────

    private async Task SeedAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, 'प्लॉट-दोन', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, 'प्लॉट-चार', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleP2, @farm, @p2, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                   (@cycleP4, @farm, @p4, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@own, '9300000288', 'स्वतःचे-काम-दत्ता', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @own, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            """,
            ("p2", P2), ("p4", P4), ("farm", FarmA), ("cycleP2", CycleP2), ("cycleP4", CycleP4), ("own", OwnWorker), ("account", AccountA));
    }

    private async Task SetPlotScopeAsync(Guid person, string scope, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = scope, plotIds = plots.Length == 0 ? null : plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    // ── payloads ─────────────────────────────────────────────────────────────────────────

    /// <summary>What Sathi understood for a record (a move needs it: the record's details are held by the server).</summary>
    private static object Content(string product) =>
        new { schema = 1, inputs = new object[] { new { id = "in-1", productName = product, quantity = 1, unit = "l" } } };

    /// <summary>A record of the WHOLE farm (संपूर्ण शेत): scope Farm, no plot, no season.</summary>
    private static Dictionary<string, object?> FarmLog(Guid id, Guid operatorUser) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["scope"] = "Farm",
        ["operatorUserId"] = operatorUser,
        ["logDate"] = WorkDay,
        ["content"] = Content("संपूर्ण-शेताचे-काम"),
    };

    /// <summary>A record on one plot, with the plot's season.</summary>
    private static Dictionary<string, object?> PlotLog(Guid id, Guid operatorUser, Guid plot, Guid cycle) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["scope"] = "Plot",
        ["plotIds"] = new[] { plot },
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["operatorUserId"] = operatorUser,
        ["logDate"] = WorkDay,
        ["content"] = Content("प्लॉटचे-काम"),
    };

    private static Dictionary<string, object?> MovePayload(Guid log, Guid[]? plots = null, bool wholeFarm = false)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        if (plots is not null) payload["newPlotIds"] = plots;
        if (wholeFarm) payload["wholeFarm"] = true;
        return payload;
    }

    /// <summary>The REST command for a whole-farm log by <paramref name="user"/> (what POST /logs hands the handler).</summary>
    private static CreateDailyLogCommand WholeFarmCommand(Guid user, Guid logId, string clientRequestId) =>
        new(
            FarmId: FarmA,
            PlotId: null,
            CropCycleId: null,
            RequestedByUserId: user,
            OperatorUserId: user,
            LogDate: DateOnly.Parse(WorkDay),
            Location: null,
            DeviceId: "device-sec1",
            ClientRequestId: clientRequestId,
            DailyLogId: logId,
            Scope: DailyLogScope.Farm);

    // ── reads ────────────────────────────────────────────────────────────────────────────

    private static string? Code<T>(AgriSync.BuildingBlocks.Results.Result<T> result) => result.IsSuccess ? null : result.Error.Code;

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(sql, db);
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<string?> ScalarTextAsync(string sql, Guid id)
    {
        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(sql, db);
        cmd.Parameters.AddWithValue("id", id);
        return (await cmd.ExecuteScalarAsync())?.ToString();
    }
}
