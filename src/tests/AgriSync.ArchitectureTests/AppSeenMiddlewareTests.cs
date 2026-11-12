using System.Security.Claims;
using System.Text.Json;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (ADR 0028, plan CR-1c Task V1).
///
/// <para>
/// <c>AppSeenMiddleware</c> notes, at most once per person, app version and
/// UTC day, that a signed-in person used the farmer app on a version. These
/// tests hold the three promises that make that safe to put on every
/// signed-in request:
/// </para>
/// <list type="number">
/// <item>it records only what it was really told (a person, and a
/// well-formed version that starts with a digit), and only once a day;</item>
/// <item>the row leaves <c>actor_user_id</c> and <c>farm_id</c> empty, so
/// merely opening the app never moves the weekly-active, retention or
/// suffering numbers, and it carries no device identifier;</item>
/// <item>recording can never cost a request: a failing writer does not fail
/// it, and a failing request is still recorded.</item>
/// </list>
///
/// <para>
/// The harness is the one <see cref="RequestObservabilityMiddlewareTests"/>
/// uses: a hand-built <see cref="DefaultHttpContext"/>, a principal shaped
/// like the JWT handler's, a real <see cref="IServiceScopeFactory"/> that
/// hands out a capturing <see cref="IAnalyticsWriter"/>, and polling for the
/// fire-and-forget write. The de-duplication is a field of the middleware
/// instance, so a test about two requests sends both through ONE instance.
/// </para>
///
/// <para>
/// A test that expects NO row would pass against a harness that could never
/// capture one. So each of those sends a control request afterwards, through
/// the same instance, that must be recorded, and asserts that the control's
/// row is the only row.
/// </para>
///
/// <para>
/// Not tested here, stated plainly: the cap of 50,000 claims a day, and that
/// a writer which hangs does not hold the request up.
/// </para>
/// </summary>
public sealed class AppSeenMiddlewareTests
{
    private const string SunitaId = "aaaaaaaa-1111-2222-3333-444444444444";
    private const string RameshId = "bbbbbbbb-1111-2222-3333-444444444444";

    private static readonly Guid Sunita = Guid.Parse(SunitaId);
    private static readonly Guid Ramesh = Guid.Parse(RameshId);

    /// <summary>08:00 UTC on 12 November 2026.</summary>
    private static readonly DateTimeOffset Morning = new(2026, 11, 12, 8, 0, 0, TimeSpan.Zero);

    // ------------------------------------------------------------------
    // Fakes
    // ------------------------------------------------------------------

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

    /// <summary>
    /// The analytics store is down. It throws the moment it is asked, on the
    /// caller's own thread, which is the harshest way a writer can fail.
    /// </summary>
    private sealed class ThrowingWriter : IAnalyticsWriter
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _calls);
            throw new InvalidOperationException("the analytics store is down");
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> es, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _calls);
            throw new InvalidOperationException("the analytics store is down");
        }
    }

    /// <summary>
    /// A clock the test moves by hand. Its local time zone is five and a half
    /// hours ahead of UTC on every machine, on purpose: the day that counts is
    /// the UTC day, and with this zone a middleware that used the local day
    /// would get both day tests wrong wherever they run.
    /// </summary>
    private sealed class MovableClock(DateTimeOffset start) : TimeProvider
    {
        private readonly object _gate = new();
        private DateTimeOffset _now = start;

        public override TimeZoneInfo LocalTimeZone { get; } =
            TimeZoneInfo.CreateCustomTimeZone("test+05:30", TimeSpan.FromMinutes(330), "test+05:30", "test+05:30");

        public override DateTimeOffset GetUtcNow()
        {
            lock (_gate) { return _now; }
        }

        public void Advance(TimeSpan by)
        {
            lock (_gate) { _now += by; }
        }
    }

    /// <summary>Records the level of everything the middleware logs.</summary>
    private sealed class CapturingLogger : ILogger<AppSeenMiddleware>
    {
        private readonly List<LogLevel> _levels = new();

        public bool HasWarning
        {
            get
            {
                lock (_levels) { return _levels.Contains(LogLevel.Warning); }
            }
        }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (_levels) { _levels.Add(logLevel); }
        }
    }

    /// <summary>
    /// The rest of the pipeline: counts how often it ran and answers 204, so a
    /// test can say the request went through and came back as the endpoint
    /// answered it.
    /// </summary>
    private sealed class CountingNext
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        public Task Invoke(HttpContext ctx)
        {
            Interlocked.Increment(ref _calls);
            ctx.Response.StatusCode = StatusCodes.Status204NoContent;
            return Task.CompletedTask;
        }
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private static (AppSeenMiddleware Mw, CapturingWriter Writer) Build(RequestDelegate next, TimeProvider clock)
    {
        var writer = new CapturingWriter();
        var services = new ServiceCollection();
        services.AddScoped<IAnalyticsWriter>(_ => writer);
        var provider = services.BuildServiceProvider();

        var mw = new AppSeenMiddleware(
            next,
            provider.GetRequiredService<IServiceScopeFactory>(),
            clock,
            NullLogger<AppSeenMiddleware>.Instance);

        return (mw, writer);
    }

    /// <summary>
    /// One request. The default is a READ (<c>GET /sync/pull</c>): a person
    /// who opens the app and saves nothing is exactly who this middleware is
    /// for. A null <paramref name="user"/> leaves the framework's default
    /// principal, which is "nobody"; a null header value sends no header.
    /// </summary>
    private static DefaultHttpContext Request(
        ClaimsPrincipal? user,
        string? appVersion,
        string? platform = null,
        string method = "GET",
        string path = "/sync/pull")
    {
        var ctx = new DefaultHttpContext
        {
            Response = { Body = new MemoryStream() },
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
            Request = { Method = method, Path = path },
        };

        if (user is not null)
        {
            ctx.User = user;
        }

        if (appVersion is not null)
        {
            ctx.Request.Headers["X-App-Version"] = appVersion;
        }

        if (platform is not null)
        {
            ctx.Request.Headers["X-Client-Platform"] = platform;
        }

        return ctx;
    }

    /// <summary>
    /// A signed-in caller, shaped like the principal the JWT handler builds:
    /// an AUTHENTICATED identity whose <c>sub</c> claim is the user id, and
    /// optionally the <c>farm_id</c> claim.
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

    private static Dictionary<string, JsonElement> PropsOf(AnalyticsEvent ev) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;

    // A JSON null reads back as the text "(null)", which equals no id and no
    // version, so an assertion on it fails and says what it found.
    private static string PersonOf(AnalyticsEvent ev) => PropsOf(ev)["personId"].GetString() ?? "(null)";

    private static string VersionOf(AnalyticsEvent ev) => PropsOf(ev)["appVersion"].GetString() ?? "(null)";

    /// <summary>
    /// The write is fire-and-forget (Task.Run) by design, so poll rather than
    /// sleep a fixed time. Returns whatever has landed once
    /// <paramref name="count"/> rows are there, or after five seconds.
    /// </summary>
    private static async Task<List<AnalyticsEvent>> WaitForCount(CapturingWriter w, int count)
    {
        for (var i = 0; i < 200; i++)
        {
            lock (w.Events)
            {
                if (w.Events.Count >= count)
                {
                    break;
                }
            }

            await Task.Delay(25);
        }

        lock (w.Events) { return w.Events.ToList(); }
    }

    /// <summary>
    /// Every row the requests produced, not only the expected ones: waits for
    /// <paramref name="expected"/> rows, then leaves the same grace period the
    /// neighbouring middleware tests use, so a row that should NOT exist would
    /// have landed. This is what "one row" and "writes nothing" need.
    /// </summary>
    private static async Task<List<AnalyticsEvent>> SettledEvents(CapturingWriter w, int expected)
    {
        await WaitForCount(w, expected);
        await Task.Delay(300);
        lock (w.Events) { return w.Events.ToList(); }
    }

    private static async Task<bool> Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 200; i++)
        {
            if (condition())
            {
                return true;
            }

            await Task.Delay(25);
        }

        return condition();
    }

    // ------------------------------------------------------------------
    // What is recorded, and how often
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_signed_in_request_with_a_version_is_seen_once()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // Sunita opens the app in the morning and saves nothing: a read.
        var ctx = Request(SignedIn(Sunita), appVersion: "1.0.18");
        await mw.InvokeAsync(ctx);

        next.Calls.Should().Be(1, "the middleware passes the request on, exactly once");
        ctx.Response.StatusCode.Should().Be(StatusCodes.Status204NoContent,
            "the answer is the endpoint's own; recording changes no response");
        ctx.Response.Headers.Count.Should().Be(0, "recording adds no header to the response");

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle("one request from one person on one version is one row");

        var ev = events[0];
        AnalyticsEventType.AppSeen.Should().Be("app.seen");
        ev.EventType.Should().Be("app.seen");

        var props = PropsOf(ev);
        props.Should().ContainKey("appVersion");
        props["appVersion"].GetString().Should().Be("1.0.18");
        props.Should().ContainKey("personId");
        props["personId"].GetString().Should().Be(SunitaId,
            "the person is recorded in the D format (lower case, hyphenated), as on every other middleware row");

        // analytics.events is append-only, so the bag is held to exactly the
        // keys ADR 0028 lists. No endpoint, no farm, no device identifier.
        props.Keys.Should().BeEquivalentTo(new[] { "appVersion", "personId" },
            "with no X-Client-Platform header the row has these two keys and nothing else");
    }

    [Fact]
    public async Task A_second_request_the_same_day_writes_nothing()
    {
        var next = new CountingNext();
        var clock = new MovableClock(Morning);
        var (mw, writer) = Build(next.Invoke, clock);

        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));
        (await WaitForCount(writer, 1)).Should().HaveCount(1, "the first request of the day is recorded");

        // Twelve hours on, 20:00 UTC: still 12 November in UTC, although it is
        // already the 13th where the clock's local zone is. And a different
        // kind of request, to show the day's one row is per person and version,
        // not per route.
        clock.Advance(TimeSpan.FromHours(12));
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18", method: "POST", path: "/shramsafal/logs"));

        // The control: another person, through the same instance, IS recorded.
        await mw.InvokeAsync(Request(SignedIn(Ramesh), "1.0.18"));

        var events = await SettledEvents(writer, expected: 2);
        events.Select(PersonOf).Should().Equal(
            new[] { SunitaId, RameshId },
            "Sunita is seen once that UTC day however often she comes back; Ramesh's row proves the "
            + "middleware was still recording when her second request passed through");
        next.Calls.Should().Be(3, "a request that writes nothing is still passed on");
    }

    [Fact]
    public async Task The_same_person_on_a_new_version_is_seen_again()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // Sunita updates the app in the middle of the day.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.17"));
        (await WaitForCount(writer, 1)).Should().HaveCount(1);

        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));

        var events = await SettledEvents(writer, expected: 2);
        events.Should().HaveCount(2,
            "the once-a-day rule is per person AND version: without the second row the control "
            + "room would keep her on the old version until tomorrow");
        events.Select(PersonOf).Should().Equal(SunitaId, SunitaId);
        events.Select(VersionOf).Should().Equal("1.0.17", "1.0.18");
        events.Should().OnlyContain(e => e.EventType == "app.seen");
    }

    [Fact]
    public async Task The_next_day_the_person_is_seen_again()
    {
        var next = new CountingNext();

        // 23:50 UTC on 12 November.
        var clock = new MovableClock(new DateTimeOffset(2026, 11, 12, 23, 50, 0, TimeSpan.Zero));
        var (mw, writer) = Build(next.Invoke, clock);

        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));
        (await WaitForCount(writer, 1)).Should().HaveCount(1);

        // Twenty minutes later it is 00:10 UTC on the 13th. Only twenty
        // minutes have passed, and in the clock's local zone the date has not
        // changed at all (05:20 to 05:40): what counts is the UTC date.
        clock.Advance(TimeSpan.FromMinutes(20));
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));

        var events = await SettledEvents(writer, expected: 2);
        events.Should().HaveCount(2, "a new UTC day is a new row for the same person and version");
        events.Select(PersonOf).Should().Equal(SunitaId, SunitaId);
        events.Select(VersionOf).Should().Equal("1.0.18", "1.0.18");

        // The new day de-duplicates exactly as the old one did. Ramesh is the
        // control, as above.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));
        await mw.InvokeAsync(Request(SignedIn(Ramesh), "1.0.18"));

        var after = await SettledEvents(writer, expected: 3);
        after.Select(PersonOf).Should().Equal(
            new[] { SunitaId, SunitaId, RameshId },
            "starting a new day resets who has been seen; it does not switch the once-a-day rule off");
        next.Calls.Should().Be(4);
    }

    // ------------------------------------------------------------------
    // What is NOT recorded
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_anonymous_request_is_not_seen()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // Nobody: the framework's default principal, unauthenticated and claimless.
        await mw.InvokeAsync(Request(user: null, appVersion: "1.0.18"));

        // A token nobody validated: it names a person, but the identity has no
        // authentication type, so it is not authenticated.
        var unauthenticated = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", SunitaId) }));
        await mw.InvokeAsync(Request(unauthenticated, "1.0.18"));

        // Signed in, but the subject is not a person's id.
        var notAPerson = new ClaimsPrincipal(
            new ClaimsIdentity(new[] { new Claim("sub", "service-account") }, authenticationType: "Test"));
        await mw.InvokeAsync(Request(notAPerson, "1.0.18"));

        // The control: a signed-in person, through the same instance.
        await mw.InvokeAsync(Request(SignedIn(Ramesh), "1.0.18"));

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            "anyone on the internet can send a version header; only a signed-in person is recorded, "
            + "or a stranger could fill an append-only store");
        PersonOf(events[0]).Should().Be(RameshId);
        next.Calls.Should().Be(4, "a request that is not recorded is still passed on");
    }

    [Fact]
    public async Task A_request_with_no_version_header_is_not_seen()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // The admin console sends no X-App-Version at all, and neither does an
        // old app. A header that is empty or blank says no more than no header.
        await mw.InvokeAsync(Request(SignedIn(Sunita), appVersion: null));
        await mw.InvokeAsync(Request(SignedIn(Sunita), appVersion: string.Empty));
        await mw.InvokeAsync(Request(SignedIn(Sunita), appVersion: "   "));

        // The control is the SAME person, now saying which version she is on.
        // So it also proves the requests above did not use up her row for the day.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            "a request that does not say which version it came from is not recorded: "
            + "a version nobody reported is never written down as a guess");
        PersonOf(events[0]).Should().Be(SunitaId);
        VersionOf(events[0]).Should().Be("1.0.18");
        next.Calls.Should().Be(4);
    }

    [Fact]
    public async Task A_malformed_version_is_not_seen()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // Each of these starts with a digit, so only the sanitiser stands
        // between it and a permanent row: a character a version never has, a
        // space, and a value longer than the 32 characters a version may be.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0;drop"));
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18 OR 1=1"));
        await mw.InvokeAsync(Request(SignedIn(Sunita), new string('1', 33)));

        // The control: the same person with a well-formed version.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            "a malformed version is not a version anybody used; it is not recorded, neither as "
            + "sent nor as the word the sanitiser puts in its place");
        VersionOf(events[0]).Should().Be("1.0.18");
        events[0].PropsJson.Should().NotContain("malformed");
        events[0].PropsJson.Should().NotContain("drop");
        next.Calls.Should().Be(4);
    }

    [Fact]
    public async Task A_version_that_does_not_start_with_a_digit_is_not_seen()
    {
        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        // Every one of these passes the sanitiser (letters, digits, dot, dash
        // and plus are all allowed), which is how the word "unknown" reaches
        // other rows today. None of them is a version number.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "unknown"));
        await mw.InvokeAsync(Request(SignedIn(Sunita), "v1.0.18"));
        await mw.InvokeAsync(Request(SignedIn(Sunita), "-1.0.18"));
        await mw.InvokeAsync(Request(SignedIn(Sunita), ".18"));

        // The control: the same person with a real version.
        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18"));

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            "the control room counts people per version; a wordy value would become a version "
            + "row called \"unknown\" that no release ever had");
        VersionOf(events[0]).Should().Be("1.0.18");
        events[0].PropsJson.Should().NotContain("unknown");
        next.Calls.Should().Be(5);
    }

    // ------------------------------------------------------------------
    // The shape of the row
    // ------------------------------------------------------------------

    /// <summary>
    /// ADR 0028 D2. The weekly-active and retention views count any event
    /// whose <c>actor_user_id</c> is set, and the suffering list counts rows
    /// by <c>farm_id</c>. A person who only opened the app must not become
    /// "active" by a side effect, so both columns stay empty on this row even
    /// though the middleware knows the person, and even when the token carries
    /// a farm and the route names another.
    /// </summary>
    [Fact]
    public async Task The_actor_and_farm_columns_stay_empty_and_the_person_is_in_props()
    {
        var claimFarm = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var addressedFarm = Guid.Parse("cccccccc-1111-2222-3333-444444444444");

        var next = new CountingNext();
        var (mw, writer) = Build(next.Invoke, new MovableClock(Morning));

        var ctx = Request(
            SignedIn(Sunita, farmClaim: claimFarm),
            "1.0.18",
            method: "POST",
            path: "/shramsafal/farms/cccccccc-1111-2222-3333-444444444444/logs");
        ctx.Request.RouteValues["farmId"] = addressedFarm.ToString("D");

        await mw.InvokeAsync(ctx);

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle();

        var ev = events[0];
        ev.EventType.Should().Be("app.seen");
        ev.ActorUserId.HasValue.Should().BeFalse(
            "actor_user_id stays null: opening the app must not count a person as weekly-active");
        ev.FarmId.HasValue.Should().BeFalse(
            "farm_id stays null even when the token carries a farm: every activity reader that "
            + "does not filter on the event type filters on one of these two columns being set");

        var props = PropsOf(ev);
        props["personId"].GetString().Should().Be(SunitaId, "the person lives in props, and only there");
        props.Keys.Should().BeEquivalentTo(new[] { "appVersion", "personId" },
            "the farm is in neither column and in no key");
        ev.PropsJson.Should().NotContain("11111111-2222-3333-4444-555555555555",
            "the farm in the token is not recorded on this row at all");
        ev.PropsJson.Should().NotContain("cccccccc-1111-2222-3333-444444444444",
            "nor is the farm the route addressed");
    }

    [Fact]
    public async Task The_platform_is_android_only_when_the_header_says_android()
    {
        // The app sends "X-Client-Platform: android" from native Android only.
        var titleCase = await PropsSeenWith(platform: "Android");
        titleCase.Should().ContainKey("platform");
        titleCase["platform"].GetString().Should().Be("android",
            "the header is matched ignoring case and the literal \"android\" is what gets "
            + "written, so one platform is one value to group by");
        titleCase.Keys.Should().BeEquivalentTo(new[] { "appVersion", "personId", "platform" });

        var exact = await PropsSeenWith(platform: "android");
        exact.Should().ContainKey("platform");
        exact["platform"].GetString().Should().Be("android");

        // Anything else is not copied into an append-only row: the person is
        // still seen, and the key is ABSENT (not null, not "unknown").
        var iphone = await PropsSeenWith(platform: "ios");
        iphone.Should().NotContainKey("platform",
            "only the one value the app really sends is recorded; a client can put anything in this header");
        iphone.Keys.Should().BeEquivalentTo(new[] { "appVersion", "personId" });

        var noHeader = await PropsSeenWith(platform: null);
        noHeader.Should().NotContainKey("platform",
            "a platform nobody reported is an absent key (Doctrine P4), never a placeholder");
        noHeader.Keys.Should().BeEquivalentTo(new[] { "appVersion", "personId" });
    }

    /// <summary>
    /// One signed-in request with a version and the given
    /// <c>X-Client-Platform</c> header (null: no header) through a fresh
    /// middleware; returns the props of the one row it must produce.
    /// </summary>
    private static async Task<Dictionary<string, JsonElement>> PropsSeenWith(string? platform)
    {
        var (mw, writer) = Build(new CountingNext().Invoke, new MovableClock(Morning));

        await mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18", platform: platform));

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            $"a signed-in request with a version is seen whatever X-Client-Platform says ({platform ?? "no header"})");
        PersonOf(events[0]).Should().Be(SunitaId);
        VersionOf(events[0]).Should().Be("1.0.18");

        return PropsOf(events[0]);
    }

    // ------------------------------------------------------------------
    // Recording may never cost a request, and a failed request is still seen
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_failing_writer_never_fails_the_request()
    {
        // 1. The store is down: the writer throws the moment it is asked.
        var writer = new ThrowingWriter();
        var logger = new CapturingLogger();
        var next = new CountingNext();

        var services = new ServiceCollection();
        services.AddScoped<IAnalyticsWriter>(_ => writer);

        var mw = new AppSeenMiddleware(
            next.Invoke,
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            new MovableClock(Morning),
            logger);

        var ctx = Request(SignedIn(Sunita), "1.0.18");

        // Nothing escapes: an exception here fails the test.
        await mw.InvokeAsync(ctx);

        next.Calls.Should().Be(1, "the request goes through whether or not it can be recorded");
        ctx.Response.StatusCode.Should().Be(StatusCodes.Status204NoContent,
            "the farmer gets the endpoint's answer, not the recording's failure");

        (await Eventually(() => writer.Calls > 0)).Should().BeTrue(
            "this request is one that is recorded, so the failing writer really was asked; "
            + "if it never was, this test proved nothing");
        (await Eventually(() => logger.HasWarning)).Should().BeTrue(
            "a lost row is not hidden: it is logged at Warning, the production minimum level, "
            + "which is the named landing place for a failed write");

        // 2. No writer can be built at all. Same promise.
        var bareLogger = new CapturingLogger();
        var bareNext = new CountingNext();
        var withoutWriter = new AppSeenMiddleware(
            bareNext.Invoke,
            new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            new MovableClock(Morning),
            bareLogger);

        var ctx2 = Request(SignedIn(Ramesh), "1.0.18");
        await withoutWriter.InvokeAsync(ctx2);

        bareNext.Calls.Should().Be(1);
        ctx2.Response.StatusCode.Should().Be(StatusCodes.Status204NoContent);
        (await Eventually(() => bareLogger.HasWarning)).Should().BeTrue(
            "a writer that cannot be resolved is a failed write like any other, and is logged the same way");
    }

    [Fact]
    public async Task A_request_whose_handler_throws_is_still_seen()
    {
        var boom = new InvalidOperationException("the endpoint crashed");

        // The decision is taken on the way IN, from what the request said
        // then. So this handler first makes the request look like nobody's
        // (as a pipeline that has finished with it may), and then crashes.
        var (mw, writer) = Build(
            ctx =>
            {
                ctx.Request.Headers.Remove("X-App-Version");
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity());
                throw boom;
            },
            new MovableClock(Morning));

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(
            () => mw.InvokeAsync(Request(SignedIn(Sunita), "1.0.18")));

        thrown.Should().BeSameAs(boom,
            "recording that a person used the app must never consume the failure: the server's "
            + "own error handling, further out, still has to answer 500");

        var events = await SettledEvents(writer, expected: 1);
        events.Should().ContainSingle(
            "she used the app on this version whether or not the request then failed, and a "
            + "person whose app keeps failing is the one the team most needs to see");
        events[0].EventType.Should().Be("app.seen");
        PersonOf(events[0]).Should().Be(SunitaId);
        VersionOf(events[0]).Should().Be("1.0.18");
    }
}
