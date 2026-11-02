// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02:
// "D -71 option 2 not 7 days but 30 days").
//
// A "delete my data" request WAITS 30 days, and the person who asked may cancel it until then. Only after the wait is
// anything erased, and then exactly as designed. On a real Postgres: the routes run as agrisync_app through the real host
// (E3 first); the worker runs as in production (its privileged admin context), one pass at a time, against a CLOCK the
// test moves — no real wait.
//   1. a request is kept, and nothing is erased, before 30 days; after 30 days it is erased exactly as before;
//   2. cancelling while it waits stops it: nothing is erased, ever, and it no longer counts as an erasure asked for;
//   3. cancelling after it has started is refused, with its reason;
//   4. another person's request cannot be cancelled (answered as a made-up id), and is not in his list.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Auditing;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWaitsThirtyDaysRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly TimeSpan Wait = TimeSpan.FromDays(30);

    // ── 1. Kept, and nothing erased, before 30 days; erased exactly as before after them ──────

    [Fact]
    public async Task A_request_waits_thirty_days_and_is_then_erased_exactly_as_before()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (requestId, requestedAt, startsAt) = await RequestAsync(Worker);
        startsAt.Should().Be(requestedAt + Wait, "the answer carries the date erasure starts: asked + 30 days");

        // One second short of 30 days: the worker passes it by. Kept, still cancellable, nothing erased.
        await RunWorkerPassAsync(requestedAt + Wait - TimeSpan.FromSeconds(1));
        (await StatusAsync(requestId)).Should().Be(ErasureStatus.Requested);
        (await OperatorOfAsync(WorkerLog)).Should().Be(Worker, "nothing is erased before the 30 days");
        var waiting = (await ListAsync(Worker)).Single(r => r.GetProperty("requestId").GetGuid() == requestId);
        waiting.GetProperty("status").GetString().Should().Be("Requested");
        // (Postgres keeps microseconds; the answer carried the clock's 100 ns ticks.)
        waiting.GetProperty("erasureStartsAtUtc").GetDateTime().ToUniversalTime().Should().BeCloseTo(startsAt, TimeSpan.FromMilliseconds(1));
        waiting.GetProperty("mayCancel").GetBoolean().Should().BeTrue();

        // The 30 days have passed: erased exactly as before (his records are no longer his, the request says so).
        await RunWorkerPassAsync(requestedAt + Wait + TimeSpan.FromSeconds(1));
        (await StatusAsync(requestId)).Should().BeOneOf(ErasureStatus.Completed, ErasureStatus.CompletedWithResidue);
        (await OperatorOfAsync(WorkerLog)).Should().Be(SystemActor.ErasedFarmer, "the erasure ran as designed");
        (await ScalarAsync<int?>("SELECT rows_anonymized_count FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))
            .Should().BeGreaterThan(0);
        // Started is started: it can no longer be cancelled.
        (await CancelAsync(Worker, requestId)).Status.Should().Be(HttpStatusCode.Conflict);
    }

    // ── 2. Cancelled while it waits: stopped, nothing erased ──────────────────────────────────

    [Fact]
    public async Task Cancelling_while_it_waits_stops_it_and_nothing_is_ever_erased()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (requestId, requestedAt, _) = await RequestAsync(Worker);
        (await ErasureAskedAsync(Worker)).Should().BeTrue("a waiting request already counts as an erasure asked for");

        var (cancelled, cancelledBody) = await CancelAsync(Worker, requestId);
        cancelled.Should().Be(HttpStatusCode.OK, cancelledBody);
        Json(cancelledBody).GetProperty("status").GetString().Should().Be("Cancelled");
        (await StatusAsync(requestId)).Should().Be(ErasureStatus.Cancelled);
        (await ScalarAsync<DateTime?>("SELECT completed_at_utc FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))
            .Should().NotBeNull("the time it was cancelled is kept");
        (await ScalarAsync<long>(
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureRequest' AND entity_id = @id AND action = 'Cancelled'",
            ("id", requestId))).Should().Be(1, "the cancel is on the record");
        // A second tap answers the same truth.
        (await CancelAsync(Worker, requestId)).Status.Should().Be(HttpStatusCode.OK);

        // Long after the 30 days: the worker never takes it.
        await RunWorkerPassAsync(requestedAt + Wait + TimeSpan.FromDays(10));
        (await StatusAsync(requestId)).Should().Be(ErasureStatus.Cancelled);
        (await OperatorOfAsync(WorkerLog)).Should().Be(Worker, "a cancelled request erases nothing");
        (await ErasureAskedAsync(Worker)).Should().BeFalse("he took it back: it no longer withholds his permission or his voice");
        var listed = (await ListAsync(Worker)).Single(r => r.GetProperty("requestId").GetGuid() == requestId);
        listed.GetProperty("status").GetString().Should().Be("Cancelled");
        listed.GetProperty("mayCancel").GetBoolean().Should().BeFalse();
    }

    // ── 3. Cancelling after it has started is refused ────────────────────────────────────────

    [Fact]
    public async Task Cancelling_after_it_has_started_is_refused_with_its_reason()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (requestId, _, _) = await RequestAsync(Worker);

        // The worker has taken it (its guarded claim): InProgress.
        await ExecOnSuperuserAsync("UPDATE ssf.erasure_requests SET status = 1 WHERE id = @id", ("id", requestId));
        var (refused, refusedBody) = await CancelAsync(Worker, requestId);
        refused.Should().Be(HttpStatusCode.Conflict, refusedBody);
        Json(refusedBody).GetProperty("error").GetString().Should().Be("ShramSafal.ErasureRequest.AlreadyStarted");
        Json(refusedBody).GetProperty("message").GetString().Should().Contain("already started");
        (await StatusAsync(requestId)).Should().Be(ErasureStatus.InProgress, "a started erasure is not touched");

        // And once it has ended, the same.
        await ExecOnSuperuserAsync("UPDATE ssf.erasure_requests SET status = 2, completed_at_utc = now() WHERE id = @id", ("id", requestId));
        (await CancelAsync(Worker, requestId)).Status.Should().Be(HttpStatusCode.Conflict);
        (await StatusAsync(requestId)).Should().Be(ErasureStatus.Completed);
    }

    // ── 4. Another person's request ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Another_persons_request_cannot_be_cancelled_and_is_answered_as_a_made_up_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (requestId, _, _) = await RequestAsync(Worker);

        var madeUp = await CancelAsync(Worker2, Guid.NewGuid());
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        foreach (var other in new[] { Worker2, Owner })
        {
            var (status, body) = await CancelAsync(other, requestId);
            status.Should().Be(HttpStatusCode.NotFound, $"{other} did not ask for it");
            body.Should().Be(madeUp.Body, "no hint that another person's request exists (E4)");
            (await ListAsync(other)).Select(r => r.GetProperty("requestId").GetGuid()).Should().NotContain(requestId);
        }

        (await StatusAsync(requestId)).Should().Be(ErasureStatus.Requested, "his request is untouched");
        // His own cancel still works: the refusal above was about the person, not the request.
        (await CancelAsync(Worker, requestId)).Status.Should().Be(HttpStatusCode.OK);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    /// <summary>The phone's request (1.0.17 and later): 202, with the date erasure starts.</summary>
    private async Task<(Guid Id, DateTime RequestedAt, DateTime StartsAt)> RequestAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shramsafal/me/erasure/request", user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[D-71] {user} POST /shramsafal/me/erasure/request -> {(int)response.StatusCode} {text}");
        response.StatusCode.Should().Be(HttpStatusCode.Accepted, text);
        var body = Json(text);
        return (body.GetProperty("requestId").GetGuid(),
            body.GetProperty("requestedAtUtc").GetDateTime().ToUniversalTime(),
            body.GetProperty("erasureStartsAtUtc").GetDateTime().ToUniversalTime());
    }

    private async Task<(HttpStatusCode Status, string Body)> CancelAsync(Guid user, Guid requestId)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/me/erasure/{requestId}/cancel", user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[D-71] {user} cancel {requestId} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<List<JsonElement>> ListAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, "/shramsafal/me/erasure/requests", user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[D-71] {user} GET /shramsafal/me/erasure/requests -> {(int)response.StatusCode} {text}");
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return Json(text).EnumerateArray().ToList();
    }

    /// <summary>The same check the improvement permission and the voice replay ask, in the host as agrisync_app.</summary>
    private async Task<bool> ErasureAskedAsync(Guid user)
    {
        await using var scope = HostServices.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IAccountErasureCheck>().IsErasureRequestedAsync(user);
    }

    /// <summary>
    /// ONE worker pass, as production runs it (its privileged admin context on the migration role), at <paramref name="now"/>.
    /// </summary>
    private async Task RunWorkerPassAsync(DateTime now)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = SuperuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
                ["ConnectionStrings:UserDb"] = SuperuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        services.AddSingleton<TimeProvider>(new FixedClock(now));
        await using var provider = services.BuildServiceProvider();

        var worker = new ErasureWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        await worker.RunPassAsync(CancellationToken.None);
        Output.WriteLine($"[D-71] one worker pass at {now:O}");
    }

    private async Task<ErasureStatus> StatusAsync(Guid requestId)
        => (ErasureStatus)(await ScalarAsync<int>("SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)));

    private Task<Guid> OperatorOfAsync(Guid logId)
        => ScalarAsync<Guid>("SELECT operator_user_id FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId));

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is null or DBNull ? default! : (T)scalar;
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private sealed class FixedClock(DateTime nowUtc) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc));
    }
}
