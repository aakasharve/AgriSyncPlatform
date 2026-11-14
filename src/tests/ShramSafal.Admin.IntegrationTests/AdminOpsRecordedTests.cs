using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;   // AnalyticsDbContext lives here
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task R1 and
/// its amendment 4 of 2026-11-14).
///
/// <para>
/// The SQL behind <c>GET /shramsafal/admin/ops/recorded</c>, against a real
/// database: <c>IAdminOpsRepository.GetRecordedAsync</c> reads back what the
/// failure recording wrote into <c>analytics.events</c>, for six event types,
/// newest first, each row with its person and that person's name. The route's
/// own behaviour (the <c>ops.errors</c> gate, the 503) needs no database and
/// is held in <c>AgriSync.ArchitectureTests/AdminOpsRecordedRouteTests.cs</c>.
/// </para>
///
/// <para>
/// <b>Who wrote a row decides whether it is read.</b> Four of the six types
/// are written by the server's request middleware, which never sets
/// <c>actor_user_id</c> (the person is in <c>props.personId</c>). The other
/// two arrive from the app through the ingest route, which always sets it.
/// So a row of a server-written type that carries an actor was not written by
/// the server (before commit 7e496f87 a signed-in account could post a forged
/// <c>api.error</c> through ingest), and it is never read back as a server
/// failure. A row of a client type with no actor has no sender and is not
/// read either.
/// </para>
///
/// <para>
/// <b>How the tests keep out of each other's way.</b> The database is shared
/// by every class in the collection. This class never deletes from
/// <c>analytics.events</c>: on a migrated database that table refuses DELETE
/// and UPDATE by rule, and a delete that silently does nothing is worse than
/// none. Instead every test works on a day of its own in March 2025, a month
/// no other class writes to, and looks only at rows whose ids it inserted
/// (or, for "is not returned", at the absence of exactly those ids). Rows of
/// that age are also outside every "last 2 hours" and "last 24 hours" reader
/// the other classes test, which rows dated in the future would not be. The
/// users this class inserts are marked and removed before and after each test.
/// </para>
///
/// <para>
/// Every time is a whole second: Postgres keeps microseconds and .NET keeps
/// tenths of them, so a fractional time would not read back equal.
/// </para>
///
/// <para>
/// <b>Not covered, stated plainly.</b>
/// (1) The limit of 500 rows: the plan does not say whether the query or the
/// handler applies it, so neither this class nor the route tests pin it.
/// (2) "Newest first" IS asserted here, on the repository's answer; should
/// the handler be the one that sorts, that test has to move with it.
/// (3) A row exactly on the window's first instant.
/// (4) A person whose user record has a blank name.
/// </para>
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class AdminOpsRecordedTests(AdminTestFixture fixture) : IAsyncLifetime
{
    /// <summary>Marks the users this class inserts. Not a hash of anything.</summary>
    private const string UserMarker = "cr1a-recorded-not-a-hash";

    /// <summary>The value of <c>BUILD_SHA</c> on the server that wrote the rows.</summary>
    private const string ServerBuild = "f08cd1c2";

    private static readonly string[] ServerWrittenTypes =
        ["api.error", "api.slow", "api.refused", "sync.mutation_rejected"];

    private static readonly string[] ClientTypes = ["client.error", "sync.push_outcome"];

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private readonly List<Guid> _eventIds = new();

    /// <summary>06:00 UTC on a day of March 2025. Each test has a day of its own.</summary>
    private static DateTime Day(int day) => new(2025, 3, day, 6, 0, 0, DateTimeKind.Utc);

    public Task InitializeAsync() => RemoveOwnUsersAsync();

    public Task DisposeAsync() => RemoveOwnUsersAsync();

    // ------------------------------------------------------------------
    // The four server-written types
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_named_error_reads_back_with_its_code_person_route_and_build()
    {
        var at = Day(1);
        var sunita = Guid.NewGuid();
        var farm = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        var endpoint = $"POST /shramsafal/farms/{farm:D}/logs";
        const string route = "POST /shramsafal/farms/{farmId:guid}/logs";

        // Exactly the bag RequestObservabilityProps.Build writes for a server
        // failure on a signed-in request to a farm route.
        var props = MiddlewareProps(endpoint, statusCode: 500, route, personId: sunita, routeFarmId: farm);
        props["errorCode"] = "ShramSafal.CropCycleOverlap";
        props["workKept"] = "unknown";
        props["message"] = null;
        props["farmId"] = null;

        var id = await ServerRowAsync("api.error", at, props);

        var row = Row(await Recorded(at.AddMinutes(-1)), id);

        row.EventType.Should().Be("api.error");
        row.OccurredAtUtc.Should().Be(at);
        row.Endpoint.Should().Be(endpoint, "the raw method and path, with the farm's id in it");
        row.Route.Should().Be(route, "the route pattern: the same fault on two farms is one operation");
        row.StatusCode.Should().Be(500);
        row.ErrorCode.Should().Be("ShramSafal.CropCycleOverlap", "the error reads back with its name");
        row.AppVersion.Should().Be("1.0.18");
        row.ServerBuild.Should().Be(ServerBuild);
        row.PersonId.Should().Be(sunita,
            "for a row the middleware wrote, the person is props.personId; the actor column is empty");
        row.PersonName.Should().Be("Sunita Pawar");
        row.RouteFarmId.Should().Be(farm, "the farm the request addressed");

        row.RejectedWorkCodes.Should().NotBeNull().And.BeEmpty("nothing was refused inside this response");
        row.RejectedWorkItems.Should().BeNull();
        ShouldCarryNoReport(row);
    }

    [Fact]
    public async Task A_refused_sync_row_reads_back_with_its_codes()
    {
        var at = Day(2);
        var sunita = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        // POST /sync/push answered 200 and refused three saves inside it.
        var props = MiddlewareProps("POST /sync/push", statusCode: 200, "POST /sync/push", personId: sunita);
        props["rejectedWorkItems"] = 3;
        props["rejectedWorkReason"] = "sync.mutation_rejected";
        props["rejectedWorkCodes"] = new[] { "ShramSafal.AttendanceContradiction", "ShramSafal.SyncInvalidPayload" };

        var id = await ServerRowAsync("sync.mutation_rejected", at, props);

        var row = Row(await Recorded(at.AddMinutes(-1)), id);

        row.EventType.Should().Be("sync.mutation_rejected");
        row.RejectedWorkCodes.Should().BeEquivalentTo(
            new[] { "ShramSafal.AttendanceContradiction", "ShramSafal.SyncInvalidPayload" },
            "a refused save is named: the distinct codes of the refused mutations read back, "
            + "each once, and nothing else is in the list");
        row.RejectedWorkItems.Should().Be(3, "how many were refused is still read, beside which");
        row.StatusCode.Should().Be(200, "the refusal was inside a response that itself succeeded");
        row.Endpoint.Should().Be("POST /sync/push");
        row.Route.Should().Be("POST /sync/push");
        row.AppVersion.Should().Be("1.0.18");
        row.ServerBuild.Should().Be(ServerBuild);
        row.PersonId.Should().Be(sunita);
        row.PersonName.Should().Be("Sunita Pawar");

        row.RouteFarmId.Should().BeNull(
            "the sync route has no farm in it: a refused sync row carries the person and no farm, "
            + "and none is made up for it");
        row.ErrorCode.Should().BeNull("the row is named by its refused codes; it has no error code of its own");
        ShouldCarryNoReport(row);
    }

    [Fact]
    public async Task An_api_refused_row_is_returned()
    {
        var at = Day(3);
        var sunita = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        // A signed-in write outside the critical list that the endpoint
        // itself refused, with the code its error mapper stamped.
        var named = MiddlewareProps(
            "POST /shramsafal/cropcycles", statusCode: 409, "POST /shramsafal/cropcycles", personId: sunita);
        named["errorCode"] = "ShramSafal.CropCycleOverlap";
        var namedId = await ServerRowAsync("api.refused", at, named);

        // The same, answered by an endpoint whose mapper stamped nothing: the
        // middleware writes no errorCode key at all.
        var unnamed = MiddlewareProps(
            "PUT /shramsafal/profile", statusCode: 400, "PUT /shramsafal/profile", personId: sunita);
        var unnamedId = await ServerRowAsync("api.refused", at.AddMinutes(1), unnamed);

        var rows = await Recorded(at.AddMinutes(-1));

        var row = Row(rows, namedId);
        row.EventType.Should().Be("api.refused", "a refused write is its own type and is read back as that type");
        row.StatusCode.Should().Be(409);
        row.ErrorCode.Should().Be("ShramSafal.CropCycleOverlap");
        row.Endpoint.Should().Be("POST /shramsafal/cropcycles");
        row.Route.Should().Be("POST /shramsafal/cropcycles");
        row.AppVersion.Should().Be("1.0.18");
        row.ServerBuild.Should().Be(ServerBuild);
        row.PersonId.Should().Be(sunita);
        row.PersonName.Should().Be("Sunita Pawar");
        row.RejectedWorkCodes.Should().NotBeNull().And.BeEmpty();
        ShouldCarryNoReport(row);

        var noCode = Row(rows, unnamedId);
        noCode.EventType.Should().Be("api.refused");
        noCode.StatusCode.Should().Be(400);
        noCode.ErrorCode.Should().BeNull(
            "a refusal nobody named has no code; the word \"Uncatalogued\" belongs to api.error and "
            + "is not put on this row when it is read");
    }

    // ------------------------------------------------------------------
    // The app's own report
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_push_outcome_row_reads_back_with_its_three_counts_its_app_version_and_its_sender()
    {
        var at = Day(4);
        var sunita = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        // As POST /analytics/ingest writes it: the sender is the actor, and
        // the props are what the app sent and nothing more.
        var id = await AppRowAsync("sync.push_outcome", at, sunita, new Dictionary<string, object?>
        {
            ["recoveredCount"] = 2,
            ["needsReviewCount"] = 1,
            ["pendingAfter"] = 0,
            ["appVersion"] = "1.0.18",
            ["firstFailedAtUtc"] = "2025-03-04T05:40:00.000Z",
        });

        var row = Row(await Recorded(at.AddMinutes(-1)), id);

        row.EventType.Should().Be("sync.push_outcome");
        row.OccurredAtUtc.Should().Be(at);
        row.RecoveredCount.Should().Be(2);
        row.NeedsReviewCount.Should().Be(1);
        row.PendingAfter.Should().Be(0,
            "nothing left waiting is a count of 0, which is a measurement and reads back as 0, not as null");
        row.AppVersion.Should().Be("1.0.18", "the version is what tells a 1.0.18 report from anything else");
        row.PersonId.Should().Be(sunita,
            "for a row that arrived through ingest, the person is the actor column: the report "
            + "names nobody in its props");
        row.PersonName.Should().Be("Sunita Pawar");

        // A report is not a request: it has none of a request's fields.
        row.Endpoint.Should().BeNull();
        row.Route.Should().BeNull();
        row.StatusCode.Should().BeNull();
        row.ErrorCode.Should().BeNull();
        row.ServerBuild.Should().BeNull();
        row.RouteFarmId.Should().BeNull();
        row.RejectedWorkItems.Should().BeNull();
        row.RejectedWorkCodes.Should().NotBeNull().And.BeEmpty();
    }

    [Fact]
    public async Task A_person_who_sent_no_report_has_no_outcome_row()
    {
        var at = Day(5);
        var sunita = Guid.NewGuid();   // on 1.0.18
        var ramesh = Guid.NewGuid();   // on 1.0.17, which sends no report
        await UserAsync(sunita, "Sunita Pawar");
        await UserAsync(ramesh, "Ramesh Patil");

        // Both had a save refused through sync within the same minutes.
        // (Every release up to 1.0.17 reports its version as 0.9.0.)
        var sunitaRefused = MiddlewareProps("POST /sync/push", 200, "POST /sync/push", personId: sunita);
        sunitaRefused["rejectedWorkItems"] = 1;
        sunitaRefused["rejectedWorkCodes"] = new[] { "ShramSafal.SyncInvalidPayload" };
        await ServerRowAsync("sync.mutation_rejected", at, sunitaRefused);

        var rameshRefused = MiddlewareProps(
            "POST /sync/push", 200, "POST /sync/push", personId: ramesh, appVersion: "0.9.0");
        rameshRefused["rejectedWorkItems"] = 1;
        rameshRefused["rejectedWorkCodes"] = new[] { "ShramSafal.SyncInvalidPayload" };
        var rameshRefusalId = await ServerRowAsync("sync.mutation_rejected", at.AddMinutes(1), rameshRefused);

        // Sunita's app then reports. Ramesh's cannot.
        var sunitaReportId = await AppRowAsync("sync.push_outcome", at.AddMinutes(5), sunita,
            new Dictionary<string, object?>
            {
                ["recoveredCount"] = 0,
                ["needsReviewCount"] = 1,
                ["pendingAfter"] = 0,
                ["appVersion"] = "1.0.18",
            });

        var rows = await Recorded(at.AddMinutes(-1));

        rows.Should().NotContain(r => r.EventType == "sync.push_outcome" && r.PersonId == ramesh,
            "a phone that sends no report has no report row: none is derived from his refusal, "
            + "and somebody else's report is not read as his");

        // Nothing breaks for him: his refusal reads back, named, and with no
        // report numbers made up for it.
        var his = Row(rows, rameshRefusalId);
        his.PersonId.Should().Be(ramesh);
        his.PersonName.Should().Be("Ramesh Patil");
        his.AppVersion.Should().Be("0.9.0");
        his.RejectedWorkItems.Should().Be(1);
        ShouldCarryNoReport(his);

        // The control: the report that WAS sent is read, once, as its sender's.
        var hers = Row(rows, sunitaReportId);
        hers.PersonId.Should().Be(sunita);
        hers.NeedsReviewCount.Should().Be(1);
        Mine(rows).Count(r => r.EventType == "sync.push_outcome").Should().Be(1);
    }

    // ------------------------------------------------------------------
    // Rows written before this plan
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_old_row_reads_back_with_nulls_and_an_empty_code_list()
    {
        var at = Day(6);

        // What a failure row held before this plan: a time, a path and a
        // status code. analytics.events is append-only, so such rows stay
        // exactly like this for ever.
        var oldErrorId = await ServerRowAsync("api.error", at, new Dictionary<string, object?>
        {
            ["endpoint"] = "POST /shramsafal/logs",
            ["statusCode"] = 500,
            ["latencyMs"] = 11,
            ["traceId"] = "legacy",
        });

        // A refused sync batch from the same time: a count and a constant
        // reason, and no codes.
        var oldRefusalId = await ServerRowAsync("sync.mutation_rejected", at.AddMinutes(1),
            new Dictionary<string, object?>
            {
                ["endpoint"] = "POST /sync/push",
                ["statusCode"] = 200,
                ["latencyMs"] = 900,
                ["traceId"] = "legacy",
                ["rejectedWorkItems"] = 3,
                ["rejectedWorkReason"] = "sync.mutation_rejected",
            });

        // And a row with nothing in it at all.
        var emptyId = await ServerRowAsync("api.slow", at.AddMinutes(2), new Dictionary<string, object?>());

        var rows = await Recorded(at.AddMinutes(-1));

        var oldError = Row(rows, oldErrorId);
        oldError.EventType.Should().Be("api.error");
        oldError.OccurredAtUtc.Should().Be(at);
        oldError.Endpoint.Should().Be("POST /shramsafal/logs");
        oldError.StatusCode.Should().Be(500);
        oldError.Route.Should().BeNull("it was not captured, so it is absent: never a default word such as \"unknown\"");
        oldError.ErrorCode.Should().BeNull("not \"Uncatalogued\", not an empty string, not a guess");
        oldError.AppVersion.Should().BeNull();
        oldError.ServerBuild.Should().BeNull();
        oldError.PersonId.Should().BeNull("the row named nobody when it was written, and nobody is found for it now");
        oldError.PersonName.Should().BeNull();
        oldError.RouteFarmId.Should().BeNull();
        oldError.RejectedWorkItems.Should().BeNull();
        oldError.RejectedWorkCodes.Should().NotBeNull("the list of codes is empty, it is never null").And.BeEmpty();
        ShouldCarryNoReport(oldError);

        var oldRefusal = Row(rows, oldRefusalId);
        oldRefusal.RejectedWorkItems.Should().Be(3, "the count the old row did carry is still read");
        oldRefusal.RejectedWorkCodes.Should().NotBeNull().And.BeEmpty(
            "the old row counted its refusals and did not name them");
        oldRefusal.PersonId.Should().BeNull();
        oldRefusal.AppVersion.Should().BeNull();
        oldRefusal.ServerBuild.Should().BeNull();

        var empty = Row(rows, emptyId);
        empty.EventType.Should().Be("api.slow");
        empty.Endpoint.Should().BeNull();
        empty.StatusCode.Should().BeNull();
        empty.RejectedWorkCodes.Should().NotBeNull().And.BeEmpty();
        ShouldCarryNoReport(empty);
    }

    // ------------------------------------------------------------------
    // The person: a name, and never a phone number
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_person_is_named_and_their_phone_number_is_not_returned()
    {
        var at = Day(7);
        var sunita = Guid.NewGuid();
        var nobodyOnRecord = Guid.NewGuid();
        var phone = await UserAsync(sunita, "Sunita Pawar");

        // Sunita, once as the person of a server-written row and once as the
        // sender of her app's report.
        var error = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: sunita);
        error["errorCode"] = "Uncatalogued";
        error["workKept"] = "unknown";
        var errorId = await ServerRowAsync("api.error", at, error);

        var reportId = await AppRowAsync("sync.push_outcome", at.AddMinutes(1), sunita,
            new Dictionary<string, object?>
            {
                ["recoveredCount"] = 1,
                ["needsReviewCount"] = 0,
                ["pendingAfter"] = 0,
                ["appVersion"] = "1.0.18",
            });

        // And a person with no user record.
        var orphan = MiddlewareProps(
            "POST /shramsafal/cropcycles", 409, "POST /shramsafal/cropcycles", personId: nobodyOnRecord);
        var orphanId = await ServerRowAsync("api.refused", at.AddMinutes(2), orphan);

        var rows = Mine(await Recorded(at.AddMinutes(-1)));

        Row(rows, errorId).PersonName.Should().Be("Sunita Pawar", "named through props.personId");
        Row(rows, reportId).PersonName.Should().Be("Sunita Pawar", "named through the actor column");

        var unnamed = Row(rows, orphanId);
        unnamed.PersonId.Should().Be(nobodyOnRecord, "the person is still reported");
        unnamed.PersonName.Should().BeNull("a person with no user record has no name, and none is made up");

        // What a caller would receive for these rows.
        var json = JsonSerializer.Serialize(rows, WebJson);

        using var doc = JsonDocument.Parse(json);
        var first = doc.RootElement.EnumerateArray().First(e => e.GetProperty("eventId").GetGuid() == errorId);

        first.GetProperty("personName").GetString().Should().Be("Sunita Pawar", "the JSON has the person's name");

        doc.RootElement.EnumerateArray()
            .SelectMany(e => e.EnumerateObject())
            .Select(p => p.Name)
            .Should().NotContain(name => name.Contains("phone", StringComparison.OrdinalIgnoreCase),
                "the row has no property for a phone number");

        json.Should().NotContain(phone,
            "the phone number on Sunita's user record occurs nowhere in the answer: the query "
            + "joins that record for the name only");
        json.Should().NotContain(phone[2..], "nor without its prefix");
    }

    // ------------------------------------------------------------------
    // The second lock: who wrote the row
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_row_of_a_server_written_type_that_carries_an_actor_is_not_returned()
    {
        var at = Day(8);
        var attacker = Guid.NewGuid();
        var victim = Guid.NewGuid();
        await UserAsync(attacker, "Somebody Signed In");
        await UserAsync(victim, "Sunita Pawar");

        var forged = new List<Guid>();
        var minute = 0;

        foreach (var type in ServerWrittenTypes)
        {
            // 1. Exactly what POST /analytics/ingest wrote for a signed-in
            //    account before it refused server-only types: the caller as
            //    the actor, the role "user", no trigger. The props are
            //    well-formed and name somebody else.
            var props = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: victim);
            props["errorCode"] = "ShramSafal.CropCycleOverlap";
            props["workKept"] = "lost";
            props["rejectedWorkItems"] = 4;
            props["rejectedWorkCodes"] = new[] { "ShramSafal.SyncInvalidPayload" };

            forged.Add(await EventAsync(type, at.AddMinutes(minute++), Json(props),
                actorRole: "user", actorUserId: attacker, trigger: string.Empty));

            // 2. The same with the server's own role and trigger copied: it
            //    still carries an actor, and the middleware never sets one.
            forged.Add(await EventAsync(type, at.AddMinutes(minute++), Json(props),
                actorRole: "system", actorUserId: attacker, trigger: "middleware"));
        }

        var onlyForged = await Recorded(at.AddMinutes(-1));

        onlyForged.Select(r => r.EventId).Should().NotIntersectWith(forged,
            "a row of a server-written type that carries an actor was not written by the server; "
            + "it must never read back as a server failure");
        onlyForged.Should().NotContain(r => r.PersonId == victim,
            "the person the forged rows named has no failure on record");
        Mine(onlyForged).Should().BeEmpty();

        // The control: the row the middleware really writes for each of the
        // four types (no actor) IS read. So the rows above were left out for
        // their actor and for no other reason.
        var real = new List<Guid>();
        foreach (var type in ServerWrittenTypes)
        {
            var props = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: victim);
            real.Add(await ServerRowAsync(type, at.AddMinutes(minute++), props));
        }

        var rows = Mine(await Recorded(at.AddMinutes(-1)));

        rows.Select(r => r.EventId).Should().BeEquivalentTo(real,
            "only the server's own four rows are read; the eight forged ones are still not");
        rows.Should().OnlyContain(r => r.PersonId == victim && r.PersonName == "Sunita Pawar");
    }

    [Fact]
    public async Task A_row_of_a_client_type_with_no_actor_is_not_returned()
    {
        var at = Day(9);
        var sunita = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        var report = new Dictionary<string, object?>
        {
            ["recoveredCount"] = 3,
            ["needsReviewCount"] = 0,
            ["pendingAfter"] = 0,
            ["appVersion"] = "1.0.18",
        };
        var clientError = new Dictionary<string, object?> { ["message"] = "TypeError: x is undefined" };

        var senderless = new List<Guid>
        {
            // What ingest writes when it is given no user.
            await EventAsync("sync.push_outcome", at, Json(report), actorRole: "anonymous", trigger: string.Empty),
            await EventAsync("client.error", at.AddMinutes(1), Json(clientError), actorRole: "anonymous", trigger: string.Empty),

            // The envelope of the server's own middleware, on a type the
            // server never writes.
            await EventAsync("sync.push_outcome", at.AddMinutes(2), Json(report)),
            await EventAsync("client.error", at.AddMinutes(3), Json(clientError)),

            // No actor, and a personId in props in place of one: a report's
            // person is its sender, never a name it gives itself.
            await EventAsync("sync.push_outcome", at.AddMinutes(4),
                Json(new Dictionary<string, object?>(report) { ["personId"] = sunita.ToString("D") }),
                actorRole: "user", trigger: string.Empty),
        };

        var onlySenderless = await Recorded(at.AddMinutes(-1));

        onlySenderless.Select(r => r.EventId).Should().NotIntersectWith(senderless,
            "a row of a client type is read only when the ingest route stamped its sender; a "
            + "report from nobody cannot be matched to a person and is not read");
        onlySenderless.Should().NotContain(r => r.PersonId == sunita);
        Mine(onlySenderless).Should().BeEmpty();

        // The control: the same two types, as ingest writes them for a
        // signed-in person, ARE read.
        var reportId = await AppRowAsync("sync.push_outcome", at.AddMinutes(10), sunita, report);
        var errorId = await AppRowAsync("client.error", at.AddMinutes(11), sunita, clientError);

        var rows = Mine(await Recorded(at.AddMinutes(-1)));

        rows.Select(r => r.EventId).Should().BeEquivalentTo(new[] { reportId, errorId },
            "only the two rows with a sender are read; the five without one are still not");
        rows.Should().OnlyContain(r => r.PersonId == sunita && r.PersonName == "Sunita Pawar");
        Row(rows, reportId).RecoveredCount.Should().Be(3);
    }

    // ------------------------------------------------------------------
    // Which rows, and in what order
    // ------------------------------------------------------------------

    [Fact]
    public async Task Each_of_the_six_recorded_types_is_returned_and_no_other_type_is()
    {
        var at = Day(10);
        var sunita = Guid.NewGuid();
        await UserAsync(sunita, "Sunita Pawar");

        var expected = new Dictionary<Guid, string>();
        var minute = 0;

        foreach (var type in ServerWrittenTypes)
        {
            var props = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: sunita);
            expected[await ServerRowAsync(type, at.AddMinutes(minute++), props)] = type;
        }

        expected[await AppRowAsync("client.error", at.AddMinutes(minute++), sunita,
            new Dictionary<string, object?> { ["message"] = "TypeError: x is undefined" })] = "client.error";

        expected[await AppRowAsync("sync.push_outcome", at.AddMinutes(minute++), sunita,
            new Dictionary<string, object?>
            {
                ["recoveredCount"] = 1,
                ["needsReviewCount"] = 0,
                ["pendingAfter"] = 0,
                ["appVersion"] = "1.0.18",
            })] = "sync.push_outcome";

        // Other things that live in the same table, in both envelopes. None
        // of them is a recorded failure or a report.
        var personProps = new Dictionary<string, object?>
        {
            ["personId"] = sunita.ToString("D"),
            ["farmId"] = Guid.NewGuid().ToString("D"),
            ["appVersion"] = "1.0.18",
        };

        foreach (var type in new[] { "log.created", "ai.invocation", "worker.named", "admin.farmer_lookup" })
        {
            await ServerRowAsync(type, at.AddMinutes(minute++), personProps);
        }

        foreach (var type in new[] { "closure.started", "closure.submitted", "proof.attached", "next_action.created" })
        {
            await AppRowAsync(type, at.AddMinutes(minute++), sunita, personProps);
        }

        var rows = Mine(await Recorded(at.AddMinutes(-1)));

        rows.ToDictionary(r => r.EventId, r => r.EventType).Should().BeEquivalentTo(expected,
            "the six recorded types are read, each as its own type, and the eight rows of other "
            + "types in the same window are not");
        rows.Should().OnlyContain(r => r.PersonId == sunita,
            "four of them name her in props and two of them have her as their sender");
    }

    [Fact]
    public async Task Rows_come_back_newest_first_and_only_from_the_asked_for_time_on()
    {
        var at = Day(11);
        var sunita = Guid.NewGuid();

        var props = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: sunita);
        var report = new Dictionary<string, object?>
        {
            ["recoveredCount"] = 1,
            ["needsReviewCount"] = 0,
            ["pendingAfter"] = 0,
            ["appVersion"] = "1.0.18",
        };

        // Inserted out of order on purpose.
        var second = await AppRowAsync("sync.push_outcome", at.AddMinutes(2), sunita, report);
        var before = await ServerRowAsync("api.error", at.AddMinutes(-30), props);
        var third = await ServerRowAsync("api.refused", at.AddMinutes(3), props);
        var first = await ServerRowAsync("api.error", at.AddMinutes(1), props);

        var rows = Mine(await Recorded(at));

        rows.Select(r => r.EventId).Should().Equal(
            new[] { third, second, first },
            "newest first, whichever type a row is; and the row from half an hour before the "
            + "asked-for time is not in the answer");

        // The control: asked from before all four, the earlier row is there
        // too, and last. So it was left out above for its time alone.
        var all = Mine(await Recorded(at.AddHours(-1)));

        all.Select(r => r.EventId).Should().Equal(third, second, first, before);

        // And asked from after all of them, none of this test's rows is read.
        Mine(await Recorded(at.AddHours(1))).Should().BeEmpty();
    }

    // ------------------------------------------------------------------
    // A row that cannot be read must not cost the whole answer
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_row_with_unreadable_values_does_not_fail_the_read()
    {
        var at = Day(12);
        var sender = Guid.NewGuid();
        var sunita = Guid.NewGuid();

        // The ingest route checks that a report's keys are present and not
        // null. It does not check what they hold, so any signed-in account
        // can leave this row in a table that can never be cleaned.
        var badReportId = await AppRowAsync("sync.push_outcome", at.AddMinutes(1), sender,
            new Dictionary<string, object?>
            {
                ["recoveredCount"] = "many",
                ["needsReviewCount"] = true,
                ["pendingAfter"] = new Dictionary<string, object?> { ["n"] = 1 },
                ["appVersion"] = "1.0.18",
            });

        // The server's own rows are well-formed today. Should one ever not
        // be, it stays for ever as well.
        var badServerRowId = await ServerRowAsync("sync.mutation_rejected", at.AddMinutes(2),
            new Dictionary<string, object?>
            {
                ["endpoint"] = "POST /sync/push",
                ["statusCode"] = "two hundred",
                ["rejectedWorkItems"] = "three",
                ["rejectedWorkCodes"] = "ShramSafal.SyncInvalidPayload",
                ["personId"] = "not-a-person",
                ["routeFarmId"] = "nowhere",
            });

        // The control: a well-formed row among them.
        var good = MiddlewareProps("POST /shramsafal/logs", 500, "POST /shramsafal/logs", personId: sunita);
        var goodId = await ServerRowAsync("api.error", at.AddMinutes(3), good);

        Func<Task<IReadOnlyList<OpsRecordedRowDto>>> read = () => Recorded(at);

        var rows = (await read.Should().NotThrowAsync(
            "one row that cannot be read must cost that row at most. If it failed the query, the "
            + "route would answer 503 for as long as the row is inside the window, and nobody "
            + "could remove it")).Subject;

        Row(rows, goodId).StatusCode.Should().Be(500, "the good row beside them is still returned, intact");

        // Whether an unreadable row is left out or returned is not pinned.
        // What is: nothing is made up for the values that could not be read.
        var badReport = rows.SingleOrDefault(r => r.EventId == badReportId);
        if (badReport is not null)
        {
            badReport.RecoveredCount.Should().BeNull("\"many\" is not a count");
            badReport.NeedsReviewCount.Should().BeNull("true is not a count");
            badReport.PendingAfter.Should().BeNull("an object is not a count");
            badReport.PersonId.Should().Be(sender);
        }

        var badServerRow = rows.SingleOrDefault(r => r.EventId == badServerRowId);
        if (badServerRow is not null)
        {
            badServerRow.StatusCode.Should().BeNull("\"two hundred\" is not a status code");
            badServerRow.RejectedWorkItems.Should().BeNull("\"three\" is not a count");
            badServerRow.PersonId.Should().BeNull("\"not-a-person\" is not a person's id");
            badServerRow.PersonName.Should().BeNull();
            badServerRow.RouteFarmId.Should().BeNull("\"nowhere\" is not a farm's id");
            badServerRow.RejectedWorkCodes.Should().NotBeNull();
        }
    }

    // ------------------------------------------------------------------
    // Asking the real repository
    // ------------------------------------------------------------------

    /// <summary>
    /// One question to the real <see cref="AdminOpsRepository"/>, through its
    /// port, in a scope of its own (as each request has).
    /// </summary>
    private async Task<IReadOnlyList<OpsRecordedRowDto>> Recorded(DateTime sinceUtc)
    {
        await using var scope = fixture.Services.CreateAsyncScope();

        IAdminOpsRepository repository = new AdminOpsRepository(
            scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>(),
            scope.ServiceProvider.GetRequiredService<ILogger<AdminOpsRepository>>());

        return await repository.GetRecordedAsync(sinceUtc);
    }

    /// <summary>The rows this test inserted, in the order the repository returned them.</summary>
    private IReadOnlyList<OpsRecordedRowDto> Mine(IReadOnlyList<OpsRecordedRowDto> rows) =>
        rows.Where(r => _eventIds.Contains(r.EventId)).ToList();

    /// <summary>The one returned row with this id; fails when it is absent or returned twice.</summary>
    private static OpsRecordedRowDto Row(IReadOnlyList<OpsRecordedRowDto> rows, Guid eventId)
    {
        rows.Where(r => r.EventId == eventId).Should().ContainSingle(
            "the row that was recorded is read back, once");
        return rows.Single(r => r.EventId == eventId);
    }

    /// <summary>The three report counts are set only on <c>sync.push_outcome</c> rows.</summary>
    private static void ShouldCarryNoReport(OpsRecordedRowDto row)
    {
        row.RecoveredCount.Should().BeNull("only the app's own report carries counts; a 0 here would be an invented measurement");
        row.NeedsReviewCount.Should().BeNull();
        row.PendingAfter.Should().BeNull();
    }

    // ------------------------------------------------------------------
    // Seeding, by plain SQL against the real tables
    // ------------------------------------------------------------------

    private static string Json(Dictionary<string, object?> props) => JsonSerializer.Serialize(props);

    /// <summary>
    /// The keys <c>RequestObservabilityProps.Build</c> writes on every row the
    /// request middleware emits, since ADR 0027: the person, the addressed
    /// farm, the route and the build are absent keys when there is no value;
    /// <c>appVersion</c> is always present and is null without the header.
    /// A test adds the keys of its own row type on top.
    /// </summary>
    private static Dictionary<string, object?> MiddlewareProps(
        string endpoint,
        int statusCode,
        string? route,
        Guid? personId = null,
        Guid? routeFarmId = null,
        string? appVersion = "1.0.18")
    {
        var props = new Dictionary<string, object?>
        {
            ["endpoint"] = endpoint,
            ["statusCode"] = statusCode,
            ["latencyMs"] = 412,
            ["traceId"] = "0af7651916cd43dd8448eb211c80319c",
            ["rejectedWorkItems"] = null,
            ["rejectedWorkReason"] = null,
        };

        if (personId is { } person)
        {
            props["personId"] = person.ToString("D");
        }

        if (routeFarmId is { } farm)
        {
            props["routeFarmId"] = farm.ToString("D");
        }

        if (route is not null)
        {
            props["route"] = route;
        }

        props["serverBuild"] = ServerBuild;
        props["appVersion"] = appVersion;
        return props;
    }

    /// <summary>
    /// A row as the server's request middleware writes it: no actor, no farm
    /// column, role <c>system</c>, trigger <c>middleware</c>.
    /// </summary>
    private Task<Guid> ServerRowAsync(string eventType, DateTime atUtc, Dictionary<string, object?> props) =>
        EventAsync(eventType, atUtc, Json(props));

    /// <summary>
    /// A row as <c>POST /analytics/ingest</c> writes it for a signed-in
    /// person: the sender as the actor, role <c>user</c>, no trigger.
    /// </summary>
    private Task<Guid> AppRowAsync(string eventType, DateTime atUtc, Guid sender, Dictionary<string, object?> props) =>
        EventAsync(eventType, atUtc, Json(props), actorRole: "user", actorUserId: sender, trigger: string.Empty);

    /// <summary>
    /// One row in <c>analytics.events</c>; returns its id. The defaults are
    /// the envelope the server's own middleware writes.
    /// </summary>
    private async Task<Guid> EventAsync(
        string eventType,
        DateTime occurredAtUtc,
        string propsJson,
        string actorRole = "system",
        Guid? actorUserId = null,
        string trigger = "middleware")
    {
        var id = Guid.NewGuid();
        _eventIds.Add(id);

        await ExecuteAsync(
            """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id,
                 actor_role, trigger, schema_version, props)
            VALUES
                (@id, @type, @at, @actor, NULL,
                 @role, @trigger, 'v1', @props::jsonb)
            """,
            cmd =>
            {
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("type", eventType);
                cmd.Parameters.AddWithValue("at", occurredAtUtc);
                cmd.Parameters.Add(new NpgsqlParameter("actor", NpgsqlDbType.Uuid)
                {
                    Value = (object?)actorUserId ?? DBNull.Value,
                });
                cmd.Parameters.AddWithValue("role", actorRole);
                cmd.Parameters.AddWithValue("trigger", trigger);
                cmd.Parameters.AddWithValue("props", propsJson);
            });

        return id;
    }

    /// <summary>
    /// One row in <c>public.users</c>; returns the phone number it was given.
    /// The columns are the ones <c>UserConfiguration</c> maps as required and
    /// gives no default. The phone number is random digits (that column is
    /// unique) and belongs to nobody.
    /// </summary>
    private async Task<string> UserAsync(Guid person, string displayName)
    {
        var phone = "55" + Random.Shared.NextInt64(0, 10_000_000_000).ToString("D10");

        await ExecuteAsync(
            """
            INSERT INTO public.users
                ("Id", phone, display_name, password_hash,
                 credential_created_at_utc, created_at_utc)
            VALUES
                (@id, @phone, @name, @marker,
                 @at, @at)
            """,
            cmd =>
            {
                cmd.Parameters.AddWithValue("id", person);
                cmd.Parameters.AddWithValue("phone", phone);
                cmd.Parameters.AddWithValue("name", displayName);
                cmd.Parameters.AddWithValue("marker", UserMarker);
                cmd.Parameters.AddWithValue("at", Day(1));
            });

        return phone;
    }

    /// <summary>Removes the users this class inserted. Its events are left where they are.</summary>
    private Task RemoveOwnUsersAsync() =>
        ExecuteAsync(
            "DELETE FROM public.users WHERE password_hash = @marker",
            cmd => cmd.Parameters.AddWithValue("marker", UserMarker));

    private async Task ExecuteAsync(string sql, Action<NpgsqlCommand> bind)
    {
        await using var conn = new NpgsqlConnection(fixture.ConnectionString);
        await conn.OpenAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        bind(cmd);
        await cmd.ExecuteNonQueryAsync();
    }
}
