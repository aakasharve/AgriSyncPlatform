using System.Security.Claims;
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetOpsRecorded;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task R1 and
/// its amendment 4 of 2026-11-14).
///
/// <para>
/// <c>GET /shramsafal/admin/ops/recorded</c> reads back what the failure
/// recording captured: each row with the person's name. The acceptance
/// criterion is that it "is refused without <c>ops.errors</c>, and answers
/// 503 on a failed query". Both live in the body of the route's delegate, so
/// neither the route's metadata nor a search of the source text can say
/// whether they work. These tests run it.
/// </para>
///
/// <para>
/// The harness is the one <c>AdminOpsAppVersionsGateTests</c> uses: the
/// production mapping extension is called on a hand-made
/// <see cref="IEndpointRouteBuilder"/>, with no web server and no database,
/// and the route's own <see cref="RequestDelegate"/> is invoked with a fixed
/// seat in place of the entitlement resolver and a hand-written repository
/// behind the real <see cref="GetOpsRecordedHandler"/>. The handler is built
/// by the container from the repository, the real clock and logging, so
/// these tests do not depend on which of those its constructor takes.
/// </para>
///
/// <para>
/// Not covered here, stated plainly: the SQL (which rows are read, the
/// person's name, the lock on who wrote a row). That needs a database and is
/// in <c>ShramSafal.Admin.IntegrationTests/AdminOpsRecordedTests.cs</c>. The
/// limit of 500 rows is pinned in neither place: the plan does not say
/// whether the query or the handler applies it. Whether a value of
/// <c>minutes</c> outside 1 to 1440 is clamped or refused is not pinned
/// either; what is pinned is that the route never reads further back than a
/// day because of it.
/// </para>
/// </summary>
public sealed class AdminOpsRecordedRouteTests
{
    private const string Route = "/shramsafal/admin/ops/recorded";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-000000000001");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    private static readonly Guid Sunita = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid SunitaFarm = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");

    /// <summary>One recorded server failure, as the repository hands it over.</summary>
    private static readonly OpsRecordedRowDto NamedError = new(
        EventId: Guid.Parse("eeeeeeee-0000-0000-0000-000000000001"),
        EventType: "api.error",
        OccurredAtUtc: new DateTime(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc),
        Endpoint: "POST /shramsafal/farms/bbbbbbbb-0000-0000-0000-000000000001/logs",
        Route: "POST /shramsafal/farms/{farmId:guid}/logs",
        StatusCode: 500,
        ErrorCode: "ShramSafal.CropCycleOverlap",
        RejectedWorkCodes: Array.Empty<string>(),
        RejectedWorkItems: null,
        AppVersion: "1.0.18",
        ServerBuild: "f08cd1c2",
        PersonId: Sunita,
        PersonName: "Sunita Pawar",
        RouteFarmId: SunitaFarm,
        RecoveredCount: null,
        NeedsReviewCount: null,
        PendingAfter: null);

    // ------------------------------------------------------------------
    // The gate
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_caller_without_ops_errors_is_refused()
    {
        var endpoint = RecordedEndpoint();

        // 1. A real seat that does not hold ops.errors: the owner of an FPO.
        //    It reads its own farms list, so it is not a seat with nothing.
        var fpoOwner = new AdminScope(
            Org,
            OrganizationType.FPO,
            OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner),
            IsPlatformAdmin: false);

        fpoOwner.CanRead(ModuleKey.OpsErrors).Should().BeFalse("this is the seat the case is about");
        fpoOwner.CanRead(ModuleKey.FarmsList).Should().BeTrue("and it is a working seat, not an empty one");

        var refused = await Ask(endpoint, SignedIn(Admin), Seat(fpoOwner));

        refused.Status.Should().Be(StatusCodes.Status403Forbidden,
            "a seat without ops.errors is refused: the rows name people and what failed for them");
        ModuleNamedInRefusal(refused.Body).Should().Be(ModuleKey.OpsErrors,
            "the refusal names the module this route is gated on, and that module is ops.errors");
        refused.Repository.Calls.Should().BeEmpty("nothing is read for a caller who is refused");
        refused.Body.Should().NotContain(NamedError.EventId.ToString("D"), "a refusal carries no part of the answer");
        refused.Body.Should().NotContain("Sunita");

        // 2. Every module EXCEPT ops.errors, on a seat flagged as platform
        //    admin. The gate is this one module: not the neighbouring
        //    ops.live (a gate on that would let this seat in), and not the
        //    seat's title.
        var everythingElse = new AdminScope(
            Org,
            OrganizationType.Platform,
            OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner)
                .Where(m => m.ModuleKey != ModuleKey.OpsErrors)
                .ToList(),
            IsPlatformAdmin: true);

        everythingElse.CanRead(ModuleKey.OpsLive).Should().BeTrue();
        everythingElse.CanRead(ModuleKey.OpsErrors).Should().BeFalse();

        var stillRefused = await Ask(endpoint, SignedIn(Admin), Seat(everythingElse));

        stillRefused.Status.Should().Be(StatusCodes.Status403Forbidden,
            "holding every other module, and the platform-admin flag, does not stand in for ops.errors");
        ModuleNamedInRefusal(stillRefused.Body).Should().Be(ModuleKey.OpsErrors);
        stillRefused.Repository.Calls.Should().BeEmpty();

        // 3. No admin seat at all (a signed-in farm worker): 401, the
        //    resolver's contract for "no seat", and nothing read.
        var noSeat = await Ask(endpoint, SignedIn(Admin), ResolveResult.Unauthorized());

        noSeat.Status.Should().Be(StatusCodes.Status401Unauthorized, "a person with no admin seat is refused");
        noSeat.Repository.Calls.Should().BeEmpty();

        // 4. A caller who is nobody: refused before any seat is looked up.
        var nobody = await Ask(endpoint, user: null, Seat(fpoOwner));

        nobody.Status.Should().Be(StatusCodes.Status401Unauthorized);
        nobody.Resolver.Asked.Should().Be(0, "there is no person to look a seat up for");
        nobody.Repository.Calls.Should().BeEmpty();

        // The control. A seat that holds ops.errors and NOTHING else is let
        // in, and the handler really runs. Without this, "refused" above
        // could be a route that refuses everybody, or a harness that never
        // reaches the handler at all.
        var allowed = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()));

        allowed.Escaped.Should().BeNull();
        allowed.Status.Should().Be(StatusCodes.Status200OK, "ops.errors, and only ops.errors, is what the route asks for");
        allowed.Resolver.Asked.Should().Be(1, "the seat is resolved through the entitlement resolver, never read from a claim");
        allowed.Repository.Calls.Should().Contain(nameof(IAdminOpsRepository.GetRecordedAsync),
            "for a seat with ops.errors the handler really reads the records");
        allowed.Body.Should().Contain(NamedError.EventId.ToString("D"), "and the caller gets the recorded row");
    }

    // ------------------------------------------------------------------
    // A failed query
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_failed_query_answers_503()
    {
        var endpoint = RecordedEndpoint();
        var failure = new InvalidOperationException("the analytics store did not answer");

        var failed = await Ask(
            endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()), new RecordedRows { Failure = failure });

        failed.Repository.Calls.Should().Contain(nameof(IAdminOpsRepository.GetRecordedAsync),
            "the failing query really was asked; if it never was, this proved nothing");
        failed.Escaped.Should().BeNull(
            "the repository lets its failure escape and the handler does not catch it; the ROUTE "
            + "catches it and answers, it does not hand the exception to whatever is outside it");
        failed.Status.Should().Be(StatusCodes.Status503ServiceUnavailable,
            "a failed query is answered as a failure. This route is the proof that failures are "
            + "being recorded: 200 with an empty list would read as \"nothing failed\"");
        failed.Body.Should().NotContain(NamedError.EventId.ToString("D"));

        failed.Logs.Should().Contain(
            e => e.Level >= LogLevel.Error && ReferenceEquals(e.Exception, failure),
            "the failure is logged at Error with the exception itself, so the 503 can be traced "
            + "to its cause; a caught failure that leaves no trace is a swallowed one");

        // The control: the same seat, the same harness and a repository that
        // answers. So 503 above is the answer to the failure, not what this
        // route answers to everybody.
        var worked = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()));

        worked.Status.Should().Be(StatusCodes.Status200OK);
        worked.Logs.Should().NotContain(e => e.Level >= LogLevel.Error, "nothing failed, so nothing is logged as an error");
    }

    // ------------------------------------------------------------------
    // The window
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_window_is_the_minutes_asked_for_and_sixty_by_default()
    {
        var endpoint = RecordedEndpoint();
        var tolerance = TimeSpan.FromSeconds(30);

        // No minutes at all: the last hour.
        var byDefault = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()), query: string.Empty);

        byDefault.Status.Should().Be(StatusCodes.Status200OK, "minutes is optional; leaving it out is not an error");
        byDefault.Repository.Since.Should().ContainSingle();
        byDefault.Repository.Since[0].Should().BeCloseTo(DateTime.UtcNow.AddMinutes(-60), tolerance,
            "with no minutes given the route reads the last 60 minutes");

        // The smallest window, an ordinary one, and the largest.
        foreach (var minutes in new[] { 1, 5, 1440 })
        {
            var asked = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()), query: $"?minutes={minutes}");

            asked.Status.Should().Be(StatusCodes.Status200OK);
            asked.Repository.Since.Should().ContainSingle();
            asked.Repository.Since[0].Should().BeCloseTo(DateTime.UtcNow.AddMinutes(-minutes), tolerance,
                $"minutes={minutes} reads the rows of the last {minutes} minutes");
        }

        // Outside 1 to 1440. Whether the route clamps the value or refuses
        // the request is its own choice; what it may not do is read further
        // back than a day, or ask for a window that starts in the future.
        foreach (var minutes in new[] { 0, -5, 1441, 100000 })
        {
            var outside = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()), query: $"?minutes={minutes}");

            outside.Escaped.Should().BeNull();
            outside.Status.Should().BeOneOf(
                new[] { StatusCodes.Status200OK, StatusCodes.Status400BadRequest },
                $"minutes={minutes} is either brought into range or refused as a bad request");

            foreach (var since in outside.Repository.Since)
            {
                since.Should().BeOnOrAfter(DateTime.UtcNow.AddMinutes(-1440) - tolerance,
                    $"minutes={minutes} must not read further back than a day");
                since.Should().BeOnOrBefore(DateTime.UtcNow.AddMinutes(-1) + tolerance,
                    $"minutes={minutes} must not ask for less than the last minute");
            }
        }
    }

    // ------------------------------------------------------------------
    // What the answer carries
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_answer_names_the_person_and_has_no_place_for_a_phone_number()
    {
        var endpoint = RecordedEndpoint();

        var answer = await Ask(endpoint, SignedIn(Admin), Seat(OnlyOpsErrors()));

        answer.Status.Should().Be(StatusCodes.Status200OK);

        using var doc = JsonDocument.Parse(answer.Body);
        var properties = Properties(doc.RootElement).ToList();

        properties.Should().Contain(
            p => string.Equals(p.Name, "personName", StringComparison.OrdinalIgnoreCase)
                 && p.Value.ValueKind == JsonValueKind.String
                 && p.Value.GetString() == "Sunita Pawar",
            "the row says who the failure happened to, by name");
        properties.Should().Contain(
            p => string.Equals(p.Name, "errorCode", StringComparison.OrdinalIgnoreCase)
                 && p.Value.ValueKind == JsonValueKind.String
                 && p.Value.GetString() == "ShramSafal.CropCycleOverlap",
            "and what failed, by its name");

        string[] neverReturned = ["phone", "mobile", "device"];

        properties.Select(p => p.Name).Should().NotContain(
            name => neverReturned.Any(word => name.Contains(word, StringComparison.OrdinalIgnoreCase)),
            "this route returns no phone number and no device id; revealing a phone number is a "
            + "later, separately gated step (CR-1b)");

        // The same for the row type itself, so that a field cannot be added
        // to it and reach the wire on the day somebody fills it.
        typeof(OpsRecordedRowDto).GetProperties().Select(p => p.Name).Should().NotContain(
            name => neverReturned.Any(word => name.Contains(word, StringComparison.OrdinalIgnoreCase)),
            "the recorded row has no place to put a phone number or a device id");
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    /// <summary>
    /// Maps the production admin routes exactly as <c>MapShramSafalApi</c>
    /// does (a <c>/shramsafal</c> group, then <c>MapAdminEndpoints</c>) and
    /// returns the one route these tests are about, after checking that it is
    /// a read and that it is not cached.
    /// </summary>
    private static RouteEndpoint RecordedEndpoint()
    {
        var routes = new TestRouteBuilder(
            new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

        routes.MapGroup("/shramsafal").MapAdminEndpoints();

        var mapped = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .ToList();

        var matches = mapped
            .Where(e => string.Equals(e.RoutePattern.RawText, Route, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {Route}");

        var methods = matches[0].Metadata.GetMetadata<HttpMethodMetadata>();
        methods.Should().NotBeNull();
        methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" }, "the route is a read");

        // Not cached: a recorded failure must be readable the moment after it
        // happened, and a failed query must never be answered from an earlier
        // good answer. The control is the errors route beside it, which IS
        // cached, so this harness can see the difference.
        IsCached(matches[0]).Should().BeFalse($"{Route} is not cached");
        mapped.Single(e => e.RoutePattern.RawText == "/shramsafal/admin/ops/errors")
            .Should().Match<RouteEndpoint>(e => IsCached(e), "the control: a cached route is seen as cached here");

        matches[0].RequestDelegate.Should().NotBeNull();
        return matches[0];
    }

    private static bool IsCached(Endpoint endpoint) =>
        endpoint.Metadata.Any(m => m is OutputCacheAttribute or IOutputCachePolicy);

    /// <summary>
    /// One request to the route's own delegate. The seat is whatever the test
    /// says the resolver answers. The handler is the real one, built by the
    /// container over <paramref name="repository"/> (by default: one that
    /// holds <see cref="NamedError"/>).
    /// </summary>
    private static async Task<Answer> Ask(
        RouteEndpoint endpoint,
        ClaimsPrincipal? user,
        ResolveResult seat,
        RecordedRows? repository = null,
        string query = "?minutes=60")
    {
        var resolver = new FixedSeatResolver(seat);
        repository ??= new RecordedRows();
        var logs = new RecordingLoggerProvider();

        var services = new ServiceCollection();
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Trace).AddProvider(logs));
        services.AddSingleton<IEntitlementResolver>(resolver);
        services.AddSingleton<IAdminOpsRepository>(repository);

        // The real clock, in both forms this codebase injects one.
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IClock>(new SystemUtcClock());
        services.AddTransient<GetOpsRecordedHandler>();

        await using var provider = services.BuildServiceProvider();

        var ctx = new DefaultHttpContext
        {
            RequestServices = provider,
            Response = { Body = new MemoryStream() },
            Request =
            {
                Method = "GET",
                Path = Route,
                QueryString = query.Length == 0 ? QueryString.Empty : new QueryString(query),
            },
        };

        if (user is not null)
        {
            ctx.User = user;
        }

        ctx.SetEndpoint(endpoint);

        Exception? escaped = null;
        try
        {
            await endpoint.RequestDelegate!(ctx);
        }
        catch (Exception ex)
        {
            escaped = ex;
        }

        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var reader = new StreamReader(ctx.Response.Body);
        var body = await reader.ReadToEndAsync();

        return new Answer(ctx.Response.StatusCode, body, resolver, repository, logs.Snapshot(), escaped);
    }

    private static ResolveResult Seat(AdminScope scope) =>
        ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>());

    /// <summary>A seat that reads ops.errors and holds nothing else.</summary>
    private static AdminScope OnlyOpsErrors() => new(
        Org,
        OrganizationType.Platform,
        OrganizationRole.Analyst,
        new[] { new ModuleEntitlement(ModuleKey.OpsErrors, CanRead: true, CanExport: false, CanWrite: false) },
        IsPlatformAdmin: false);

    /// <summary>A signed-in caller, shaped like the principal the JWT handler builds.</summary>
    private static ClaimsPrincipal SignedIn(Guid userId) =>
        new(new ClaimsIdentity(new[] { new Claim("sub", userId.ToString("D")) }, authenticationType: "Test"));

    /// <summary>The module a 403 from the module gate says it was refused on.</summary>
    private static string ModuleNamedInRefusal(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty("moduleKey", out var module)
            ? module.GetString() ?? "(null)"
            : "(the refusal names no module)";
    }

    /// <summary>Every property in a JSON answer, at any depth.</summary>
    private static IEnumerable<(string Name, JsonElement Value)> Properties(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    yield return (property.Name, property.Value.Clone());

                    foreach (var nested in Properties(property.Value))
                    {
                        yield return nested;
                    }
                }

                break;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var nested in Properties(item))
                    {
                        yield return nested;
                    }
                }

                break;
        }
    }

    private sealed record Answer(
        int Status,
        string Body,
        FixedSeatResolver Resolver,
        RecordedRows Repository,
        IReadOnlyList<LogEntry> Logs,
        Exception? Escaped);

    private sealed record LogEntry(LogLevel Level, Exception? Exception, string Message);

    /// <summary>
    /// Minimal <see cref="IEndpointRouteBuilder"/> that collects the data
    /// sources the mapping appends, as in <c>AdminOpsAppVersionsGateTests</c>.
    /// </summary>
    private sealed class TestRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(ServiceProvider);
    }

    /// <summary>
    /// The services the routes are BUILT against (not the ones a request is
    /// served with). It answers "yes, that is a service" for every class and
    /// interface, so that mapping the whole admin group needs no registration
    /// here for each handler any admin route takes. It only decides how
    /// parameters are classified; the request gets its real services from
    /// <see cref="Ask"/>.
    /// </summary>
    private sealed class RouteBuildingServices(IServiceProvider inner) : IServiceProvider, IServiceProviderIsService
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IServiceProviderIsService) ? this : inner.GetService(serviceType);

        public bool IsService(Type serviceType) => serviceType.IsInterface || serviceType.IsClass;
    }

    private sealed class SystemUtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    private sealed class FixedSeatResolver(ResolveResult result) : IEntitlementResolver
    {
        private int _asked;

        public int Asked => Volatile.Read(ref _asked);

        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct)
        {
            Interlocked.Increment(ref _asked);
            return Task.FromResult(result);
        }
    }

    /// <summary>Keeps every log line written while one request is served.</summary>
    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        private readonly List<LogEntry> _entries = new();

        public IReadOnlyList<LogEntry> Snapshot()
        {
            lock (_entries)
            {
                return _entries.ToList();
            }
        }

        public ILogger CreateLogger(string categoryName) => new Recorder(this);

        public void Dispose()
        {
        }

        private sealed class Recorder(RecordingLoggerProvider owner) : ILogger
        {
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
                lock (owner._entries)
                {
                    owner._entries.Add(new LogEntry(logLevel, exception, formatter(state, exception)));
                }
            }
        }
    }

    /// <summary>
    /// Hand-written <see cref="IAdminOpsRepository"/>: it holds the rows it
    /// is given (by default <see cref="NamedError"/>), fails when told to,
    /// and writes down every query it is asked. For a refused caller that
    /// list must stay empty.
    /// </summary>
    private sealed class RecordedRows : IAdminOpsRepository
    {
        public List<OpsRecordedRowDto> Rows { get; } = new() { NamedError };

        /// <summary>When set, <see cref="GetRecordedAsync"/> fails with it, as the real one does: it lets the failure escape.</summary>
        public Exception? Failure { get; init; }

        public List<string> Calls { get; } = new();

        public List<DateTime> Since { get; } = new();

        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetRecordedAsync));
            Since.Add(sinceUtc);

            return Failure is null
                ? Task.FromResult<IReadOnlyList<OpsRecordedRowDto>>(Rows.ToList())
                : Task.FromException<IReadOnlyList<OpsRecordedRowDto>>(Failure);
        }

        // The plan has the query itself name the person. Should the handler
        // ask for names separately instead, it gets the same name, so the
        // tests above hold either way.
        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
            IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetPeopleNamesAsync));

            IReadOnlyDictionary<Guid, string?> names = personIds.Contains(Sunita)
                ? new Dictionary<Guid, string?> { [Sunita] = "Sunita Pawar" }
                : new Dictionary<Guid, string?>();
            return Task.FromResult(names);
        }

        // The other members of the port. This route has no business reaching
        // them; each writes its name down first, so a read on behalf of a
        // refused caller cannot go unseen.
        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenAsync));
            throw new NotSupportedException();
        }

        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenStartAsync));
            throw new NotSupportedException();
        }

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetSignInDevicesAsync));
            throw new NotSupportedException();
        }

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmNamesByPersonAsync));
            throw new NotSupportedException();
        }

        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default)
        {
            Calls.Add(nameof(GetOpsHealthAsync));
            throw new NotSupportedException();
        }

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetErrorsPagedAsync));
            throw new NotSupportedException();
        }

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetVoiceTrendAsync));
            throw new NotSupportedException();
        }
    }
}
