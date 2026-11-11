using System.Security.Claims;
using System.Text.Json;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Proves the WIRING, not just the parts. Task 1 stamps, Task 4 builds; this
/// asserts that a stamped result executed through the real middleware produces
/// a row that names the error — and that an exception escaping the endpoint
/// produces a row at all, which it does not today.
/// </summary>
public sealed class RequestObservabilityMiddlewareTests
{
    private sealed class CapturingWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();

        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            lock (Events) { Events.Add(e); }
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> es, CancellationToken ct = default)
        {
            lock (Events) { Events.AddRange(es); }
            return Task.CompletedTask;
        }
    }

    private static (RequestObservabilityMiddleware Mw, CapturingWriter Writer) Build(RequestDelegate next)
    {
        var writer = new CapturingWriter();
        var services = new ServiceCollection();
        services.AddScoped<IAnalyticsWriter>(_ => writer);
        var provider = services.BuildServiceProvider();

        var mw = new RequestObservabilityMiddleware(
            next,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RequestObservabilityMiddleware>.Instance);

        return (mw, writer);
    }

    /// <summary>
    /// The emit is fire-and-forget (Task.Run) by design — observability must
    /// never hold up a farmer's request — so poll rather than sleep a fixed time.
    /// </summary>
    private static async Task<AnalyticsEvent?> WaitForEvent(CapturingWriter w)
    {
        for (var i = 0; i < 200; i++)
        {
            lock (w.Events) { if (w.Events.Count > 0) return w.Events[0]; }
            await Task.Delay(25);
        }
        return null;
    }

    private static DefaultHttpContext WriteContext() => new()
    {
        Response = { Body = new MemoryStream() },
        RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        Request = { Method = "POST", Path = "/shramsafal/logs" },
    };

    /// <summary>
    /// <see cref="WriteContext"/> for any method and path. <c>/shramsafal/logs</c>
    /// is one of the middleware's critical paths, so the api.refused tests
    /// (which are about every OTHER write route) cannot use it.
    /// </summary>
    private static DefaultHttpContext ContextFor(string method, string path) => new()
    {
        Response = { Body = new MemoryStream() },
        RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        Request = { Method = method, Path = path },
    };

    /// <summary>
    /// A signed-in caller, shaped like the principal the JWT handler builds:
    /// an AUTHENTICATED identity (the authentication type is what makes
    /// <c>IsAuthenticated</c> true) whose <c>sub</c> claim is the user id, and
    /// optionally the <c>farm_id</c> claim the middleware has always read for
    /// the <c>farm_id</c> column. A context left alone carries the framework's
    /// default principal — unauthenticated, no claims — which is "nobody".
    /// </summary>
    private static ClaimsPrincipal SignedIn(Guid userId, Guid? farmClaim = null)
    {
        var claims = new List<Claim> { new("sub", userId.ToString("D")) };
        if (farmClaim is { } farm)
        {
            claims.Add(new Claim("farm_id", farm.ToString("D")));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "Test"));
    }

    private static RequestDelegate Answering(int status) => ctx =>
    {
        ctx.Response.StatusCode = status;
        return Task.CompletedTask;
    };

    private static Dictionary<string, JsonElement> PropsOf(AnalyticsEvent ev) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;

    /// <summary>
    /// Every row a request produced, not only the first: waits for the first
    /// (or gives up, exactly as <see cref="WaitForEvent"/> does), then leaves
    /// the same grace period the cancelled-request test uses so a second row
    /// would have landed. This is what "one row" and "no api.error row" need.
    /// </summary>
    private static async Task<List<AnalyticsEvent>> SettledEvents(CapturingWriter w)
    {
        await WaitForEvent(w);
        await Task.Delay(300);
        lock (w.Events) { return w.Events.ToList(); }
    }

    [Fact]
    public async Task A_stamped_error_result_produces_a_row_that_names_the_error()
    {
        var error = ShramSafal.Domain.Common.ShramSafalErrors.CropCycleOverlap;

        var (mw, writer) = Build(async ctx =>
            await ErrorCapture.Stamp(error, Results.Conflict(new { error = error.Code }))
                .ExecuteAsync(ctx));

        await mw.InvokeAsync(WriteContext());

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("ShramSafal.CropCycleOverlap",
            "the endpoint knew which error it was answering; the record has to know too");
        props["statusCode"].GetInt32().Should().Be(409);
        props["workKept"].GetString().Should().Be("unknown");
    }

    [Fact]
    public async Task An_exception_escaping_the_endpoint_produces_a_row_naming_its_type()
    {
        // Before 2026-08-30 this produced NOTHING: InvokeAsync had no try, and
        // UseExceptionHandler is registered outside this middleware
        // (Program.cs:542 vs :581), so the exception unwound past every line
        // that builds and emits the event.
        var (mw, writer) = Build(_ => throw new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => mw.InvokeAsync(WriteContext()));

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull("an unhandled exception is the failure a developer most needs recorded");

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev!.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("Exception:InvalidOperationException");
        props["statusCode"].GetInt32().Should().Be(500,
            "the response had not been written when the exception passed through, so the "
            + "status is asserted from the exception rather than read from ctx.Response");
        props.Should().NotContainKey("exceptionMessage",
            "analytics.events is append-only and an exception message can carry the payload");
    }

    /// <summary>
    /// The claim this whole task rests on, proved through the REAL pipeline
    /// rather than by calling InvokeAsync directly: an exception thrown by an
    /// endpoint produces (a) an analytics row naming its type and (b) a 500
    /// written by the handler that is registered OUTSIDE this middleware.
    ///
    /// <para>
    /// Both halves matter and neither implies the other. Recording the failure
    /// must not swallow it — if the catch did not rethrow, the row would appear
    /// and the farmer would get a hung request or a 200. If the middleware did
    /// not catch at all (the state before 2026-08-31) the 500 would appear and
    /// the row would not. The pipeline here is assembled in the same ORDER as
    /// Program.cs:542/:581 — UseExceptionHandler first, so it sits further out —
    /// because that ordering is precisely what made the emit unreachable.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_exception_is_recorded_AND_still_reaches_the_upstream_handler()
    {
        var writer = new CapturingWriter();

        using var host = await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddLogging();
                    services.AddProblemDetails();
                    services.AddExceptionHandler<GlobalExceptionHandler>();
                    services.AddScoped<IAnalyticsWriter>(_ => writer);
                })
                .Configure(app =>
                {
                    // Same order as Program.cs — the handler is registered
                    // first, so it wraps the observability middleware.
                    app.UseExceptionHandler();
                    app.UseMiddleware<RequestObservabilityMiddleware>();
                    app.Run(_ => throw new InvalidOperationException(
                        "farmer transcript that must never be recorded"));
                }))
            .StartAsync();

        var response = await host.GetTestClient()
            .PostAsync("/shramsafal/logs", new StringContent(string.Empty));

        // (b) The exception was not swallowed: it propagated out of this
        // middleware and GlobalExceptionHandler produced the 500.
        ((int)response.StatusCode).Should().Be(500,
            "the catch rethrows — recording a failure must never consume it");

        // (a) And it was recorded, which before this task it was not.
        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull(
            "an endpoint that crashed is the failure a developer most needs recorded, and "
            + "until 2026-08-31 it produced no row at all");
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("Exception:InvalidOperationException");
        props["statusCode"].GetInt32().Should().Be(500);
        props["workKept"].GetString().Should().Be("unknown",
            "nothing observed whether the write survived, and 'kept' is never inferred");

        // The exception MESSAGE stands in for a farmer's own words here. It may
        // not appear anywhere in the row: analytics.events is append-only
        // (DO INSTEAD NOTHING on UPDATE/DELETE), so it could never be scrubbed.
        ev.PropsJson.Should().NotContain("farmer transcript");
        ev.PropsJson.Should().NotContain("must never be recorded");
    }

    [Fact]
    public async Task A_cancelled_request_is_not_reported_as_a_server_failure()
    {
        // A farmer on Jio closing the tab is not a 500. GlobalExceptionHandler
        // makes the same distinction (returns false for a cancelled request).
        var (mw, writer) = Build(_ => throw new OperationCanceledException());

        var ctx = WriteContext();
        ctx.RequestAborted = new CancellationToken(canceled: true);

        await Assert.ThrowsAsync<OperationCanceledException>(() => mw.InvokeAsync(ctx));

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }

    // ------------------------------------------------------------------
    // spec: control-room-go-live-must-haves-2026-11-10
    // ADR 0027 D3 / D4 — plan CR-1a Task B1: the row names the person, and
    // the two columns the activity numbers count do not move.
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_error_row_names_the_signed_in_person()
    {
        var userId = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");
        var (mw, writer) = Build(Answering(StatusCodes.Status500InternalServerError));

        var ctx = WriteContext();
        ctx.User = SignedIn(userId);

        await mw.InvokeAsync(ctx);

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = PropsOf(ev);
        props.Should().ContainKey("personId",
            "a failure recorded as a time, a path and a status cannot be followed up with anyone");
        props["personId"].GetString().Should().Be("aaaaaaaa-1111-2222-3333-444444444444");
    }

    [Fact]
    public async Task An_anonymous_error_row_has_no_person()
    {
        var (mw, writer) = Build(Answering(StatusCodes.Status500InternalServerError));

        // No principal set: the framework default, unauthenticated and claimless.
        await mw.InvokeAsync(WriteContext());

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull("a server failure from nobody is still a server failure, and is still recorded");
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        // Absent — not null, not an empty id. The key is looked for in the
        // serialized row, which is what analytics.events actually stores.
        PropsOf(ev).Should().NotContainKey("personId",
            "a value that was not captured is an absent key (Doctrine P4), never a placeholder");
    }

    /// <summary>
    /// ADR 0027 D4. <c>mis.alert_r2_wau_vs_wvfd</c> and the retention views
    /// count any event whose <c>actor_user_id</c> is set; the suffering list
    /// counts rows by <c>farm_id</c>. So knowing who hit an error must not
    /// make them "active", and knowing which farm a request addressed must not
    /// make that farm "suffering": the person and the addressed farm live in
    /// props, and both columns are written exactly as before.
    /// </summary>
    [Fact]
    public async Task The_actor_and_farm_columns_are_written_as_before()
    {
        var userId = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");
        var claimFarm = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var addressedFarm = Guid.Parse("bbbbbbbb-1111-2222-3333-444444444444");
        const string path = "/shramsafal/farms/bbbbbbbb-1111-2222-3333-444444444444/logs";

        // A signed-in person whose token carries one farm, addressing ANOTHER.
        var (mw, writer) = Build(Answering(StatusCodes.Status500InternalServerError));
        var ctx = ContextFor("POST", path);
        ctx.User = SignedIn(userId, farmClaim: claimFarm);
        ctx.Request.RouteValues["farmId"] = addressedFarm.ToString("D");

        await mw.InvokeAsync(ctx);

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.ActorUserId.HasValue.Should().BeFalse(
            "actor_user_id stays null on a middleware row: a person who only hit an error "
            + "must not be counted as weekly-active by a side effect");
        ev.FarmId.HasValue.Should().BeTrue("farm_id is still written from the claim");
        ev.FarmId!.Value.Value.Should().Be(claimFarm,
            "farm_id is the CLAIM farm, as before — never the farm the route addressed");

        // The same request from a token with no farm claim: the column is
        // null. The addressed farm is not allowed to fill the gap.
        var (mw2, writer2) = Build(Answering(StatusCodes.Status500InternalServerError));
        var ctx2 = ContextFor("POST", path);
        ctx2.User = SignedIn(userId);
        ctx2.Request.RouteValues["farmId"] = addressedFarm.ToString("D");

        await mw2.InvokeAsync(ctx2);

        var ev2 = await WaitForEvent(writer2);
        ev2.Should().NotBeNull();
        ev2!.ActorUserId.HasValue.Should().BeFalse("actor_user_id stays null on a middleware row");
        ev2.FarmId.HasValue.Should().BeFalse(
            "with no farm claim the farm_id column is null, as before; the route's farm "
            + "belongs in props.routeFarmId and would move the suffering list if written here");
    }

    // ------------------------------------------------------------------
    // ADR 0027 D3 — plan CR-1a Task K2: the codes an endpoint stamps reach
    // the sync.mutation_rejected row.
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_middleware_passes_stamped_codes_to_the_row()
    {
        // The "endpoint": answers 200 while refusing three saves inside it,
        // and says so the only way a 200 can — on HttpContext.Items, exactly
        // where SyncEndpoints stamps the count today.
        var (mw, writer) = Build(ctx =>
        {
            ctx.Items[RequestObservabilityKeys.RejectedWorkItemCount] = 3;
            ctx.Items[RequestObservabilityKeys.RejectedWorkReason] = "sync.mutation_rejected";
            ctx.Items[RequestObservabilityKeys.RejectedWorkCodes] =
                new[] { "ShramSafal.CropCycleOverlap", "ShramSafal.DuplicateLogRequest" };
            ctx.Response.StatusCode = StatusCodes.Status200OK;
            return Task.CompletedTask;
        });

        await mw.InvokeAsync(ContextFor("POST", "/sync/push"));

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.EventType.Should().Be(AnalyticsEventType.SyncMutationRejected);

        var props = PropsOf(ev);
        props.Should().ContainKey("rejectedWorkCodes",
            "a refused sync save used to record only a count; the count cannot say WHAT was refused");
        props["rejectedWorkCodes"].ValueKind.Should().Be(JsonValueKind.Array);
        props["rejectedWorkCodes"].EnumerateArray().Select(c => c.GetString())
            .Should().Equal("ShramSafal.CropCycleOverlap", "ShramSafal.DuplicateLogRequest");
        props["rejectedWorkItems"].GetInt32().Should().Be(3, "the count that was already recorded is unchanged");
    }

    // ------------------------------------------------------------------
    // ADR 0027 D1 — plan CR-1a Task K3: api.refused.
    //
    // The rule, all four parts at once: a WRITE, answered 400-499 but not
    // 401, on a path matching NO entry of CriticalPathFragments, from a
    // SIGNED-IN request. Each test below removes exactly one part.
    //
    // /shramsafal/cropcycles is used because it matches none of the critical
    // fragments (/logs, /sync/push, /ai/parse-voice, /ai/extract,
    // /schedule/adopt|migrate|abandon, /farms, /verif).
    // ------------------------------------------------------------------

    private const string NonCriticalPath = "/shramsafal/cropcycles";

    [Fact]
    public async Task A_refused_write_outside_the_critical_paths_is_recorded_as_api_refused()
    {
        var userId = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");
        var error = ShramSafal.Domain.Common.ShramSafalErrors.CropCycleOverlap;

        var (mw, writer) = Build(async ctx =>
            await ErrorCapture.Stamp(error, Results.Conflict(new { error = error.Code }))
                .ExecuteAsync(ctx));

        var ctx = ContextFor("POST", NonCriticalPath);
        ctx.User = SignedIn(userId);
        ctx.Request.Headers["X-App-Version"] = "1.0.18";

        await mw.InvokeAsync(ctx);

        var events = await SettledEvents(writer);
        events.Should().ContainSingle(
            "before ADR 0027 a refusal on any of about sixty write routes outside the "
            + "critical list left no row at all; it is one refusal, so it is one row");

        var ev = events[0];
        AnalyticsEventType.ApiRefused.Should().Be("api.refused");
        ev.EventType.Should().Be("api.refused");

        var props = PropsOf(ev);
        props["errorCode"].GetString().Should().Be("ShramSafal.CropCycleOverlap",
            "the mapper stamped which refusal it was; the row has to name it");
        props["statusCode"].GetInt32().Should().Be(409);

        // The spec's walkthrough for exactly this moment: the row carries the
        // person and the app version. And D4: the person is in props, NOT in
        // the actor_user_id column, or every refused save would count its
        // sender as weekly-active.
        props["personId"].GetString().Should().Be("aaaaaaaa-1111-2222-3333-444444444444");
        props["appVersion"].GetString().Should().Be("1.0.18");
        ev.ActorUserId.HasValue.Should().BeFalse("actor_user_id stays null on a middleware row");
    }

    [Fact]
    public async Task A_refused_write_is_never_an_api_error()
    {
        // mis.alert_r9_api_error_spike counts event_type = 'api.error' over the
        // last hour and pages the founder. A farmer correcting a refused save
        // five times is not an API failure, so none of these may add to it.
        // Every write method, across the 4xx range and at both of its ends.
        (string Method, int Status)[] refusals =
        [
            ("POST", 400), ("PUT", 403), ("PATCH", 404), ("DELETE", 409), ("POST", 422), ("POST", 499),
        ];

        foreach (var (method, status) in refusals)
        {
            var (mw, writer) = Build(Answering(status));
            var ctx = ContextFor(method, NonCriticalPath);
            ctx.User = SignedIn(Guid.NewGuid());

            await mw.InvokeAsync(ctx);

            var events = await SettledEvents(writer);

            // Not vacuous: the refusal IS recorded...
            events.Should().NotBeEmpty($"a signed-in {method} answered {status} is a refusal worth a row");
            // ...and under its own type.
            events.Should().NotContain(e => e.EventType == AnalyticsEventType.ApiError,
                $"a {method} answered {status} outside the critical paths must not move the error-spike warning");
            events.Should().OnlyContain(e => e.EventType == AnalyticsEventType.ApiRefused);
        }
    }

    [Fact]
    public async Task A_refused_write_on_a_critical_path_is_still_an_api_error()
    {
        // Everything that is api.error today stays api.error. Being signed in
        // is the new fact about this request, and it must not reclassify it.
        var (mw, writer) = Build(Answering(StatusCodes.Status400BadRequest));
        var ctx = ContextFor("POST", "/sync/push");
        ctx.User = SignedIn(Guid.NewGuid());

        await mw.InvokeAsync(ctx);

        var events = await SettledEvents(writer);
        events.Should().ContainSingle("one request is one row: api.error, and not an api.refused beside it");
        events[0].EventType.Should().Be(AnalyticsEventType.ApiError);
        PropsOf(events[0])["statusCode"].GetInt32().Should().Be(400);

        // And from nobody, as today: a critical-path 4xx never depended on
        // who sent it, and the signed-in condition belongs to api.refused only.
        var (mw2, writer2) = Build(Answering(StatusCodes.Status400BadRequest));

        await mw2.InvokeAsync(ContextFor("POST", "/sync/push"));

        var anonymous = await SettledEvents(writer2);
        anonymous.Should().ContainSingle();
        anonymous[0].EventType.Should().Be(AnalyticsEventType.ApiError);
    }

    [Fact]
    public async Task An_anonymous_refused_write_is_not_recorded()
    {
        var error = ShramSafal.Domain.Common.ShramSafalErrors.CropCycleOverlap;

        var (mw, writer) = Build(async ctx =>
            await ErrorCapture.Stamp(error, Results.Conflict(new { error = error.Code }))
                .ExecuteAsync(ctx));

        // The same refusal as the recorded one, with the person removed.
        // Anyone on the internet can make a server answer 4xx; recording those
        // would let a stranger fill an append-only store.
        await mw.InvokeAsync(ContextFor("POST", NonCriticalPath));

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }

    [Fact]
    public async Task A_401_is_not_recorded()
    {
        // Signed in on purpose, so that the status is the ONLY part of the
        // rule this request fails. (A 401 on a critical path is an api.error
        // today and stays one; that is not this test.)
        var (mw, writer) = Build(Answering(StatusCodes.Status401Unauthorized));
        var ctx = ContextFor("POST", NonCriticalPath);
        ctx.User = SignedIn(Guid.NewGuid());

        await mw.InvokeAsync(ctx);

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }

    [Fact]
    public async Task A_refused_read_is_not_recorded()
    {
        // A GET that finds nothing blocked no one's work.
        var (mw, writer) = Build(Answering(StatusCodes.Status404NotFound));
        var ctx = ContextFor("GET", NonCriticalPath);
        ctx.User = SignedIn(Guid.NewGuid());

        await mw.InvokeAsync(ctx);

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }
}
