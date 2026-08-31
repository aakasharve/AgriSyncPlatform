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
            unhandledExceptionType: null);

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
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null);

        // AdminOpsRepository.cs:99, AdminOpsRepository.cs:226 and
        // AdminFarmerHealthRepository.cs:367 all read props->>'statusCode'.
        // On an absent key Postgres yields NULL, not an error, and both
        // repositories swallow — so a rename here would degrade the admin
        // console silently. Renaming needs its own plan and a reader migration.
        Assert.True(props.ContainsKey("statusCode"));
        Assert.False(props.ContainsKey("status"));
    }

    [Fact]
    public void An_unknown_outcome_is_stated_as_unknown_and_never_as_kept()
    {
        var ctx = Ctx("GET", "/shramsafal/farms", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null);

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
            ctx, AnalyticsEventType.ApiError, 409, 5, null, null, null, "t", null);

        Assert.Equal("unknown", props["workKept"]);
    }

    [Fact]
    public void Work_is_reported_lost_only_when_refused_work_was_actually_counted()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 200, 900, 3, "sync.mutation_rejected", null, "t", null);

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
            unhandledExceptionType: "NullReferenceException");

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
            ctx, AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null);

        // api.slow SUCCEEDED. Calling it "Uncatalogued" would be noise in the
        // ops list, and a workKept verdict would be a claim nothing observed.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.False(props.ContainsKey("message"));
        // The pre-existing shape is untouched for this event type.
        Assert.Equal("POST /shramsafal/logs", props["endpoint"]);
        Assert.Equal(200, props["statusCode"]);
        Assert.Equal(3100L, props["latencyMs"]);
        // 2026-08-31 ruling: farmId belongs BELOW the api.error early return.
        // The plan's Global Constraint is that api.slow keeps EXACTLY its
        // current props shape, and the middleware has never emitted farmId in
        // props. Gaining a key here would be a widening nobody reviewed.
        Assert.False(props.ContainsKey("farmId"));
    }

    [Fact]
    public void A_rejected_mutation_keeps_its_own_shape_and_is_not_blurred_into_api_error()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null);

        // AnalyticsEventType.cs:58-71 records why this type was separated from
        // api.error: one farmer re-syncing 31 refused mutations would have
        // paged the founder about an API failure while the API was healthy.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.Equal(2, props["rejectedWorkItems"]);
        // Same ruling as above: sync.mutation_rejected was deliberately
        // separated from api.error at the type layer, and must not be widened
        // at the props layer either.
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
            ctx, AnalyticsEventType.ApiError, 500, 1, null, null, null, "t", null);

        Assert.Equal(expected, props["appVersion"]);
    }

    [Fact]
    public void A_missing_app_version_is_null_and_never_the_word_malformed()
    {
        var ctx = Ctx("POST", "/sync/push", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 1, null, null, null, "t", null);

        // Absent and malformed are different facts. A client that sent nothing has
        // not misbehaved, and recording it as malformed would be a fabricated claim
        // about that client — the same rule as unmeasured never being rendered as 0.
        Assert.Null(props["appVersion"]);
    }
}
