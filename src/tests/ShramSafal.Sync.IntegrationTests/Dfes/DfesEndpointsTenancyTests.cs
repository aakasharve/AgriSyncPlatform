// spec: dfes-companion-2026-07-11 (Slice 6 — ICallerFarmTenantScope prelude on
// the 4 DFES HTTP endpoints).
//
// Independent end-to-end proof that the Slice-6 tenant-scope prelude actually
// makes the 4 DFES endpoints work under PRODUCTION FORCE-RLS. The per-slice unit
// tests use fake repos + a hand-set tenant, so they CANNOT exercise the real seam
// (middleware → EstablishForCallerAsync → Npgsql TenantConnectionInterceptor →
// FORCE-RLS). This test drives the ACTUAL endpoints over HTTP through the ACTUAL
// production pipeline:
//
//   TestAuthHandler ("sub" claim)                     — the JWT subject the
//                                                        endpoints self-authorize on
//   → TenantTransactionMiddleware (the real one)      — opens the per-request tx
//                                                        (DFES routes are NOT on the
//                                                        admin skip-list, so the
//                                                        middleware sets NO tenant
//                                                        claim — the endpoint's
//                                                        EstablishForCallerAsync is
//                                                        solely responsible)
//   → MapDfesEndpoints / MapDfesQuestionEndpoints      — the production route delegates
//   → EstablishForCallerAsync (membership-validated)   — sets agrisync.farm_id GUC
//   → the real handlers + IShramSafalRepository        — EF reads/writes
//   → TenantConnectionInterceptor                      — the fail-closed GUC stamper
//   → real Postgres, connected as the NON-superuser    — so FORCE-RLS genuinely
//     agrisync_app role                                   applies (a superuser would
//                                                          vacuously pass every policy)
//
// There is NO repository-level SetTenant / TenantContext.SetTenant shortcut — the
// farm scope is established ONLY the way production establishes it: at the endpoint
// edge, inside the middleware's transaction. That is the whole point of the proof.
//
// ── Attribution ──────────────────────────────────────────────────────────────
// Tagged [Trait("Category","RequiresPostgres")] and bootstrapped on native
// Postgres :5433 (Docker-free, the AdminTestFixture convention — feedback
// "avoid Docker on local dev"; the repo runs Postgres 16 natively on :5433). This
// is the same real-Postgres/agrisync_app/FORCE-RLS harness shape as
// SyncPushLedgerDerivationRealPostgresTests, extended with the HTTP + middleware
// layer. Rationale for RequiresPostgres over the Testcontainers/RequiresDocker
// sibling (DailyRichnessAggregateReadTests):
//   • RequiresDocker is EXCLUDED from BOTH CI workflows' filters
//     (`Category!=RequiresDocker`), so a RequiresDocker test would NOT run in the
//     merge gate; RequiresPostgres is INCLUDED and the gate already provisions a
//     :5433 Postgres service (ci-gate.yml / dotnet-ci.yml) → so CI RUNS this.
//   • The connection resolves from ADMIN_TESTS_ADMIN_ROOT_CONN (set by CI) →
//     appsettings.Development.json → the standard local :5433 default, so it runs
//     both in CI and on the founder's native :5433.
//   • It SELF-SKIPS cleanly when :5433 is unreachable (never a false failure).
//
// Creates its OWN scratch DB, applies the full migration chain (which creates the
// agrisync_app role + the DFES tables + their FORCE-RLS policies), and drops the
// DB on dispose.

using System;
using System.Collections.Generic;
using System.Globalization;
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
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

[Trait("Category", "RequiresPostgres")]
public sealed class DfesEndpointsTenancyTests : IClassFixture<DfesEndpointsTenancyFixture>
{
    private readonly DfesEndpointsTenancyFixture _fx;
    public DfesEndpointsTenancyTests(DfesEndpointsTenancyFixture fx) => _fx = fx;

    // ── Criterion 1 — a real farm member gets 200 on all three GETs and sees ONLY
    //    their own farm's data (never Farm B's). ─────────────────────────────────
    [SkippableFact]
    public async Task Member_gets_200_on_all_three_reads_and_sees_only_own_farm()
    {
        // spec: dfes-companion-2026-07-11 (wave-1.4) — Assert.True(true, _fx.SkipReason) here
        // used to report this proof as PASSING on any runner without Postgres on :5433, having
        // exercised nothing. Skip.If (Xunit.SkippableFact) reports the run as Skipped instead.
        Skip.If(_fx.Skip, _fx.SkipReason);

        // GET /day-understanding — the single farmer-facing /10, DERIVED server-side
        // from Farm A's seeded per-dimension breakdown (47 of 55 scored weight → 9).
        // The seeded row is a dfes-2 roster read by the dfes-3 rollup, which no longer
        // charges the unearnable LEARN_FACET (15) — hence 55, not 70.
        using (var resp = await GetAsync(DfesEndpointsTenancyFixture.MemberA,
            $"/shramsafal/day-understanding?farmId={DfesEndpointsTenancyFixture.FarmA}&date=2026-07-12"))
        {
            resp.StatusCode.Should().Be(HttpStatusCode.OK,
                "the seeded member must read Farm A's Day Understanding Score under FORCE-RLS via the scope prelude");
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            doc.RootElement.GetProperty("score").GetInt32().Should().Be(9,
                "covered ÷ scored weight = 47/55 = 0.854 → 9 — the farmer-facing /10");
        }

        // A day with NO aggregate → 200 with score:null (nothing scorable, NOT a failure).
        using (var resp = await GetAsync(DfesEndpointsTenancyFixture.MemberA,
            $"/shramsafal/day-understanding?farmId={DfesEndpointsTenancyFixture.FarmA}&date=2026-07-01"))
        {
            resp.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            doc.RootElement.GetProperty("score").ValueKind.Should().Be(JsonValueKind.Null,
                "a day with no aggregate yields score:null, never a zero");
        }

        // GET /engagement — the projection folded from Farm A's single rich day.
        using (var resp = await GetAsync(DfesEndpointsTenancyFixture.MemberA,
            $"/shramsafal/engagement?farmId={DfesEndpointsTenancyFixture.FarmA}"))
        {
            resp.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            root.GetProperty("currentStreak").GetInt32().Should().Be(1);
            root.GetProperty("longestStreak").GetInt32().Should().Be(1);
            root.GetProperty("totalShramPoints").GetInt32().Should().Be(5,
                "ONLY Farm A's 5 points — Farm B's distinctive 99 must NOT leak in");
            root.GetProperty("totalRichDays").GetInt32().Should().Be(1,
                "ONLY Farm A's single rich day — not Farm B's");
            root.GetProperty("unlockStatus").GetString().Should().Be("locked",
                "1 rich day is below the 25-day unlock threshold");
            root.GetProperty("lastAccountedDate").GetString().Should().Be("2026-07-12");
        }

        // GET /question-events/recent — the cooldown feed, farm-scoped.
        using (var resp = await GetAsync(DfesEndpointsTenancyFixture.MemberA,
            $"/shramsafal/question-events/recent?farmId={DfesEndpointsTenancyFixture.FarmA}"))
        {
            resp.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var keys = doc.RootElement.EnumerateArray()
                .Select(e => e.GetProperty("questionKey").GetString())
                .ToList();
            keys.Should().Contain("farmA.seeded.q",
                "Farm A's seeded question_event surfaces in its own recent feed");
            keys.Should().NotContain("farmB.seeded.q",
                "Farm B's question_event must NEVER cross into Farm A's feed — FORCE-RLS + farm_id filter");
        }
    }

    // ── Criterion 2 (S1-M2 proof) — POST /question-events returns 200 AND the row
    //    actually lands in ssf.question_events, proving the WITH CHECK
    //    (farm_id = agrisync.farm_id) INSERT passes under FORCE-RLS. ──────────────
    [SkippableFact]
    public async Task Post_question_event_returns_200_and_row_lands_under_force_rls()
    {
        Skip.If(_fx.Skip, _fx.SkipReason);

        var questionKey = "farmA.posted." + Guid.NewGuid().ToString("N");

        Guid insertedId;
        using (var resp = await PostAsync(DfesEndpointsTenancyFixture.MemberA,
            "/shramsafal/question-events", QuestionEventBody(DfesEndpointsTenancyFixture.FarmA, questionKey)))
        {
            resp.StatusCode.Should().Be(HttpStatusCode.OK,
                "the scope prelude set agrisync.farm_id = Farm A, so the WITH CHECK INSERT passes");
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            insertedId = doc.RootElement.GetProperty("id").GetGuid();
            insertedId.Should().NotBe(Guid.Empty);
        }

        // The load-bearing assertion: query the row back (as superuser, RLS-bypassed)
        // to prove it is DURABLE with Farm A's farm_id — the FORCE-RLS INSERT actually
        // committed, not silently rejected by the parent tenant WITH CHECK.
        (await _fx.CountQuestionEventByIdAsync(insertedId, DfesEndpointsTenancyFixture.FarmA, questionKey))
            .Should().Be(1, "the POSTed question_event must land in ssf.question_events for Farm A (S1-M2)");

        (await _fx.CountQuestionEventsAsync(DfesEndpointsTenancyFixture.FarmB, questionKey))
            .Should().Be(0, "the row must be Farm A's alone — nothing lands under Farm B");
    }

    // ── Criterion 3 — non-member / forged farmId → 403 on all 4 endpoints, with
    //    zero cross-farm rows ever written or read. ──────────────────────────────
    [SkippableFact]
    public async Task Non_member_is_forbidden_on_all_four_and_writes_nothing()
    {
        Skip.If(_fx.Skip, _fx.SkipReason);

        var farmA = DfesEndpointsTenancyFixture.FarmA;

        // A total stranger (member of NO farm) hits Farm A on all 4 endpoints.
        (await GetAsync(DfesEndpointsTenancyFixture.Stranger, $"/shramsafal/engagement?farmId={farmA}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member cannot read Farm A's engagement");
        (await GetAsync(DfesEndpointsTenancyFixture.Stranger, $"/shramsafal/day-understanding?farmId={farmA}&date=2026-07-12"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member cannot read Farm A's Day Understanding Score");
        (await GetAsync(DfesEndpointsTenancyFixture.Stranger, $"/shramsafal/question-events/recent?farmId={farmA}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member cannot read Farm A's question feed");

        var strangerKey = "stranger.attempt." + Guid.NewGuid().ToString("N");
        (await PostAsync(DfesEndpointsTenancyFixture.Stranger, "/shramsafal/question-events",
            QuestionEventBody(farmA, strangerKey)))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member cannot write a question_event to Farm A");
        (await _fx.CountQuestionEventsAsync(farmA, strangerKey))
            .Should().Be(0, "the forbidden POST must write NOTHING — no row lands for Farm A");
    }

    // ── Criterion 3 (cont.) — a caller who IS a member of Farm A but forges Farm B's
    //    id (a real farm they do NOT belong to) is denied on all 4, and no row lands
    //    under Farm B. This is the cross-farm forgery gate. ───────────────────────
    [SkippableFact]
    public async Task Member_forging_a_foreign_farm_is_forbidden_and_writes_nothing()
    {
        Skip.If(_fx.Skip, _fx.SkipReason);

        var farmB = DfesEndpointsTenancyFixture.FarmB; // MemberA is NOT a member of Farm B

        (await GetAsync(DfesEndpointsTenancyFixture.MemberA, $"/shramsafal/engagement?farmId={farmB}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "Farm A's member cannot read Farm B's engagement");
        (await GetAsync(DfesEndpointsTenancyFixture.MemberA, $"/shramsafal/day-understanding?farmId={farmB}&date=2026-07-12"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "Farm A's member cannot read Farm B's score");
        (await GetAsync(DfesEndpointsTenancyFixture.MemberA, $"/shramsafal/question-events/recent?farmId={farmB}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "Farm A's member cannot read Farm B's feed");

        var forgedKey = "forged.B." + Guid.NewGuid().ToString("N");
        (await PostAsync(DfesEndpointsTenancyFixture.MemberA, "/shramsafal/question-events",
            QuestionEventBody(farmB, forgedKey)))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "the membership-validated scope prelude denies a cross-farm write before the handler runs");
        (await _fx.CountQuestionEventsAsync(farmB, forgedKey))
            .Should().Be(0, "no cross-farm row may EVER land under Farm B from Farm A's caller");
    }

    // ────────────────────────────────────────────────────────────────────────────
    // HTTP helpers — set the JWT-subject header per request so a single shared
    // TestServer client can act as different callers.
    // ────────────────────────────────────────────────────────────────────────────
    private async Task<HttpResponseMessage> GetAsync(Guid userId, string url)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("X-Test-UserId", userId.ToString());
        return await _fx.Client.SendAsync(req);
    }

    private async Task<HttpResponseMessage> PostAsync(Guid userId, string url, object body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        req.Headers.Add("X-Test-UserId", userId.ToString());
        return await _fx.Client.SendAsync(req);
    }

    // A fully-populated, both-approved RecordQuestionEventRequest body (the handler
    // hard-gates on AgronomistApproved && MarathiApproved).
    private static object QuestionEventBody(Guid farmId, string questionKey) => new
    {
        farmId,
        plotId = (Guid?)null,
        dailyLogId = (Guid?)null,
        questionKey,
        crop = "Grapes",
        expectedStage = (string?)null,
        actualStageApplicability = (string?)null,
        anchorDateType = "Sowing",
        triggerType = "StageEntry",
        questionType = "Confirm",
        lens = "Execution",
        depthLevel = 1,
        priority = 1,
        cooldown = 7,
        answerModes = "tap",
        safetyClass = "none",
        agronomistApproved = true,
        marathiApproved = true,
        bankVersion = "v1",
        questionEngineVersion = "qe-1",
        answerObservationId = (Guid?)null,
        shownAtUtc = (DateTime?)null,
        triggerReason = (string?)null,
        weatherContext = (string?)null,
        response = (string?)null,
        stageConfirmed = (bool?)null,
        photoSubmitted = (bool?)null,
        skipped = (bool?)null,
    };
}

/// <summary>
/// Shared real-Postgres fixture: stands up a scratch DB on native :5433, applies the
/// full migration chain (creating agrisync_app + the DFES FORCE-RLS tables), seeds
/// two farms + a member + aggregate/question rows as superuser, and boots a
/// TestServer host whose ShramSafalDbContext connects as the NON-superuser
/// agrisync_app role through the production TenantConnectionInterceptor +
/// TenantTransactionMiddleware. Self-skips when :5433 is unreachable.
/// </summary>
public sealed class DfesEndpointsTenancyFixture : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    // Farm A — the caller (MemberA) is a real active MEMBER (non-owner).
    public static readonly Guid FarmA = Guid.Parse("d1e50001-0000-0000-0000-000000000001");
    public static readonly Guid OwnerA = Guid.Parse("d1e50001-0000-0000-0000-0000000000a1");
    public static readonly Guid AccountA = Guid.Parse("d1e50001-0000-0000-0000-0000000000c1");
    public static readonly Guid MemberA = Guid.Parse("d1e50001-0000-0000-0000-0000000000b1");

    // Farm B — a foreign farm MemberA does NOT belong to (cross-farm isolation).
    public static readonly Guid FarmB = Guid.Parse("d1e50002-0000-0000-0000-000000000002");
    public static readonly Guid OwnerB = Guid.Parse("d1e50002-0000-0000-0000-0000000000a2");
    public static readonly Guid AccountB = Guid.Parse("d1e50002-0000-0000-0000-0000000000c2");

    // A caller who is a member of NO farm.
    public static readonly Guid Stranger = Guid.Parse("d1e50003-0000-0000-0000-000000000003");

    private WebApplication? _app;
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _rootConn = string.Empty;

    public HttpClient Client { get; private set; } = default!;
    public bool Skip { get; private set; }
    public string SkipReason { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        _rootConn = IntegrationPostgres.ResolveRootConnection();

        // Probe :5433. A genuinely ABSENT server self-skips; a server that answers and
        // refuses us throws (see IntegrationPostgres.ProbeOrSkipReasonAsync) — a
        // misconfigured credential must never masquerade as a clean skip.
        var skipReason = await IntegrationPostgres.ProbeOrSkipReasonAsync(_rootConn);
        if (skipReason is not null)
        {
            Skip = true;
            SkipReason = skipReason;
            return;
        }

        _scratchDbName = $"ssf_dfes_tenancy_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        var appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        // Full chain: creates agrisync_app + ssf.daily_richness_aggregates +
        // ssf.question_events + their FORCE-RLS policies.
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await SeedAsync();

        _app = await BuildHostAsync(appConn);
        Client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            Client?.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (!Skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_rootConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_rootConn);
                await admin.OpenAsync();
                await using (var terminate = admin.CreateCommand())
                {
                    terminate.CommandText =
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                    terminate.Parameters.AddWithValue("db", _scratchDbName);
                    await terminate.ExecuteNonQueryAsync();
                }
                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; a leaked scratch DB is harmless.
            }
        }
    }

    // ── Readback (as superuser — RLS-bypassed — so we assert on GROUND TRUTH,
    //    not on what the RLS-scoped app connection would surface). ───────────────
    public async Task<long> CountQuestionEventsAsync(Guid farmId, string questionKey)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.question_events WHERE farm_id = @farm AND question_key = @key";
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("key", questionKey);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<long> CountQuestionEventByIdAsync(Guid id, Guid farmId, string questionKey)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText =
            "SELECT COUNT(*) FROM ssf.question_events WHERE \"Id\" = @id AND farm_id = @farm AND question_key = @key";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("key", questionKey);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    // ── Seed (superuser bypasses RLS). ──────────────────────────────────────────
    private async Task SeedAsync()
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();

        await SeedFarmAsync(c, FarmA, OwnerA, AccountA, "DFES Farm A");
        await SeedMembershipAsync(c, FarmA, MemberA, AccountA); // MemberA is an active member of A
        await SeedFarmAsync(c, FarmB, OwnerB, AccountB, "DFES Farm B");

        // Farm A: one rich day. The /10 is derived from components_json (WHAT +
        // OBS_FACET covered = 47 of 70 possible weight → 7), NOT from the lens columns.
        await SeedAggregateAsync(c, FarmA, new DateOnly(2026, 7, 12),
            exec: 80, insight: 70, learning: 60, points: 5, classification: "BasicWorkDay");
        // Farm B: a DISTINCTIVE row (99 points) so any cross-farm leak into A is visible.
        await SeedAggregateAsync(c, FarmB, new DateOnly(2026, 7, 12),
            exec: 10, insight: 10, learning: 10, points: 99, classification: "RichWorkDay");

        await SeedQuestionEventAsync(c, FarmA, "farmA.seeded.q");
        await SeedQuestionEventAsync(c, FarmB, "farmB.seeded.q");
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(NpgsqlConnection db, Guid farmId, Guid userId, Guid ownerAccountId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, 'PrimaryOwner', NOW(), NOW(), @account, 3);
            """; // status 3 = Active
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    // The farmer-facing /10 is derived from components_json (the per-dimension
    // breakdown), NOT from the three lens columns — those only carry each lens's
    // 0–100 ratio, which has already thrown the weights away. WHAT + COST +
    // OBS_FACET covered = 47 of 55 SCORED weight → 8.5 → 9. LEARN_FACET is still
    // written into the roster (this is a genuine dfes-2 row) but takes no part in
    // the /10 under dfes-3 — see DayUnderstandingScore.NotYetEarnable.
    private const string SeededComponentsJson =
        """
        {"Execution":[],"Insight":[],"Learning":[],"Possible":[
          {"Name":"WHAT","Weight":20,"Applicable":true,"Coverage":1,"ConfidenceFactor":1},
          {"Name":"COST","Weight":12,"Applicable":true,"Coverage":1,"ConfidenceFactor":1},
          {"Name":"WEATHER","Weight":8,"Applicable":true,"Coverage":0,"ConfidenceFactor":1},
          {"Name":"OBS_FACET","Weight":15,"Applicable":true,"Coverage":1,"ConfidenceFactor":1},
          {"Name":"LEARN_FACET","Weight":15,"Applicable":true,"Coverage":0,"ConfidenceFactor":1}]}
        """;

    private static async Task SeedAggregateAsync(
        NpgsqlConnection db, Guid farmId, DateOnly localDate,
        int exec, int insight, int learning, int points, string classification)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_richness_aggregates
              ("Id", farm_id, local_date, time_zone, execution_score, insight_score, learning_score,
               day_classification, has_work, has_meaningful_observation, has_learning, has_experiment_outcome,
               has_disturbance, has_declared_no_work_reason, advances_streak, advances_bar,
               shram_points_earned, reward_reasons, score_engine_version, components_json,
               created_at_utc, updated_at_utc)
            VALUES (@id, @farm, @d, 'Asia/Kolkata', @exec, @insight, @learning,
               @class, true, false, false, false, false, false, true, true,
               @points, '[]'::jsonb, 'dfes-2', @components::jsonb, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("components", SeededComponentsJson);
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("d", localDate);
        cmd.Parameters.AddWithValue("exec", exec);
        cmd.Parameters.AddWithValue("insight", insight);
        cmd.Parameters.AddWithValue("learning", learning);
        cmd.Parameters.AddWithValue("class", classification);
        cmd.Parameters.AddWithValue("points", points);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedQuestionEventAsync(NpgsqlConnection db, Guid farmId, string questionKey)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.question_events
              ("Id", farm_id, question_key, crop, anchor_date_type, trigger_type, question_type, lens,
               depth_level, priority, cooldown, answer_modes, safety_class,
               agronomist_approved, marathi_approved, bank_version, question_engine_version, created_at_utc)
            VALUES (@id, @farm, @key, 'Grapes', 'Sowing', 'StageEntry', 'Confirm', 'Execution',
               1, 1, 7, 'tap', 'none', true, true, 'v1', 'qe-1', NOW());
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("key", questionKey);
        await cmd.ExecuteNonQueryAsync();
    }

    // ── Host: the production DFES pipeline over the agrisync_app connection. ─────
    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-dfes-tenancy", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, DfesTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"dfes-tenancy-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph — registers the Npgsql ShramSafalDbContext WITH
        // the TenantConnectionInterceptor, ICallerFarmTenantScope, the DFES handlers,
        // and the ITenantScopedDbContextRegistry the middleware opens a tx on. Crucially
        // we do NOT swap in an InMemory DbContext (as the InMemory sync harness does):
        // the whole point is real Npgsql + FORCE-RLS.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // The production tenant-transaction middleware — opens the per-request
        // transaction so EstablishForCallerAsync's tx-local set_config GUCs survive
        // across the membership read + the handler's reads/writes (matches Program.cs:
        // UseAuthentication → UseAuthorization → TenantTransactionMiddleware).
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

}

/// <summary>
/// Test auth scheme: turns the X-Test-UserId header into a JWT "sub" claim — the
/// exact claim EndpointActorContext.TryGetUserId + TenantTransactionMiddleware read.
/// Every request is authenticated (RequireAuthorization passes); the DFES endpoints
/// then self-authorize the FARM via EstablishForCallerAsync, which is what this
/// suite exercises.
/// </summary>
internal sealed class DfesTestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-UserId", out var raw)
            || !Guid.TryParse(raw.ToString(), out var userId))
        {
            return Task.FromResult(AuthenticateResult.Fail("missing X-Test-UserId"));
        }

        var id = userId.ToString();
        var claims = new[]
        {
            new Claim("sub", id),
            new Claim(ClaimTypes.NameIdentifier, id),
            new Claim("membership", "shramsafal:PrimaryOwner"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        var ticket = new AuthenticationTicket(principal, Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
