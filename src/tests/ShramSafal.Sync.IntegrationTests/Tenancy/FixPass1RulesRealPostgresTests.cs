// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (review REQUEST_CHANGES 40/50).
//
// One fact per finding, each on a real Postgres as agrisync_app (E3 first), through the real host and its routes:
//   F-2  the farm-week report: an own-records seat gets no farm overview (MU-3); the owner and a seat without money do;
//   F-4  the global price list: only the platform admin writes it, on REST and on push; anyone else is refused visibly;
//   F-5  the admin AI routes: a farmer is refused, the platform admin is answered (they answered 500 to everyone);
//   F-7  another person's document session answers exactly as a made-up one (404);
//   F-9  a job card names only its own farm's plot and season;
//   F-11 a made-up AI job answers 404, and a person active on two farms opens only the farm each record belongs to.
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class FixPass1RulesRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid PlatformAdmin = Guid.Parse("3d099100-0000-4000-8000-000000000001");
    private static readonly Guid FarmBTest = Guid.Parse("3d099100-0000-4000-8000-000000000057");
    private static readonly Guid OwnersSession = Guid.Parse("3d099100-0000-4000-8000-0000000000d1");

    /// <summary>The analytics database is Postgres in production; the weekly report reads it with raw SQL.</summary>
    protected override void AddHostServices(IServiceCollection services)
    {
        services.RemoveAll<Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.RemoveAll<DbContextOptions<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.AddDbContext<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>(o => o.UseNpgsql(AppConn));
    }

    // ── F-2: the farm-week report is the farm's overview ────────────────────────────────

    [Fact]
    public async Task F2_the_farm_week_report_is_refused_to_an_own_records_seat_and_answered_to_the_owner()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The weekly report reads mis.* on the analytics connection; production's role there is OPS-1's to settle, so the
        // read is granted here to prove the route's own rule, not the grant.
        await ExecOnSuperuserAsync("GRANT USAGE ON SCHEMA mis TO agrisync_app; GRANT SELECT ON ALL TABLES IN SCHEMA mis TO agrisync_app;");
        var url = $"/shramsafal/reports/farm-week/{FarmA}";

        (await GetAsync(Worker, url)).Status.Should().Be(HttpStatusCode.Forbidden, "a कामगार gets no farm overview (MU-3)");
        var (owner, ownerBody) = await GetAsync(Owner, url);
        owner.Should().Be(HttpStatusCode.OK, ownerBody);
        var (coOwner, coOwnerBody) = await GetAsync(CoOwner, url);
        coOwner.Should().Be(HttpStatusCode.OK, coOwnerBody);
        Json(coOwnerBody).GetProperty("aiCostUsd7d").ValueKind.Should().Be(JsonValueKind.Null, "a seat without money gets no AI cost");
        (await GetAsync(OwnerB, url)).Status.Should().Be(HttpStatusCode.Forbidden, "another farmer");
    }

    // ── F-4: the global price list ──────────────────────────────────────────────────────

    [Fact]
    public async Task F4_only_the_platform_admin_writes_the_price_list_on_REST_and_on_push()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedPlatformAdminAsync();
        object Price(string item) => new { itemName = item, unitPrice = 42.5m, currencyCode = "INR", effectiveFrom = "2026-11-01", version = 1 };

        // REST: the farm's own owner is a farmer here — refused with the rule's code and words; nothing is written.
        var (farmer, farmerBody) = await PostAsync(Owner, "/shramsafal/finance/price-config", Price("f99-farmer-rest"));
        farmer.Should().Be(HttpStatusCode.Forbidden, farmerBody);
        Json(farmerBody).GetProperty("error").GetString().Should().Be("ShramSafal.PriceList.Forbidden");
        Json(farmerBody).GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        // Push: the same rule, a visible refusal (".Forbidden" — the phone parks it), never applied and never dropped.
        var pushed = await PushAsync(Owner, "set_price_config", "f99-price-farmer", new Dictionary<string, object?>
        {
            ["itemName"] = "f99-farmer-push",
            ["unitPrice"] = 42.5m,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = "2026-11-01",
            ["version"] = 1,
        });
        pushed.Status.Should().NotBe("applied");
        pushed.ErrorCode.Should().Be("ShramSafal.PriceList.Forbidden");

        // The platform admin: written on REST and on push (he holds a seat on farm B, as push asks of every sender).
        var (admin, adminBody) = await PostAsync(PlatformAdmin, "/shramsafal/finance/price-config", Price("f99-admin-rest"));
        admin.Should().Be(HttpStatusCode.OK, adminBody);
        (await PushAsync(PlatformAdmin, "set_price_config", "f99-price-admin", new Dictionary<string, object?>
        {
            ["itemName"] = "f99-admin-push",
            ["unitPrice"] = 42.5m,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = "2026-11-01",
            ["version"] = 1,
        })).Status.Should().Be("applied");

        (await ItemsAsync()).Should().BeEquivalentTo(["f99-admin-rest", "f99-admin-push"], "only the admin's two rates are kept");
    }

    // ── F-5: the admin AI routes ────────────────────────────────────────────────────────

    [Fact]
    public async Task F5_the_admin_AI_routes_answer_the_platform_admin_and_refuse_a_farmer()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedPlatformAdminAsync();
        foreach (var url in new[] { "/shramsafal/ai/config", "/shramsafal/ai/dashboard" })
        {
            var (admin, adminBody) = await GetAsync(PlatformAdmin, url);
            admin.Should().Be(HttpStatusCode.OK, $"{url}: {adminBody}");
            var (farmer, _) = await GetAsync(Owner, url);
            farmer.Should().BeOneOf([HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden], $"{url}: a farmer has no admin seat");
        }
    }

    // ── F-7: a document session ─────────────────────────────────────────────────────────

    [Fact]
    public async Task F7_another_persons_document_session_answers_as_a_made_up_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.document_extraction_sessions (id, user_id, farm_id, document_type, status, draft_confidence,
                                                          verified_confidence, created_at_utc, modified_at_utc)
            VALUES (@id, @owner, @farm, 'Receipt', 'Captured', 0, 0, NOW(), NOW());
            """, ("id", OwnersSession), ("owner", Owner), ("farm", FarmA));

        (await GetAsync(Owner, $"/shramsafal/ai/document-sessions/{OwnersSession}")).Status.Should().Be(HttpStatusCode.OK, "his own");
        var madeUp = await GetAsync(Worker, $"/shramsafal/ai/document-sessions/{Guid.NewGuid()}");
        var others = await GetAsync(Worker, $"/shramsafal/ai/document-sessions/{OwnersSession}");
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        others.Status.Should().Be(HttpStatusCode.NotFound, "no hint that another person's session exists (E4)");
        others.Body.Should().Be(madeUp.Body);
    }

    // ── F-9 and F-11: one farm per record, both ways ────────────────────────────────────

    [Fact]
    public async Task F9_a_job_card_names_only_its_own_farms_plot_and_season()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeatMukadamOnFarmBAsync();
        object Card(Guid farm, Guid plot, Guid? cycle) => new
        {
            farmId = farm,
            plotId = plot,
            cropCycleId = cycle,
            plannedDate = "2026-11-03",
            lineItems = new[] { new { activityType = "spray", expectedHours = 2, ratePerHourAmount = 100, ratePerHourCurrencyCode = "INR" } },
        };

        // He is active on both farms: farm A with farm B's plot, and farm B with farm A's season, are not found.
        var (foreignPlot, foreignPlotBody) = await PostAsync(Mukadam, "/shramsafal/job-cards", Card(FarmA, PlotB, null));
        foreignPlot.Should().Be(HttpStatusCode.NotFound, foreignPlotBody);
        Json(foreignPlotBody).GetProperty("error").GetString().Should().Be("ShramSafal.PlotNotFound");
        var (foreignSeason, foreignSeasonBody) = await PostAsync(Mukadam, "/shramsafal/job-cards", Card(FarmB, PlotB, CycleA));
        foreignSeason.Should().Be(HttpStatusCode.NotFound, foreignSeasonBody);
        Json(foreignSeasonBody).GetProperty("error").GetString().Should().Be("ShramSafal.CropCycleNotFound");
        (await CountAsync("SELECT count(*) FROM ssf.job_cards WHERE created_by_user_id = @u", Mukadam)).Should().Be(0);

        // The control: his farm A card on farm A's plot and season is made.
        (await PostAsync(Mukadam, "/shramsafal/job-cards", Card(FarmA, PlotA, CycleA))).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task F11_a_person_on_two_farms_opens_only_the_farm_each_record_belongs_to()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeatMukadamOnFarmBAsync();
        await SetAuthoritiesAsync(FarmB, Mukadam, FarmAuthority.LabRecords);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.test_instances (id, test_protocol_id, protocol_kind, crop_cycle_id, farm_id, plot_id, stage_name,
                                            planned_due_date, created_at_utc, modified_at_utc, status)
            VALUES (@test, @protocol, 0, @cycleB, @farmB, @plotB, 'Vegetative', DATE '2026-10-01', NOW(), NOW(), 0);
            """, ("test", FarmBTest), ("protocol", Protocol), ("cycleB", CycleB), ("farmB", FarmB), ("plotB", PlotB));

        // Farm B's test: collected on farm B (the record's farm is the scope opened, not his other farm).
        var (collected, collectedBody) = await PostAsync(Mukadam, $"/shramsafal/test-instances/{FarmBTest}/collect", null);
        collected.Should().Be(HttpStatusCode.OK, collectedBody);
        (await StatusOfTestAsync(FarmBTest)).Should().Be(1);
        (await StatusOfTestAsync(TestRecord)).Should().Be(0, "farm A's test is untouched");

        // Farm B's record: its state is read on farm B.
        var (state, stateBody) = await GetAsync(Mukadam, $"/shramsafal/logs/{FarmBLog}/transitions");
        state.Should().Be(HttpStatusCode.OK, stateBody);

        // Naming farm A with farm B's plot and season: not found (E4), as the handlers ask in application code.
        var (adopt, adoptBody) = await PostAsync(Mukadam, $"/shramsafal/plots/{PlotB}/cycles/{CycleB}/schedule/adopt",
            new { farmId = FarmA, scheduleTemplateId = Guid.NewGuid() });
        adopt.Should().Be(HttpStatusCode.NotFound, adoptBody);

        // A made-up AI job is 404 (it answered 400).
        (await GetAsync(Mukadam, $"/shramsafal/ai/jobs/{Guid.NewGuid()}")).Status.Should().Be(HttpStatusCode.NotFound);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    /// <summary>ShramSafal's platform admin: a Platform organisation's Owner, with a seat on farm B (push asks for one).</summary>
    private Task SeedPlatformAdminAsync() => ExecOnSuperuserAsync("""
        INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
        VALUES (@admin, '9300000991', 'शेतसाथी-प्रशासक', 'x', NOW(), NOW(), TRUE, 0, 'mr');
        INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active) VALUES (@org, 'ShramSafal', 0, NOW(), TRUE);
        INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
        VALUES (gen_random_uuid(), @org, @admin, 0, @admin, NOW(), TRUE);
        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
        VALUES (gen_random_uuid(), @farmB, @admin, 'Worker', NOW() - INTERVAL '30 days', NOW(), @accountB, 3, NULL, FALSE);
        """, ("admin", PlatformAdmin), ("org", Guid.Parse("3d099100-0000-4000-8000-0000000000f0")), ("farmB", FarmB), ("accountB", AccountB));

    /// <summary>The मुकादम of farm A is also an active मुकादम of farm B.</summary>
    private Task SeatMukadamOnFarmBAsync() => ExecOnSuperuserAsync("""
        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
        VALUES (gen_random_uuid(), @farmB, @mukadam, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @accountB, 3, NULL, FALSE);
        """, ("farmB", FarmB), ("mukadam", Mukadam), ("accountB", AccountB));

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99-1] {user} GET {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object? body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99-1] {user} POST {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private async Task<long> CountAsync(string sql, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("u", user);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<int> StatusOfTestAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.test_instances WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<List<string>> ItemsAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT item_name FROM ssf.price_configs WHERE item_name LIKE 'f99-%'";
        await using var reader = await cmd.ExecuteReaderAsync();
        var items = new List<string>();
        while (await reader.ReadAsync())
        {
            items.Add(reader.GetString(0));
        }

        return items;
    }
}
