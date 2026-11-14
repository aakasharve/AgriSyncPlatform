// lane 2b (MU farm-relationships design §2, §11.1, §11.2; founder D-22 / D-26 / D-44) — labels grant
// nothing; every power is an authority of the open farm's SEAT, each permanent or until an instant.
// Proved against a real Postgres as agrisync_app (doctrine E3: asserted not superuser / BYPASSRLS
// first), through the production DI graph and routes, and through the gate the routes ask.
using System.Threading;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmAuthoritiesRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("2b000001-0000-0000-0000-0000000000f1");
    private static readonly Guid FarmB = Guid.Parse("2b000001-0000-0000-0000-0000000000f2");
    private static readonly Guid AccountA = Guid.Parse("2b000001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("2b000001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("2b000001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("2b000001-0000-0000-0000-0000000000a2");
    private static readonly Guid Holder = Guid.Parse("2b000001-0000-0000-0000-0000000000b1");
    private static readonly Guid HolderOnB = Guid.Parse("2b000001-0000-0000-0000-0000000000b2");
    private static readonly Guid CoOwnerBare = Guid.Parse("2b000001-0000-0000-0000-0000000000b3");
    private static readonly Guid CoOwnerAll = Guid.Parse("2b000001-0000-0000-0000-0000000000b4");
    private static readonly Guid Joiner = Guid.Parse("2b000001-0000-0000-0000-0000000000b5");
    private static readonly Guid GlobalOnly = Guid.Parse("2b000001-0000-0000-0000-0000000000b6");
    private static readonly Guid PlotA = Guid.Parse("2b000001-0000-0000-0000-0000000000d1");
    private static readonly Guid CycleA = Guid.Parse("2b000001-0000-0000-0000-0000000000d2");
    private static readonly Guid CostA = Guid.Parse("2b000001-0000-0000-0000-0000000000d3");

    // lane BILL-1 fix round 1 (review H1) — a कामगार-labelled seat reads only its OWN money (MU-3 §11.7), so its review-money
    // probe corrects a cost it entered itself; another person's cost is not there for it (CostEntryNotFound).
    private static readonly Guid HolderCost = Guid.Parse("2b000001-0000-0000-0000-0000000000d4");

    private const int AllBits = 1 | 2 | 8 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192; // 2048 = SeeAllTasks (lane L8c-1), 4096 = SeeCompare (lane CMP-D1), 8192 = ManageReminders (lane REM-1)

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_lane2b_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "GRANT USAGE ON SCHEMA public TO agrisync_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");
            await SeedFarmAsync(raw, FarmA, "Probe 2b Farm A", OwnerA, AccountA, "B2K2QA");
            await SeedFarmAsync(raw, FarmB, "Probe 2b Farm B", OwnerB, AccountB, "B2K2QB");
            await SeedSeatAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", 3);
            await SeedSeatAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, Holder, "Worker", 3);
            await SeedSeatAsync(raw, FarmB, AccountB, HolderOnB, "Worker", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, CoOwnerBare, "SecondaryOwner", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, CoOwnerAll, "SecondaryOwner", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, Joiner, "Worker", 2);
            await ExecAsync(raw,
                "UPDATE ssf.farm_memberships SET permissions = @all, can_manage_labour_records = TRUE WHERE user_id IN (@co, @hb)",
                ("all", AllBits), ("co", CoOwnerAll), ("hb", HolderOnB));
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farm, 'Probe 2b Plot', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
                INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                              created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
                VALUES (@cost, @farm, @plot, 'probe cost', 1000, 'INR', CURRENT_DATE, @owner, NOW(), NOW(), 'manual', 'unknown', 'unknown', 'other'),
                       (@holderCost, @farm, @plot, 'probe cost of the holder', 1000, 'INR', CURRENT_DATE, @holder, NOW(), NOW(), 'manual', 'unknown', 'unknown', 'other');
                """,
                ("plot", PlotA), ("farm", FarmA), ("cycle", CycleA), ("start", new DateTime(2026, 1, 1)),
                ("cost", CostA), ("owner", OwnerA), ("holderCost", HolderCost), ("holder", Holder));
        }

        _app = await BuildHostAsync(_appConn);
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await ExecAsync(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch (NpgsqlException ex)
        {
            // Best-effort teardown of OUR scratch database only; a leaked one is harmless.
            output.WriteLine($"[teardown] scratch DB not dropped: {ex.GetType().Name}");
        }
    }

    // ── E3 ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_host_connects_as_a_role_that_is_neither_superuser_nor_bypassrls()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    // ── Per authority, the gate against real rows: with, without, after its end, another farm ──

    public static IEnumerable<object[]> EveryAuthority() => FarmAuthorities.All.Select(a => new object[] { a });

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public async Task Each_authority_holds_with_it_and_not_without_it_after_its_end_or_on_another_farm(FarmAuthority authority)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var now = DateTime.UtcNow;

        // lane CMP-D1 (founder D-81): a Worker seat can never hold "तुलना पाहणे", so its two holders are मुकादम seats for that
        // one authority (its refusal on a Worker seat is proved in SeeCompareAuthorityRealPostgresTests); lane REM-1: the same for ManageReminders, which
        // a Worker label never holds (ReminderSeatsRealPostgresTests).
        if (authority is FarmAuthority.SeeCompare or FarmAuthority.ManageReminders)
        {
            await ExecSuperAsync("UPDATE ssf.farm_memberships SET role = 'Mukadam' WHERE user_id IN (@a, @b)", ("a", Holder), ("b", HolderOnB));
        }

        await StoreOnlyAsync(Holder, authority, end: null);
        (await GateAsync(FarmA, Holder, authority, now)).Should().BeTrue($"{authority}: stored, permanent");

        await StoreOnlyAsync(Holder, authority, end: now.AddDays(2));
        (await GateAsync(FarmA, Holder, authority, now)).Should().BeTrue($"{authority}: stored, not yet ended");
        (await GateAsync(FarmA, Holder, authority, now.AddDays(3))).Should().BeFalse($"{authority}: after its end");

        await StoreNothingAsync(Holder);
        (await GateAsync(FarmA, Holder, authority, now)).Should().BeFalse($"{authority}: not stored");

        // E4 both ways: HolderOnB holds everything on farm B — nothing of it on farm A, and Holder's
        // seat on A opens nothing on B.
        (await GateAsync(FarmB, HolderOnB, authority, now)).Should().BeTrue($"{authority}: control on his own farm");
        (await GateAsync(FarmA, HolderOnB, authority, now)).Should().BeFalse($"{authority}: another farm's seat");
        await StoreOnlyAsync(Holder, authority, end: null);
        (await GateAsync(FarmB, Holder, authority, now)).Should().BeFalse($"{authority}: a seat on A opens nothing on B");
        output.WriteLine($"[EVIDENCE] {authority}: with=true, ended=false, without=false, otherFarm=false");
    }

    [Fact]
    public async Task A_co_owner_label_with_no_authorities_holds_only_what_every_member_holds()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var authority in FarmAuthorities.All)
        {
            (await GateAsync(FarmA, CoOwnerBare, authority, DateTime.UtcNow)).Should().BeFalse($"a सहमालक label alone holds no {authority}");
        }

        // Routes: edit farm setup, take हजेरी, review money, confirm records — every one refused.
        (await CreatePlotAsync(CoOwnerBare)).Should().Be(HttpStatusCode.Forbidden);
        (await CreateFieldOperatorAsync(CoOwnerBare)).Should().Be(HttpStatusCode.Forbidden);
        (await CorrectCostAsync(CoOwnerBare)).Should().Be(HttpStatusCode.Forbidden);
        var log = await CreateLogAsync(OwnerA);
        (await VerifyAsync(CoOwnerBare, log)).Should().Be(HttpStatusCode.Forbidden);

        // What every Active member may do: report a purchase (D-28) — his own work.
        var purchase = await PushPurchaseAsync(CoOwnerBare, "co-owner-purchase");
        purchase.Status.Should().Be("applied", purchase.ErrorCode);
    }

    [Fact]
    public async Task Routes_follow_the_authority_with_without_after_its_end_and_never_from_another_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await CreateLogAsync(OwnerA);

        // edit farm setup → POST plots
        await StoreOnlyAsync(Holder, FarmAuthority.EditFarmSetup, end: null);
        (await CreatePlotAsync(Holder)).Should().Be(HttpStatusCode.OK);
        await StoreOnlyAsync(Holder, FarmAuthority.EditFarmSetup, end: DateTime.UtcNow.AddSeconds(-1));
        (await CreatePlotAsync(Holder)).Should().Be(HttpStatusCode.Forbidden, "ended");
        (await CreatePlotAsync(HolderOnB)).Should().NotBe(HttpStatusCode.OK, "another farm's seat");

        // take हजेरी → POST field operators
        await StoreOnlyAsync(Holder, FarmAuthority.TakeAttendance, end: null);
        (await CreateFieldOperatorAsync(Holder)).Should().Be(HttpStatusCode.Created);
        await StoreOnlyAsync(Holder, FarmAuthority.TakeAttendance, end: DateTime.UtcNow.AddSeconds(-1));
        (await CreateFieldOperatorAsync(Holder)).Should().Be(HttpStatusCode.Forbidden, "ended");
        (await CreateFieldOperatorAsync(HolderOnB)).Should().NotBe(HttpStatusCode.Created, "another farm's seat");

        // review money → POST cost correction (needs see money too)
        await StoreOnlyAsync(Holder, FarmAuthority.ReviewMoney, end: null);
        (await CorrectCostAsync(Holder, HolderCost)).Should().Be(HttpStatusCode.OK);
        (await CorrectCostAsync(Holder)).Should().Be(HttpStatusCode.BadRequest, "another person's cost is not there for a कामगार seat (not found)");
        await StoreOnlyAsync(Holder, FarmAuthority.ReviewMoney, end: DateTime.UtcNow.AddSeconds(-1));
        (await CorrectCostAsync(Holder, HolderCost)).Should().Be(HttpStatusCode.Forbidden, "ended");
        await ExecSuperAsync("UPDATE ssf.farm_memberships SET permissions = 4, authority_expires_at = NULL WHERE user_id = @u", ("u", Holder));
        (await CorrectCostAsync(Holder, HolderCost)).Should().Be(HttpStatusCode.Forbidden, "review money without see money means nothing");
        (await CorrectCostAsync(HolderOnB)).Should().NotBe(HttpStatusCode.OK, "another farm's seat");

        // confirm records → POST verify (Verified counts; without it the door refuses)
        await StoreOnlyAsync(Holder, FarmAuthority.ConfirmRecords, end: null);
        (await VerifyAsync(Holder, log)).Should().Be(HttpStatusCode.OK);
        (await LogStatusAsync(log)).Should().Be("Verified");
        var second = await CreateLogAsync(OwnerA);
        await StoreNothingAsync(Holder);
        (await VerifyAsync(Holder, second)).Should().Be(HttpStatusCode.Forbidden, "not stored");
        (await VerifyAsync(HolderOnB, second)).Should().NotBe(HttpStatusCode.OK, "another farm's seat");

        // take हजेरी alone does NOT confirm (D-26 "recording attendance does not mean approving it"):
        // the door admits him and his tap is kept as a mark — the status does not move.
        await StoreOnlyAsync(Holder, FarmAuthority.TakeAttendance, end: null);
        (await VerifyAsync(Holder, second)).Should().Be(HttpStatusCode.OK);
        (await LogStatusAsync(second)).Should().NotBe("Verified");
        (await AuditCountAsync(FarmA, "ConfirmRequestNotCounted")).Should().BeGreaterThan(0);
    }

    // ── Primary account holder only ────────────────────────────────────────────────────────

    [Fact]
    public async Task Primary_owner_only_actions_are_refused_for_a_co_owner_holding_every_authority()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var authority in FarmAuthorities.All)
        {
            (await GateAsync(FarmA, CoOwnerAll, authority, DateTime.UtcNow)).Should().BeTrue($"arrange: holds {authority}");
        }

        var attempts = new (HttpMethod Method, string Url, object? Body)[]
        {
            (HttpMethod.Post, $"/shramsafal/farms/{FarmA}/invite-qr", null),
            (HttpMethod.Post, $"/shramsafal/farms/{FarmA}/invite-qr/rotate", null),
            (HttpMethod.Get, $"/shramsafal/farms/{FarmA}/labour-permissions", null),
            (HttpMethod.Put, $"/shramsafal/farms/{FarmA}/labour-permissions/{Holder}", new { canManageLabourRecords = true }),
            (HttpMethod.Post, $"/shramsafal/farms/{FarmA}/memberships/{Joiner}/approve", new { role = "Worker" }),
            (HttpMethod.Post, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/suspend", new { reason = "x" }),
            (HttpMethod.Post, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/remove", new { reason = "x" }),
            (HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/authorities",
                new { authorities = new[] { new { name = "ConfirmRecords", expiresAtUtc = (DateTime?)null } } }),
        };

        foreach (var (method, url, body) in attempts)
        {
            using var response = await SendAsync(method, url, CoOwnerAll, body);
            output.WriteLine($"[EVIDENCE] co-owner with every authority {method} {url}: {(int)response.StatusCode}");
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{method} {url} is the primary account holder's alone");
        }

        (await AuditCountAsync(FarmA, "MemberAuthoritiesChanged")).Should().Be(0);
        (await SeatStatusAsync(Holder)).Should().Be(3, "nothing a co-owner asked for moved");

        // CONTROL: the primary account holder.
        using var roster = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/labour-permissions", OwnerA);
        roster.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_primary_owner_sets_authorities_with_ends_once_audited_and_nobody_else_may()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var end = DateTime.UtcNow.AddDays(4);
        var body = new
        {
            authorities = new object[]
            {
                new { name = "TakeAttendance", expiresAtUtc = (DateTime?)null },
                new { name = "ConfirmRecords", expiresAtUtc = (DateTime?)end },
                new { name = "EditFarmSetup", expiresAtUtc = (DateTime?)null },
            },
        };

        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/authorities", OwnerA, body))
        {
            var text = await set.Content.ReadAsStringAsync();
            set.StatusCode.Should().Be(HttpStatusCode.OK, text);
            using var doc = JsonDocument.Parse(text);
            var names = doc.RootElement.GetProperty("authorities").EnumerateArray()
                .Select(a => a.GetProperty("name").GetString()).ToArray();
            names.Should().BeEquivalentTo(new[] { "TakeAttendance", "ConfirmRecords", "EditFarmSetup" });
            doc.RootElement.GetProperty("canEditAuthorities").GetBoolean().Should().BeTrue();
        }

        var (bits, labour, json) = await StoredAsync(Holder);
        bits.Should().Be(128 | 256);
        labour.Should().BeTrue();
        json.Should().Contain("\"128\"");
        (await GateAsync(FarmA, Holder, FarmAuthority.ConfirmRecords, end.AddMinutes(1))).Should().BeFalse("ends with its date");
        (await GateAsync(FarmA, Holder, FarmAuthority.EditFarmSetup, end.AddMinutes(1))).Should().BeTrue("permanent");

        var audits = await AuditPayloadsAsync(FarmA, "MemberAuthoritiesChanged");
        audits.Should().ContainSingle();
        audits[0].GetProperty("authorities").GetArrayLength().Should().Be(3);

        // A re-send is the truth, not a second history row.
        using (var again = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/authorities", OwnerA, body))
        {
            again.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await AuditPayloadsAsync(FarmA, "MemberAuthoritiesChanged")).Should().ContainSingle();

        // Refused shapes: an end in the past; wages without money; an unknown name; the owner himself.
        foreach (var bad in new object[]
        {
            new { authorities = new[] { new { name = "ConfirmRecords", expiresAtUtc = (DateTime?)DateTime.UtcNow.AddDays(-1) } } },
            new { authorities = new[] { new { name = "SeeWages", expiresAtUtc = (DateTime?)null } } },
            new { authorities = new[] { new { name = "Invite", expiresAtUtc = (DateTime?)null } } },
        })
        {
            using var refused = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Holder}/authorities", OwnerA, bad);
            refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var self = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{OwnerA}/authorities", OwnerA, body))
        {
            self.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        (await StoredAsync(Holder)).Bits.Should().Be(128 | 256, "nothing refused was stored");
    }

    // ── Global role decides nothing (tests, compliance, schedule templates, password accounts) ──

    [Fact]
    public async Task A_global_role_only_account_with_no_seat_on_the_farm_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using (var evaluate = await SendAsync(HttpMethod.Post, $"/shramsafal/compliance/evaluate/{FarmA}", GlobalOnly, null, globalRole: "PrimaryOwner"))
        {
            evaluate.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        }

        using (var protocol = await SendAsync(HttpMethod.Post, $"/shramsafal/test-protocols?farmId={FarmA}", GlobalOnly, new
        {
            name = "probe",
            cropType = "Grapes",
            kind = 1,
            periodicity = 0,
            stageNames = new[] { "Flowering" },
            parameterCodes = new[] { "pH" },
        }, globalRole: "Agronomist"))
        {
            protocol.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        }

        // CONTROL: the farm's primary owner — no global role at all — may evaluate.
        using var owner = await SendAsync(HttpMethod.Post, $"/shramsafal/compliance/evaluate/{FarmA}", OwnerA, null);
        owner.StatusCode.Should().Be(HttpStatusCode.Accepted, await owner.Content.ReadAsStringAsync());

        // fix 1 (LOW-1): a protocol belongs to no farm — a plain registrant (no expert sign-up role)
        // is refused even naming his own farm, where he holds every authority.
        foreach (var role in new[] { null, "Worker" })
        {
            using var registrant = await SendAsync(HttpMethod.Post, $"/shramsafal/test-protocols?farmId={FarmA}", OwnerA, new
            {
                name = "registrant probe",
                cropType = "Grapes",
                kind = 1,
                periodicity = 0,
                stageNames = new[] { "Flowering" },
                parameterCodes = new[] { "pH" },
            }, globalRole: role);
            registrant.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        }
    }

    // ── Late offline work (MU design §11.2) ────────────────────────────────────────────────

    // fix 1 (HIGH-2): late work from an ENDED authority counts only inside LateArrivalWindow —
    // received within 7 days after the end (server clock), done within the 7 days before it — and
    // only as NEW work. Everything else is refused (code unchanged, parks visibly) and kept whole for
    // the owner; nothing is dropped.

    [Fact]
    public async Task Late_hajeri_counts_only_inside_the_window_and_only_as_a_new_mark_everything_else_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var operatorId = await CreateFieldOperatorIdAsync(OwnerA);
        var today = ShramSafal.Domain.Dfes.FarmLocalDay.From(DateTime.UtcNow);
        var todayStart = ShramSafal.Domain.Dfes.FarmLocalDay.UtcWindow(today).StartUtc;
        async Task EndHajeriAtAsync(DateTime end) => await ExecSuperAsync(
            "UPDATE ssf.farm_memberships SET permissions = 0, can_manage_labour_records = TRUE, labour_grant_expires_at_utc = @end, authority_expires_at = NULL WHERE user_id = @u",
            ("end", end), ("u", Holder));

        // (1) inside the window: ended at the start of today, the work is yesterday's -> applied + flagged.
        await EndHajeriAtAsync(todayStart);
        var inside = await PushAttendanceAsync(Holder, operatorId, today.AddDays(-1), "late-inside");
        inside.Status.Should().Be("applied", inside.ErrorCode);
        var flags = await AuditPayloadsAsync(FarmA, LateAuthorityAudit.AcceptedAfterEnd);
        flags.Should().ContainSingle();
        flags[0].GetProperty("authority").GetString().Should().Be("TakeAttendance");

        // (2) work done after the end (today) -> refused, kept, not applied.
        var afterEnd = await PushAttendanceAsync(Holder, operatorId, today, "late-after-end");
        afterEnd.Status.Should().Be("failed");
        afterEnd.ErrorCode.Should().Be("ShramSafal.Forbidden", "every installed phone parks this code visibly");

        // (3) the work's date is older than the 7 days before the end -> kept, not applied.
        var tooOld = await PushAttendanceAsync(Holder, operatorId, today.AddDays(-(LateArrivalWindow.DoneWithinDaysBeforeEnd + 2)), "late-too-old");
        tooOld.Status.Should().Be("failed");
        tooOld.ErrorCode.Should().Be("ShramSafal.Forbidden");

        // (4) an EXISTING mark is never overwritten by an ended authority, even inside the window.
        var markedDay = today.AddDays(-2);
        (await PushAttendanceAsync(OwnerA, operatorId, markedDay, "owner-mark", dayMark: "Half")).Status.Should().Be("applied");
        var overwrite = await PushAttendanceAsync(Holder, operatorId, markedDay, "late-overwrite");
        overwrite.Status.Should().Be("failed");
        overwrite.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await DayMarkAsync(operatorId, markedDay)).Should().Be("Half", "the owner's mark stands");

        // (5) arrival after the window: ended 9 days ago, the work 1 day before that -> kept, not applied.
        await EndHajeriAtAsync(todayStart.AddDays(-(LateArrivalWindow.ReceivedWithinDaysAfterEnd + 2)));
        var lateArrival = await PushAttendanceAsync(Holder, operatorId, today.AddDays(-(LateArrivalWindow.ReceivedWithinDaysAfterEnd + 3)), "late-arrival");
        lateArrival.Status.Should().Be("failed");
        lateArrival.ErrorCode.Should().Be("ShramSafal.Forbidden");

        foreach (var day in new[] { today, today.AddDays(-(LateArrivalWindow.DoneWithinDaysBeforeEnd + 2)), today.AddDays(-(LateArrivalWindow.ReceivedWithinDaysAfterEnd + 3)) })
        {
            (await DayMarkAsync(operatorId, day)).Should().BeNull($"nothing applied for {day}");
        }

        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.AcceptedAfterEnd)).Should().ContainSingle("only the in-window new mark is flagged");
        var kept = await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner);
        kept.Select(k => k.GetProperty("clientRequestId").GetString()).Should().BeEquivalentTo(
            new[] { "late-after-end", "late-too-old", "late-overwrite", "late-arrival" }, "nothing is dropped (P9 / P10)");
        kept.Should().OnlyContain(k => k.GetProperty("mutationType").GetString() == "attendance.mark");
        output.WriteLine("[EVIDENCE] late हजेरी: inside window applied+flagged; after-end / too-old / overwrite / late-arrival refused (Forbidden) + kept");

        // A re-send of a refused one keeps no second copy.
        (await PushAttendanceAsync(Holder, operatorId, today, "late-after-end")).Status.Should().Be("failed");
        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner)).Should().HaveCount(4);
    }

    [Fact]
    public async Task Late_confirmation_counts_only_inside_the_window_and_only_on_an_undecided_record_everything_else_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var inside = await CreateLogAsync(OwnerA, createdHoursAgo: 24 * 12);
        var afterEnd = await CreateLogAsync(OwnerA, createdHoursAgo: 24 * 12);
        var tooOld = await CreateLogAsync(OwnerA, createdHoursAgo: 24 * 12);
        var decided = await CreateLogAsync(OwnerA, createdHoursAgo: 24 * 12);
        var lateArrival = await CreateLogAsync(OwnerA, createdHoursAgo: 24 * 12);
        async Task EndConfirmAtAsync(DateTime end) => await ExecSuperAsync(
            "UPDATE ssf.farm_memberships SET permissions = 128, can_manage_labour_records = FALSE, authority_expires_at = jsonb_build_object('128', to_char(@end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) WHERE user_id = @u",
            ("end", end), ("u", Holder));

        // The owner decides one record first (मंजूर): a late decision must never overwrite it.
        (await VerifyAsync(OwnerA, decided)).Should().Be(HttpStatusCode.OK);

        var endedAt = DateTime.UtcNow.AddSeconds(-30);
        await EndConfirmAtAsync(endedAt);

        // (1) inside: made 10 s before the end, received now -> applied + flagged.
        var made = await PushVerifyV2Async(Holder, inside, decidedAt: endedAt.AddSeconds(-10), "confirm-inside");
        made.Status.Should().Be("applied", made.ErrorCode);
        (await LogStatusAsync(inside)).Should().Be("Verified");
        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.AcceptedAfterEnd)).Should().ContainSingle();

        // (2) made after the end -> refused + kept (no longer a mark: the authority ENDED).
        var after = await PushVerifyV2Async(Holder, afterEnd, decidedAt: DateTime.UtcNow.AddSeconds(-1), "confirm-after-end");
        after.Status.Should().Be("failed");
        after.ErrorCode.Should().Be("ShramSafal.Forbidden");

        // (3) made more than 7 days before the end -> kept.
        var old = await PushVerifyV2Async(Holder, tooOld, decidedAt: endedAt.AddDays(-(LateArrivalWindow.DoneWithinDaysBeforeEnd + 1)), "confirm-too-old");
        old.Status.Should().Be("failed");
        old.ErrorCode.Should().Be("ShramSafal.Forbidden");

        // (4) a शंका on a record the owner already confirmed, made inside the window -> kept.
        var overwrite = await PushVerifyV2Async(Holder, decided, decidedAt: endedAt.AddSeconds(-5), "confirm-overwrite", decision: "dispute");
        overwrite.Status.Should().Be("failed");
        overwrite.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await LogStatusAsync(decided)).Should().Be("Verified", "the owner's decision stands");

        // (5) arrival after the window: ended 9 days ago, made the day before that -> kept.
        var oldEnd = DateTime.UtcNow.AddDays(-(LateArrivalWindow.ReceivedWithinDaysAfterEnd + 2));
        await EndConfirmAtAsync(oldEnd);
        var arrival = await PushVerifyV2Async(Holder, lateArrival, decidedAt: oldEnd.AddDays(-1), "confirm-late-arrival");
        arrival.Status.Should().Be("failed");
        arrival.ErrorCode.Should().Be("ShramSafal.Forbidden");

        foreach (var log in new[] { afterEnd, tooOld, lateArrival })
        {
            (await LogStatusAsync(log)).Should().Be("Draft", "nothing applied");
        }

        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.AcceptedAfterEnd)).Should().ContainSingle();
        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner))
            .Select(k => k.GetProperty("clientRequestId").GetString())
            .Should().BeEquivalentTo(new[] { "confirm-after-end", "confirm-too-old", "confirm-overwrite", "confirm-late-arrival" });
        output.WriteLine("[EVIDENCE] late confirm: inside window applied+flagged; after-end / too-old / overwrite / late-arrival refused (Forbidden) + kept");
    }

    [Fact]
    public async Task Work_from_a_paused_seat_is_refused_visibly_and_kept_for_the_owner()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await StoreOnlyAsync(Holder, FarmAuthority.EditFarmSetup, end: null);
        await ExecSuperAsync("UPDATE ssf.farm_memberships SET status = 4 WHERE user_id = @u AND farm_id = @f", ("u", Holder), ("f", FarmA));

        var plotId = Guid.NewGuid();
        var outcome = await PushAsync(Holder, "paused-plot", "create_plot",
            new { plotId, farmId = FarmA, name = "paused plot", areaInAcres = 1.5m });
        outcome.Status.Should().Be("failed");
        outcome.ErrorCode.Should().Be("ShramSafal.Forbidden");

        var kept = await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner);
        kept.Should().ContainSingle();
        kept[0].GetProperty("seatStatus").GetString().Should().Be("Suspended");
        kept[0].GetProperty("mutation").GetProperty("plotId").GetString().Should().Be(plotId.ToString());

        // A stranger (never on the farm) is refused and NOTHING is written into the owner's history.
        var stranger = await PushAsync(GlobalOnly, "stranger-plot", "create_plot",
            new { plotId = Guid.NewGuid(), farmId = FarmA, name = "x", areaInAcres = 1m });
        stranger.Status.Should().Be("failed");
        (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner)).Should().ContainSingle();
    }

    // ── fix 1 (MEDIUM-1): a kept copy is bounded ───────────────────────────────────────────

    [Fact]
    public async Task A_kept_copy_is_bounded_in_size_and_in_number_per_sender_per_farm_per_day()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await StoreOnlyAsync(Holder, FarmAuthority.EditFarmSetup, end: null);
        await ExecSuperAsync("UPDATE ssf.farm_memberships SET status = 4 WHERE user_id = @u AND farm_id = @f", ("u", Holder), ("f", FarmA));

        // (1) a body over 32 KB is kept as its type, size, SHA-256 and first part — never whole.
        var hugeName = new string('क', 20_000); // 3 bytes each in UTF-8: ~60 KB
        var big = await PushAsync(Holder, "kept-big", "create_plot",
            new { plotId = Guid.NewGuid(), farmId = FarmA, name = hugeName, areaInAcres = 1m });
        big.Status.Should().Be("failed");
        big.ErrorCode.Should().Be("ShramSafal.Forbidden");
        var kept = (await AuditPayloadsAsync(FarmA, LateAuthorityAudit.KeptForOwner)).Single();
        (kept.TryGetProperty("mutation", out var whole) && whole.ValueKind != JsonValueKind.Null)
            .Should().BeFalse("an over-size body is never kept whole");
        var tooLarge = kept.GetProperty("mutationTooLarge");
        tooLarge.GetProperty("sizeBytes").GetInt32().Should().BeGreaterThan(32 * 1024);
        tooLarge.GetProperty("sha256").GetString().Should().HaveLength(64);
        tooLarge.GetProperty("head").GetString()!.Length.Should().BeLessThanOrEqualTo(2048).And.BeGreaterThan(0);
        kept.GetProperty("mutationType").GetString().Should().Be("create_plot");

        // (2) at most 200 kept copies per sender per farm per farm-day; past it ONE row says so.
        var outcomes = await PushManyAsync(Holder, Enumerable.Range(0, 205).Select(i =>
            ($"kept-many-{i}", "create_plot",
                (object)new { plotId = Guid.NewGuid(), farmId = FarmA, name = $"p{i}", areaInAcres = 1m })).ToList());
        outcomes.Should().OnlyContain(o => o.Status == "failed" && o.ErrorCode == "ShramSafal.Forbidden",
            "every refusal still reaches the phone, kept or not");
        (await AuditCountAsync(FarmA, LateAuthorityAudit.KeptForOwner)).Should().Be(200);
        var capRows = await AuditPayloadsAsync(FarmA, "WorkKeptForOwnerDailyCapReached");
        capRows.Should().ContainSingle("one row for the day, however many more arrive");
        capRows[0].GetProperty("cap").GetInt32().Should().Be(200);
        output.WriteLine("[EVIDENCE] kept copies: >32 KB body kept as size+sha256+head; 206 refusals -> 200 kept + 1 cap row");
    }

    // ── Harness ────────────────────────────────────────────────────────────────────────────

    private sealed record PushOutcome(string Status, string? ErrorCode);

    private async Task<List<PushOutcome>> PushManyAsync(Guid who, List<(string RequestId, string MutationType, object Payload)> mutations)
    {
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = mutations.Select(m => new { clientRequestId = m.RequestId, mutationType = m.MutationType, payload = m.Payload }).ToArray(),
        };
        using var response = await SendAsync(HttpMethod.Post, "/sync/push", who, request);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("results").EnumerateArray()
            .Select(result => new PushOutcome(
                result.GetProperty("status").GetString()!,
                result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null))
            .ToList();
    }

    private async Task<bool> GateAsync(Guid farm, Guid user, FarmAuthority authority, DateTime at)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.user_id', {user.ToString()}, true)");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.farm_id', {Guid.Empty.ToString()}, true)");
        var repository = new ShramSafalRepository(db);
        return await FarmAuthorityGate.HoldsAsync(repository, farm, user, authority, at);
    }

    private Task StoreNothingAsync(Guid user) => ExecSuperAsync(
        "UPDATE ssf.farm_memberships SET permissions = 0, can_manage_labour_records = FALSE, labour_grant_expires_at_utc = NULL, authority_expires_at = NULL WHERE user_id = @u AND status NOT IN (5, 6)",
        ("u", user));

    /// <summary>Stores exactly <paramref name="authority"/> (and see money when it needs it).</summary>
    private Task StoreOnlyAsync(Guid user, FarmAuthority authority, DateTime? end)
    {
        if (authority == FarmAuthority.TakeAttendance)
        {
            return ExecSuperAsync(
                "UPDATE ssf.farm_memberships SET permissions = 0, can_manage_labour_records = TRUE, labour_grant_expires_at_utc = @end, authority_expires_at = NULL WHERE user_id = @u AND status NOT IN (5, 6)",
                ("end", (object?)end ?? DBNull.Value), ("u", user));
        }

        var bit = (int)FarmAuthorities.BitOf(authority);
        var bits = bit | (FarmAuthorities.RequiredBy(authority) is { } needed ? (int)FarmAuthorities.BitOf(needed) : 0);
        var json = end is { } instant
            ? $"{{\"{bit}\":\"{instant:yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'}\"}}"
            : null;
        return ExecSuperAsync(
            "UPDATE ssf.farm_memberships SET permissions = @bits, can_manage_labour_records = FALSE, labour_grant_expires_at_utc = NULL, authority_expires_at = CAST(@json AS jsonb) WHERE user_id = @u AND status NOT IN (5, 6)",
            ("bits", bits), ("json", (object?)json ?? DBNull.Value), ("u", user));
    }

    private async Task<(int Bits, bool Labour, string Json)> StoredAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COALESCE(permissions, 0), can_manage_labour_records, COALESCE(authority_expires_at::text, '') FROM ssf.farm_memberships WHERE user_id = @u AND farm_id = @f AND status NOT IN (5, 6)";
        cmd.Parameters.AddWithValue("u", user);
        cmd.Parameters.AddWithValue("f", FarmA);
        await using var r = await cmd.ExecuteReaderAsync();
        await r.ReadAsync();
        return (r.GetInt32(0), r.GetBoolean(1), r.GetString(2));
    }

    private async Task<int> SeatStatusAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.farm_memberships WHERE user_id = @u AND farm_id = @f AND status NOT IN (5, 6)";
        cmd.Parameters.AddWithValue("u", user);
        cmd.Parameters.AddWithValue("f", FarmA);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    /// <summary>Adds a plot the way the phone does (push create_plot); OK = applied, Forbidden = refused.</summary>
    private async Task<HttpStatusCode> CreatePlotAsync(Guid who)
    {
        var outcome = await PushAsync(who, $"plot-{Guid.NewGuid():N}", "create_plot",
            new { plotId = Guid.NewGuid(), farmId = FarmA, name = $"plot-{Guid.NewGuid():N}"[..12], areaInAcres = 1.0m });
        return AsStatus(outcome);
    }

    private static HttpStatusCode AsStatus(PushOutcome outcome) => outcome.Status switch
    {
        "applied" => HttpStatusCode.OK,
        _ when outcome.ErrorCode is "ShramSafal.Forbidden" => HttpStatusCode.Forbidden,
        _ => HttpStatusCode.BadRequest,
    };

    private async Task<HttpStatusCode> CreateFieldOperatorAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/labour/field-operators", who,
            new { displayName = "रामू" });
        return response.StatusCode;
    }

    private async Task<Guid> CreateFieldOperatorIdAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/labour/field-operators", who,
            new { displayName = "शामू" });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, text);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("id").GetGuid();
    }

    /// <summary>Corrects the seeded cost the way the phone does (push correct_cost_entry).</summary>
    private async Task<HttpStatusCode> CorrectCostAsync(Guid who, Guid? cost = null)
    {
        var outcome = await PushAsync(who, $"correct-{Guid.NewGuid():N}", "correct_cost_entry", new
        {
            financeCorrectionId = Guid.NewGuid(),
            costEntryId = cost ?? CostA,
            correctedAmount = 900m,
            currencyCode = "INR",
            reason = "probe correction",
            correctedByUserId = who,
        });
        return AsStatus(outcome);
    }

    /// <summary>A daily log on farm A by <paramref name="who"/>, planted as superuser (the plant never
    /// depends on the code under test).</summary>
    private async Task<Guid> CreateLogAsync(Guid who, int createdHoursAgo = 2)
    {
        var id = Guid.NewGuid();
        await ExecSuperAsync("""
            INSERT INTO ssf.daily_logs
                ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id,
                 log_date, created_at_utc, modified_at_utc, source, model_version, prompt_version)
            VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid,
                    @date, NOW() - make_interval(hours => @ago), NOW() - make_interval(hours => @ago), 'manual', 'unknown', 'unknown');
            """,
            ("id", id), ("fid", FarmA), ("pid", PlotA), ("cid", CycleA), ("uid", who), ("ago", createdHoursAgo),
            ("date", DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-createdHoursAgo))));
        return id;
    }

    /// <summary>D-28 — any Active member reports a purchase (his own work), offline-first.</summary>
    private Task<PushOutcome> PushPurchaseAsync(Guid who, string requestId) =>
        PushAsync(who, requestId, "add_cost_entry", new
        {
            costEntryId = DeterministicGuid(requestId),
            farmId = FarmA,
            plotId = PlotA,
            categoryId = "other",
            description = "purchase reported by a member",
            amount = 250m,
            currencyCode = "INR",
            entryDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
        });

    /// <summary>The owner's confirmation the way the phone sends it (push verify_log_v2, read).</summary>
    private async Task<HttpStatusCode> VerifyAsync(Guid who, Guid logId) =>
        AsStatus(await PushVerifyV2Async(who, logId, DateTime.UtcNow.AddSeconds(-5), $"verify-{Guid.NewGuid():N}"));

    private async Task<string> LogStatusAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.verification_events WHERE daily_log_id = @id ORDER BY occurred_at_utc DESC, \"Id\" LIMIT 1";
        cmd.Parameters.AddWithValue("id", logId);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? "Draft" : value switch
        {
            int i => ((ShramSafal.Domain.Logs.VerificationStatus)i).ToString(),
            string s => s,
            _ => value.ToString()!,
        };
    }

    private Task<PushOutcome> PushAttendanceAsync(Guid who, Guid operatorId, DateOnly day, string requestId, string dayMark = "Full") =>
        PushAsync(who, requestId, "attendance.mark", new
        {
            attendanceMarkId = DeterministicGuid(requestId),
            farmId = FarmA,
            fieldOperatorId = operatorId,
            workDate = day.ToString("yyyy-MM-dd"),
            dayMark,
        });

    private Task<PushOutcome> PushVerifyV2Async(Guid who, Guid logId, DateTime decidedAt, string requestId, string decision = "verify") =>
        PushAsync(who, requestId, "verify_log_v2", new
        {
            logId,
            verifierUserId = who,
            decision,
            reason = decision == "dispute" ? "probe query" : null,
            decidedAt = decidedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
            reviewBasis = "read",
        });

    /// <summary>The stored day mark for one person on one day ("Full" / "Half" / …), or null when none.</summary>
    private async Task<string?> DayMarkAsync(Guid operatorId, DateOnly day)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT day_mark FROM ssf.attendance_marks WHERE farm_id = @f AND field_operator_id = @o AND work_date = @d";
        cmd.Parameters.AddWithValue("f", FarmA);
        cmd.Parameters.AddWithValue("o", operatorId);
        cmd.Parameters.AddWithValue("d", day);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? null : ((ShramSafal.Domain.Labour.DayMark)Convert.ToInt32(value)).ToString();
    }

    private async Task<PushOutcome> PushAsync(Guid who, string requestId, string mutationType, object payload)
    {
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = new[] { new { clientRequestId = requestId, mutationType, payload } },
        };
        using var response = await SendAsync(HttpMethod.Post, "/sync/push", who, request);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        using var doc = JsonDocument.Parse(text);
        var result = doc.RootElement.GetProperty("results").EnumerateArray().Single();
        return new PushOutcome(
            result.GetProperty("status").GetString()!,
            result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null);
    }

    private static Guid DeterministicGuid(string seed) =>
        new(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("2b|" + seed)).AsSpan(0, 16));

    private async Task<List<JsonElement>> AuditPayloadsAsync(Guid farm, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT payload FROM ssf.audit_events WHERE farm_id = @f AND action = @a ORDER BY occurred_at_utc";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", action);
        var rows = new List<JsonElement>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(JsonDocument.Parse(r.GetString(0)).RootElement.Clone());
        }

        return rows;
    }

    private async Task<long> AuditCountAsync(Guid farm, string action) => (await AuditPayloadsAsync(farm, action)).Count;

    private async Task ExecSuperAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid who, object? body = null, string? globalRole = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        request.Headers.Add("X-Test-UserId", who.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        if (globalRole is not null)
        {
            request.Headers.Add("X-Test-GlobalRole", globalRole);
        }

        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-lane2b", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, GlobalRoleTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"lane2b-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);
        builder.Services.AddScoped<IEntitlementPolicy, AllowAllEntitlementPolicy>();

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();
        await app.StartAsync();
        return app;
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(await cmd.ExecuteScalarAsync()).Should().BeFalse(
            "doctrine E3 - a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedFarmAsync(NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account, string code)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """,
            ("farm", farm), ("name", name), ("owner", owner), ("account", account), ("code", code));

    private static Task SeedSeatAsync(NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, int status)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW() - INTERVAL '30 days', NOW(), @account, @status, 2);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", userId), ("role", role), ("account", account), ("status", status));

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
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    /// <summary>
    /// The test sign-in: the subject from X-Test-UserId and, when X-Test-GlobalRole is sent, the
    /// account's GLOBAL role claim exactly as the production token carries it ("shramsafal:&lt;Role&gt;").
    /// </summary>
    private sealed class GlobalRoleTestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-UserId", out var raw) || !Guid.TryParse(raw.ToString(), out var userId))
            {
                return Task.FromResult(AuthenticateResult.Fail("missing X-Test-UserId"));
            }

            var id = userId.ToString();
            var claims = new List<Claim>
            {
                new("sub", id),
                new(ClaimTypes.NameIdentifier, id),
                new("phone_verified", "true"),
            };
            if (Request.Headers.TryGetValue("X-Test-GlobalRole", out var role) && !string.IsNullOrWhiteSpace(role))
            {
                claims.Add(new Claim("membership", $"shramsafal:{role}"));
            }

            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
        }
    }
}
