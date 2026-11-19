// spec: error-capture-engine
//
// Task 4 — the api.error props bag. xUnit Assert directly — no
// FluentAssertions dep in BuildingBlocks tests (project convention,
// ConsentEnforcerTests.cs:5-6).

using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

/// <summary>
/// The props bag is built here rather than inline in the middleware so its
/// contract can be asserted directly: the middleware writes through
/// IAnalyticsWriter and never passes IngestEventsValidator, so nothing else
/// checks it at runtime.
/// </summary>
public sealed class RequestObservabilityPropsTests
{
    private static DefaultHttpContext Ctx(string method, string path, int status)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        ctx.Request.Path = path;
        ctx.Response.StatusCode = status;
        return ctx;
    }

    [Fact]
    public void An_api_error_reports_the_code_the_endpoint_actually_answered()
    {
        var farm = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var ctx = Ctx("POST", "/shramsafal/logs", 409);
        ctx.Request.Headers["X-App-Version"] = "1.0.9";
        ctx.Items[RequestObservabilityKeys.ErrorCode] = "ShramSafal.CropCycleOverlap";

        var props = RequestObservabilityProps.Build(
            ctx,
            eventType: AnalyticsEventType.ApiError,
            status: 409,
            latencyMs: 42,
            rejectedWorkItems: null,
            rejectedWorkReason: null,
            farmId: farm,
            traceId: "trace-1",
            unhandledExceptionType: null,
            personId: null,
            routeFarmId: null,
            routePattern: null,
            serverBuild: null,
            rejectedWorkCodes: null);

        Assert.Equal("ShramSafal.CropCycleOverlap", props["errorCode"]);
        Assert.Equal("1.0.9", props["appVersion"]);
        Assert.Equal("POST /shramsafal/logs", props["endpoint"]);
        Assert.Equal(409, props["statusCode"]);
        // farmId is an api.error prop in the vocabulary, so it stays on THIS
        // event type — the 2026-08-31 ruling narrowed it to api.error, it did
        // not delete it.
        Assert.Equal(farm, props["farmId"]);
        // Authored text from the explanation catalogue — never the raw
        // Error.Description, which is interpolated in several places.
        Assert.Equal(
            "Two crop cycles claim the same plot over the same dates.",
            props["message"]);
    }

    [Fact]
    public void The_key_three_live_SQL_readers_use_is_statusCode_not_status()
    {
        var ctx = Ctx("GET", "/shramsafal/farms", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // AdminOpsRepository.GetRecentErrorsAsync, its GetErrorsPagedAsync,
        // and AdminFarmerHealthRepository all read props->>'statusCode'.
        // On an absent key Postgres yields NULL, not an error, so a rename
        // here would degrade the admin console. AdminOpsRepository now LOGS
        // that failure (2026-08-31); AdminFarmerHealthRepository still has ten
        // bare `catch { /* graceful */ }` blocks and stays silent. Renaming
        // needs its own plan and a reader migration.
        Assert.True(props.ContainsKey("statusCode"));
        Assert.False(props.ContainsKey("status"));
    }

    [Fact]
    public void An_unknown_outcome_is_stated_as_unknown_and_never_as_kept()
    {
        var ctx = Ctx("GET", "/shramsafal/farms", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("unknown", props["workKept"]);
        Assert.Equal("Uncatalogued", props["errorCode"]);
        Assert.Null(props["message"]);
    }

    [Fact]
    public void A_failed_write_is_unknown_not_lost_because_several_409s_mean_it_was_stored()
    {
        // ShramSafal.DuplicateLogRequest is a 409 that fires BECAUSE the log
        // already exists. Recording "lost" here would be a fabricated fact (P4)
        // read as evidence a farmer lost a day's work.
        var ctx = Ctx("POST", "/shramsafal/logs", 409);
        ctx.Items[RequestObservabilityKeys.ErrorCode] = "ShramSafal.DuplicateLogRequest";

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 409, 5, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("unknown", props["workKept"]);
    }

    [Fact]
    public void Work_is_reported_lost_only_when_refused_work_was_actually_counted()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 200, 900, 3, "sync.mutation_rejected", null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("lost", props["workKept"]);
        Assert.Equal(3, props["rejectedWorkItems"]);
        Assert.Equal("sync.mutation_rejected", props["rejectedWorkReason"]);
    }

    [Fact]
    public void An_unhandled_exception_names_its_type_and_never_its_message()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 12, null, null, null, "t",
            unhandledExceptionType: "NullReferenceException",
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("Exception:NullReferenceException", props["errorCode"]);
        Assert.Equal(500, props["statusCode"]);
        Assert.Null(props["message"]);
        Assert.False(props.ContainsKey("exceptionMessage"));
    }

    [Fact]
    public void A_slow_but_successful_request_is_not_given_an_error_identity()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // api.slow SUCCEEDED. Calling it "Uncatalogued" would be noise in the
        // ops list, and a workKept verdict would be a claim nothing observed.
        // That is still true after ADR 0027: D5 reverses the 2026-08-31 ruling
        // that this row keeps exactly its earlier shape, so a slow row now
        // gains appVersion (present with null when no header was sent, as on
        // api.error) and, each only when there is a value, route,
        // serverBuild, personId and routeFarmId (D3) — and it still gains
        // no error identity.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.False(props.ContainsKey("message"));
        // The keys this row has always carried keep their names and values;
        // ADR 0027 adds keys beside them and renames none.
        Assert.Equal("POST /shramsafal/logs", props["endpoint"]);
        Assert.Equal(200, props["statusCode"]);
        Assert.Equal(3100L, props["latencyMs"]);
        // farmId (the CLAIM farm, a copy of the farm_id column) is part of the
        // api.error identity and stays below the api.error early return.
        // ADR 0027 did not move it: the farm a slow request ADDRESSED is the
        // separate key routeFarmId (D3), pinned in
        // A_slow_row_and_a_refused_sync_row_carry_the_person_too.
        Assert.False(props.ContainsKey("farmId"));
    }

    [Fact]
    public void A_rejected_mutation_keeps_its_own_shape_and_is_not_blurred_into_api_error()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // AnalyticsEventType.cs:58-71 records why this type was separated from
        // api.error: one farmer re-syncing 31 refused mutations would have
        // paged the founder about an API failure while the API was healthy.
        // That separation stands. What changed is the row's width: ADR 0027 D5
        // reverses the 2026-08-31 ruling that it keeps exactly its earlier
        // shape, so a refused sync row now gains appVersion (present with
        // null when no header was sent, as on api.error) and, each only when
        // there is a value, route, serverBuild, personId, routeFarmId and
        // rejectedWorkCodes naming what was refused (D3). It still gains no
        // error identity: no errorCode and no workKept verdict.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.Equal(2, props["rejectedWorkItems"]);
        // As on the slow row above: farmId (the claim farm) belongs to the
        // api.error identity and ADR 0027 did not move it. The addressed farm
        // is routeFarmId, and /sync/push names no farm in its route, so a
        // refused sync row carries the person and no farm at all (plan CR-1a
        // Task K2, "Known gap, accepted").
        Assert.False(props.ContainsKey("farmId"));
    }

    [Theory]
    [InlineData("1.0.9", "1.0.9")]
    [InlineData("1.0.9-beta+17", "1.0.9-beta+17")]
    [InlineData("<script>x</script>", "malformed")]
    [InlineData("मराठी", "malformed")]                                        // Devanagari
    [InlineData("1.0.9 extra", "malformed")]                                  // embedded space
    [InlineData("123456789012345678901234567890123", "malformed")]            // 33 chars, over the cap
    public void An_app_version_is_recorded_only_if_it_looks_like_a_version(string sent, string expected)
    {
        var ctx = Ctx("POST", "/sync/push", 500);
        ctx.Request.Headers["X-App-Version"] = sent;

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 1, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal(expected, props["appVersion"]);
    }

    [Fact]
    public void A_missing_app_version_is_null_and_never_the_word_malformed()
    {
        var ctx = Ctx("POST", "/sync/push", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 1, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // Absent and malformed are different facts. A client that sent nothing has
        // not misbehaved, and recording it as malformed would be a fabricated claim
        // about that client — the same rule as unmeasured never being rendered as 0.
        Assert.Null(props["appVersion"]);
    }

    // ------------------------------------------------------------------
    // spec: control-room-go-live-must-haves-2026-11-10
    // ADR 0027 D3 / D5 — plan CR-1a Tasks B1, K1, K2.
    //
    // From here down the five trailing Build arguments carry the facts under
    // test, and they are always passed by NAME: two Guids and two strings in a
    // row are exactly what a positional call lets someone swap unnoticed.
    //
    // The rule every "has no ... key" test below holds (Doctrine P4): a value
    // that was not captured is an ABSENT key — never a null placeholder, never
    // Guid.Empty, never a word such as "unknown". It is the rule for the keys
    // ADR 0027 adds: personId, routeFarmId, route, serverBuild and
    // rejectedWorkCodes.
    //
    // appVersion is older and keeps its own rule on every row type: the key
    // is present, with null when the header is missing, exactly as
    // A_missing_app_version_is_null_and_never_the_word_malformed pins it.
    // ------------------------------------------------------------------

    /// <summary>
    /// Every row type the middleware emits. ADR 0027 D3 puts the new keys on
    /// all four; that is the reversal D5 records, because until then only
    /// api.error was allowed to grow.
    /// </summary>
    private static readonly string[] EveryRowType =
    [
        AnalyticsEventType.ApiError,
        AnalyticsEventType.ApiSlow,
        AnalyticsEventType.SyncMutationRejected,
        AnalyticsEventType.ApiRefused,
    ];

    /// <summary>A status the middleware could really have observed for that row type.</summary>
    private static int AStatusFor(string rowType) => rowType switch
    {
        AnalyticsEventType.ApiError => 500,
        AnalyticsEventType.ApiRefused => 409,
        _ => 200, // api.slow and sync.mutation_rejected are both rows about a 2xx
    };

    // ---- Task B1: the person, and the farm the request addressed ----------

    [Fact]
    public void A_row_carries_the_person_when_there_is_one()
    {
        var person = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");

        foreach (var rowType in EveryRowType)
        {
            var status = AStatusFor(rowType);

            var props = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/cropcycles", status), rowType, status, 10, null, null, null, "t", null,
                personId: person, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

            Assert.True(props.ContainsKey("personId"), $"a {rowType} row has no personId key");
            // Text in the "D" format (lower case, hyphenated), not a boxed
            // Guid: it is what props->>'personId' is compared against.
            Assert.Equal("aaaaaaaa-1111-2222-3333-444444444444", props["personId"]);
        }
    }

    [Fact]
    public void A_row_with_no_person_has_no_person_key()
    {
        foreach (var rowType in EveryRowType)
        {
            var status = AStatusFor(rowType);

            var props = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/cropcycles", status), rowType, status, 10, null, null, null, "t", null,
                personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

            // A failure from nobody is still a row (the spec keeps a server
            // failure from an anonymous request). It says "nobody" by having
            // no key, so a reader can never mistake a placeholder for a person.
            Assert.False(props.ContainsKey("personId"), $"a {rowType} row from nobody has a personId key");
        }
    }

    [Fact]
    public void A_row_carries_the_farm_the_route_addressed()
    {
        var claimFarm = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var addressedFarm = Guid.Parse("bbbbbbbb-1111-2222-3333-444444444444");
        const string path = "/shramsafal/farms/bbbbbbbb-1111-2222-3333-444444444444/logs";

        foreach (var rowType in EveryRowType)
        {
            var status = AStatusFor(rowType);

            var props = RequestObservabilityProps.Build(
                Ctx("POST", path, status), rowType, status, 10, null, null, claimFarm, "t", null,
                personId: null, routeFarmId: addressedFarm, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

            Assert.True(props.ContainsKey("routeFarmId"), $"a {rowType} row has no routeFarmId key");
            Assert.Equal("bbbbbbbb-1111-2222-3333-444444444444", props["routeFarmId"]);

            // A route that names no farm (POST /sync/push, POST /shramsafal/cropcycles).
            var unaddressed = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/cropcycles", status), rowType, status, 10, null, null, claimFarm, "t", null,
                personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

            Assert.False(
                unaddressed.ContainsKey("routeFarmId"),
                $"a {rowType} row whose route names no farm has a routeFarmId key");
        }

        // Two different facts, kept apart. farmId is the farm in the caller's
        // token (the twin of the farm_id column, api.error only). routeFarmId
        // is the farm the request ADDRESSED, and is not proof that the person
        // belongs to it (ADR 0027 D3). Neither may stand in for the other.
        var error = RequestObservabilityProps.Build(
            Ctx("POST", path, 500), AnalyticsEventType.ApiError, 500, 10, null, null, claimFarm, "t", null,
            personId: null, routeFarmId: addressedFarm, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal(claimFarm, error["farmId"]);
        Assert.Equal("bbbbbbbb-1111-2222-3333-444444444444", error["routeFarmId"]);
    }

    [Fact]
    public void A_slow_row_and_a_refused_sync_row_carry_the_person_too()
    {
        var person = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");
        var addressedFarm = Guid.Parse("bbbbbbbb-1111-2222-3333-444444444444");

        var slow = RequestObservabilityProps.Build(
            Ctx("POST", "/shramsafal/farms/bbbbbbbb-1111-2222-3333-444444444444/logs", 200),
            AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null,
            personId: person, routeFarmId: addressedFarm, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        var refusedSync = RequestObservabilityProps.Build(
            Ctx("POST", "/shramsafal/sync/push", 200),
            AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
            personId: person, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // Both keys are written ABOVE the early return that ends a non-error
        // row. Written below it, the person would be recorded for a crash and
        // lost for a refused save — which is the main way work is saved.
        Assert.Equal("aaaaaaaa-1111-2222-3333-444444444444", slow["personId"]);
        Assert.Equal("aaaaaaaa-1111-2222-3333-444444444444", refusedSync["personId"]);
        Assert.Equal("bbbbbbbb-1111-2222-3333-444444444444", slow["routeFarmId"]);

        // Known gap, accepted (plan CR-1a Task K2): /sync/push names no farm
        // in its route, so a refused sync row carries the person and no farm.
        Assert.False(refusedSync.ContainsKey("routeFarmId"));
    }

    // ---- Task K1: the route, the server build, the app version ------------

    [Fact]
    public void A_row_carries_the_route_pattern_not_only_the_path()
    {
        const string path = "/x/0f8fad5b-d9cb-469f-a165-70867728950e";

        foreach (var rowType in EveryRowType)
        {
            var status = AStatusFor(rowType);

            var props = RequestObservabilityProps.Build(
                Ctx("POST", path, status), rowType, status, 10, null, null, null, "t", null,
                personId: null, routeFarmId: null, routePattern: "/x/{id:guid}", serverBuild: null, rejectedWorkCodes: null);

            // The pattern is what lets a thousand failures on a thousand ids
            // be read as ONE failing route.
            Assert.True(props.ContainsKey("route"), $"a {rowType} row has no route key");
            Assert.Equal("POST /x/{id:guid}", props["route"]);

            // endpoint keeps the raw method and path it has always carried —
            // the admin SQL readers select it by that key.
            Assert.Equal("POST /x/0f8fad5b-d9cb-469f-a165-70867728950e", props["endpoint"]);
        }

        // The method in front of the pattern is the request's own.
        var deleted = RequestObservabilityProps.Build(
            Ctx("DELETE", path, 500), AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: "/x/{id:guid}", serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("DELETE /x/{id:guid}", deleted["route"]);
    }

    [Fact]
    public void A_row_with_no_matched_route_has_no_route_key()
    {
        foreach (var rowType in EveryRowType)
        {
            // null: no endpoint matched (a 404 from the router, a crash before
            // routing). Empty: an endpoint with no pattern text. Neither is a route.
            foreach (var unmatched in new string?[] { null, string.Empty })
            {
                var status = AStatusFor(rowType);

                var props = RequestObservabilityProps.Build(
                    Ctx("POST", "/nowhere", status), rowType, status, 10, null, null, null, "t", null,
                    personId: null, routeFarmId: null, routePattern: unmatched, serverBuild: null, rejectedWorkCodes: null);

                Assert.False(
                    props.ContainsKey("route"),
                    $"a {rowType} row with {(unmatched is null ? "no" : "an empty")} route pattern has a route key");
                Assert.Equal("POST /nowhere", props["endpoint"]);
            }
        }
    }

    [Fact]
    public void A_row_carries_the_server_build()
    {
        foreach (var rowType in EveryRowType)
        {
            var status = AStatusFor(rowType);

            var props = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/cropcycles", status), rowType, status, 10, null, null, null, "t", null,
                personId: null, routeFarmId: null, routePattern: null, serverBuild: "f08cd1c2", rejectedWorkCodes: null);

            Assert.True(props.ContainsKey("serverBuild"), $"a {rowType} row has no serverBuild key");
            Assert.Equal("f08cd1c2", props["serverBuild"]);
        }
    }

    [Fact]
    public void A_row_with_no_build_set_has_no_server_build_key()
    {
        foreach (var rowType in EveryRowType)
        {
            // BUILD_SHA unset, and BUILD_SHA set to nothing.
            foreach (var unset in new string?[] { null, string.Empty })
            {
                var status = AStatusFor(rowType);

                var props = RequestObservabilityProps.Build(
                    Ctx("POST", "/shramsafal/cropcycles", status), rowType, status, 10, null, null, null, "t", null,
                    personId: null, routeFarmId: null, routePattern: null, serverBuild: unset, rejectedWorkCodes: null);

                // Absent, and never the word "unknown" (ADR 0027 D3): a row
                // that claims a build it did not have would be blamed on it.
                Assert.False(
                    props.ContainsKey("serverBuild"),
                    $"a {rowType} row with {(unset is null ? "no" : "an empty")} build has a serverBuild key");
            }
        }
    }

    [Fact]
    public void A_refused_sync_row_carries_the_app_version()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);
        ctx.Request.Headers["X-App-Version"] = "1.0.18";

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        // Until ADR 0027 only an api.error row said which app sent it, so a
        // refusal that only 1.0.17 produces could not be told from one that
        // every version produces.
        Assert.Equal("1.0.18", props["appVersion"]);

        // Through the SAME sanitiser as api.error. The header is whatever a
        // client chose to send and analytics.events is append-only.
        var junk = Ctx("POST", "/shramsafal/sync/push", 200);
        junk.Request.Headers["X-App-Version"] = "<script>x</script>";

        var junkProps = RequestObservabilityProps.Build(
            junk, AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("malformed", junkProps["appVersion"]);
    }

    [Fact]
    public void A_slow_row_carries_the_app_version()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 200);
        ctx.Request.Headers["X-App-Version"] = "1.0.18";

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("1.0.18", props["appVersion"]);

        // Through the SAME sanitiser as api.error (see the refused sync row above).
        var junk = Ctx("POST", "/shramsafal/logs", 200);
        junk.Request.Headers["X-App-Version"] = "<script>x</script>";

        var junkProps = RequestObservabilityProps.Build(
            junk, AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: null);

        Assert.Equal("malformed", junkProps["appVersion"]);
    }

    // ---- Task K2: a refused sync save is named -----------------------------

    [Fact]
    public void A_refused_sync_row_carries_its_codes()
    {
        string[] codes = ["ShramSafal.CropCycleOverlap", "ShramSafal.DuplicateLogRequest"];

        var props = RequestObservabilityProps.Build(
            Ctx("POST", "/shramsafal/sync/push", 200),
            AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
            personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: codes);

        // A sequence of strings, so it is written as a JSON array. Before
        // ADR 0027 this row said only HOW MANY saves were refused.
        Assert.True(props.ContainsKey("rejectedWorkCodes"), "a refused sync row has no rejectedWorkCodes key");
        var recorded = Assert.IsAssignableFrom<IEnumerable<string>>(props["rejectedWorkCodes"]);
        Assert.Equal(codes, recorded);

        // The count and the reason that were already there are unchanged.
        Assert.Equal(2, props["rejectedWorkItems"]);
        Assert.Equal("sync.mutation_rejected", props["rejectedWorkReason"]);

        // On sync.mutation_rejected ONLY (ADR 0027 D3). The same codes handed
        // to any other row type do not appear on it.
        foreach (var otherType in EveryRowType)
        {
            if (otherType == AnalyticsEventType.SyncMutationRejected) continue;

            var status = AStatusFor(otherType);

            var other = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/sync/push", status), otherType, status, 800, 2, "sync.mutation_rejected", null, "t", null,
                personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: codes);

            Assert.False(
                other.ContainsKey("rejectedWorkCodes"),
                $"a {otherType} row has a rejectedWorkCodes key; it belongs to sync.mutation_rejected only");
        }
    }

    [Fact]
    public void A_refused_sync_row_with_no_codes_has_no_codes_key()
    {
        // null: the endpoint stamped a count and no codes. Empty: every
        // refused save had no code to name. Either way there is nothing to list.
        foreach (var none in new IReadOnlyList<string>?[] { null, Array.Empty<string>() })
        {
            var props = RequestObservabilityProps.Build(
                Ctx("POST", "/shramsafal/sync/push", 200),
                AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null,
                personId: null, routeFarmId: null, routePattern: null, serverBuild: null, rejectedWorkCodes: none);

            Assert.False(
                props.ContainsKey("rejectedWorkCodes"),
                $"a refused sync row with {(none is null ? "no" : "an empty")} code list has a rejectedWorkCodes key");

            // The refusal itself is still counted.
            Assert.Equal(2, props["rejectedWorkItems"]);
        }
    }
}
