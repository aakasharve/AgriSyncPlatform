// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 (register F99).
//
// Routes that answered 500 to everyone (no farm scope opened) and answer now. A door that starts answering must answer
// with its rules: on a real Postgres as agrisync_app (E3 first), through the real host —
//   - the duplicate check never becomes a way to ask about money a seat may not see (MU-3, MU-4);
//   - a record's state follows the own-records rule THROUGH THE ROUTE (MU-4 N1 proved it on the gate only);
//   - an AI job and a record of another farm are answered exactly as a made-up id (E4);
//   - his own requests about his own data are kept (P10): the data-rights screens call these;
//   - a reputation names no farm, so it is read under his own scope: his own is his; anyone else is refused (403), because
//     under his own scope another person's seats are not visible (the handler's own-records rule, R3-L1, is proved on the
//     handler in WorkerReputationOwnRecordsSeatTests).
using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class NewlyAnsweringRoutesKeepTheirRulesRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid FarmAJob = Guid.Parse("3d099000-0000-4000-8000-0000000000a9");
    private static readonly Guid FarmBJob = Guid.Parse("3d099000-0000-4000-8000-0000000000b9");

    [Fact]
    public async Task The_duplicate_check_matches_only_money_the_seat_may_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The owner's expense (seeded through the push): ₹9876.54 of fertilizer on plot A, a moment ago.
        object Probe() => new
        {
            farmId = FarmA,
            plotId = PlotA,
            cropCycleId = CycleA,
            categoryId = "fertilizer",
            amount = CostAmount,
            currencyCode = "INR",
            entryDate = WorkDay,
        };

        var (ownerStatus, ownerBody) = await PostAsync(Owner, "/shramsafal/finance/duplicate-check", Probe());
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        Json(ownerBody).GetProperty("isDuplicate").GetBoolean().Should().BeTrue("the control: the owner sees his money");
        Json(ownerBody).GetProperty("matchedEntryId").GetGuid().Should().Be(Cost);

        // A कामगार and the सहमालक whose money is switched off see no one's money: the check tells them nothing of it.
        foreach (var seat in new[] { Worker, CoOwner })
        {
            var (status, body) = await PostAsync(seat, "/shramsafal/finance/duplicate-check", Probe());
            status.Should().Be(HttpStatusCode.OK, body);
            Json(body).GetProperty("isDuplicate").GetBoolean().Should().BeFalse($"{seat} may not learn that this money exists");
            Json(body).GetProperty("matchedEntryId").ValueKind.Should().Be(JsonValueKind.Null);
            body.Should().NotContain(Cost.ToString());
        }

        (await PostAsync(OwnerB, "/shramsafal/finance/duplicate-check", Probe())).Status
            .Should().Be(HttpStatusCode.Forbidden, "another farmer is refused, as the membership check always refused him");
    }

    [Fact]
    public async Task A_records_state_follows_the_own_records_rule_through_the_route()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (own, ownBody) = await GetAsync(Worker, $"/shramsafal/logs/{WorkerLog}/transitions");
        own.Should().Be(HttpStatusCode.OK, $"his own record's state is his: {ownBody}");
        (await GetAsync(Worker, $"/shramsafal/logs/{OwnerLog}/transitions")).Status
            .Should().Be(HttpStatusCode.Forbidden, "another person's record's state is not a कामगार's (MU-4 N1)");
        (await GetAsync(Owner, $"/shramsafal/logs/{WorkerLog}/transitions")).Status.Should().Be(HttpStatusCode.OK, "the control");

        var madeUp = await GetAsync(OwnerB, $"/shramsafal/logs/{Guid.NewGuid()}/transitions");
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        var foreign = await GetAsync(OwnerB, $"/shramsafal/logs/{OwnerLog}/transitions");
        foreign.Status.Should().Be(HttpStatusCode.NotFound, "another farm's record, answered as a made-up one (E4)");
        foreign.Body.Should().Be(madeUp.Body);
    }

    [Fact]
    public async Task An_ai_job_is_read_on_its_own_farm_and_another_farms_is_answered_as_a_made_up_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedJobAsync(FarmAJob, FarmA, Owner);
        await SeedJobAsync(FarmBJob, FarmB, OwnerB);

        var (status, body) = await GetAsync(Owner, $"/shramsafal/ai/jobs/{FarmAJob}");
        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().Contain(FarmAJob.ToString());

        var madeUp = await GetAsync(Owner, $"/shramsafal/ai/jobs/{Guid.NewGuid()}");
        madeUp.Status.Should().NotBe(HttpStatusCode.OK);
        foreach (var (caller, job) in new[] { (Owner, FarmBJob), (OwnerB, FarmAJob) })
        {
            var (foreignStatus, foreignBody) = await GetAsync(caller, $"/shramsafal/ai/jobs/{job}");
            foreignStatus.Should().Be(madeUp.Status, $"{caller} {job}: {foreignBody}");
            foreignBody.Should().Be(madeUp.Body, "answered exactly as a made-up id (E4)");
        }
    }

    [Fact]
    public async Task His_own_data_requests_are_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (erasure, erasureBody) = await PostAsync(Worker, "/shramsafal/me/erasure/request", new { });
        erasure.Should().Be(HttpStatusCode.Accepted, erasureBody);
        (await CountAsync("SELECT count(*) FROM ssf.erasure_requests WHERE requested_by_user_id = @u", Worker))
            .Should().Be(1, "his erasure request is kept on the server (P10)");

        var (export, exportBody) = await PostAsync(Worker, "/shramsafal/me/export/request", new { });
        export.Should().Be(HttpStatusCode.Accepted, exportBody);
        (await CountAsync("SELECT count(*) FROM ssf.export_requests WHERE requested_by_user_id = @u", Worker))
            .Should().Be(1, "his export request is kept on the server (P10)");
    }

    [Fact]
    public async Task A_reputation_is_read_under_his_own_scope()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await GetAsync(Worker, $"/shramsafal/workers/{Worker}/reputation")).Status.Should().Be(HttpStatusCode.OK, "his own standing");
        (await GetAsync(OwnerB, $"/shramsafal/workers/{Worker}/reputation")).Status
            .Should().Be(HttpStatusCode.Forbidden, "a stranger shares no farm with him");
        (await GetAsync(Worker2, $"/shramsafal/workers/{Worker}/reputation")).Status
            .Should().Be(HttpStatusCode.Forbidden, "refused, never a made-up standing: under his own scope another worker's seats are not his to see");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99] {user} GET {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99] {user} POST {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    /// <summary>An AI job (no farmer write path makes one without a provider: the seed inserts it).</summary>
    private Task SeedJobAsync(Guid id, Guid farm, Guid user) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.ai_jobs (id, idempotency_key, operation_type, user_id, farm_id, status, normalized_result_json,
                                 schema_version, created_at_utc, completed_at_utc, total_attempts, modified_at_utc,
                                 transcript_schema_version, source, model_version, prompt_version)
        VALUES (@id, @idem, 'VoiceToStructuredLog', @user, @farm, 'Succeeded', '{}'::jsonb, '1.0.0', NOW(), NOW(), 1, NOW(),
                'v1.0', 'voice', 'f99-test', 'v1');
        """, ("id", id), ("idem", $"f99-{id:N}"), ("user", user), ("farm", farm));

    private async Task<long> CountAsync(string sql, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("u", user);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
