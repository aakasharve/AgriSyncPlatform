using AgriSync.BuildingBlocks.Analytics;
using System.Diagnostics;
using System.Security.Claims;

namespace AgriSync.Bootstrapper.Middleware;

/// <summary>
/// Ops Observability Phase 1 — intercepts every request and emits one
/// <c>api.error</c> or <c>api.slow</c> event into <c>analytics.events</c>
/// when a response is a failure or unusually slow.
///
/// What gets emitted (and why):
///   5xx responses  → always (server bug the farmer can't work around)
///   4xx on critical write endpoints → always (farmer's core action blocked)
///   >2000ms on any POST/PUT/PATCH → api.slow (farmer on Jio gave up)
///   2xx that refused work inside it → api.error (RG5, see below)
///
/// What is NOT emitted (to avoid noise):
///   2xx/3xx success responses that actually succeeded
///   4xx on read/reference-data endpoints
///   GET requests slower than 2s (expected for large pulls)
///
/// <para>
/// <b>RG5 (Rulebook §4.1 — Observability), added 2026-08-26.</b> Every rule above
/// except the fourth is driven by the response status code, which left one class
/// of failure structurally invisible to this middleware: a batch endpoint that
/// answers <c>200</c> while rejecting some of the work inside it.
/// <c>POST /sync/push</c> is precisely that — a farmer's mutation could be
/// refused and nothing anywhere emitted a thing. The endpoint now stamps
/// <see cref="RequestObservabilityKeys.RejectedWorkItemCount"/> and this
/// middleware treats it as an error condition. The status code is unchanged
/// (<c>P11</c> old-client compatibility).
/// </para>
///
/// <para>
/// The emit itself is fire-and-forget wrapped in try/catch — observability must
/// NEVER break a request that would otherwise succeed. It is not swallowed: a
/// failed emit is logged at <c>Warning</c>, which is the production Serilog
/// minimum level, so it lands in the API log on the box. (It was
/// <c>LogDebug</c> until 2026-08-26, i.e. below the production threshold and
/// therefore invisible — an observability failure that was itself unobservable.)
/// </para>
/// </summary>
public sealed class RequestObservabilityMiddleware(
    RequestDelegate next,
    IServiceScopeFactory scopeFactory,
    ILogger<RequestObservabilityMiddleware> logger)
{
    private static readonly string[] CriticalPathFragments =
    [
        "/logs", "/sync/push", "/ai/parse-voice", "/ai/extract",
        "/schedule/adopt", "/schedule/migrate", "/schedule/abandon",
        "/farms", "/verif"
    ];

    public async Task InvokeAsync(HttpContext ctx)
    {
        var sw = Stopwatch.StartNew();
        await next(ctx);
        sw.Stop();

        var status = ctx.Response.StatusCode;
        var method = ctx.Request.Method;
        var path = ctx.Request.Path.Value ?? string.Empty;
        var ms = (int)sw.ElapsedMilliseconds;
        var isWrite = method is "POST" or "PUT" or "PATCH" or "DELETE";

        var isError = status >= 500;
        var isCritical4xx = status is >= 400 and < 500
                         && isWrite
                         && CriticalPathFragments.Any(f =>
                                path.Contains(f, StringComparison.OrdinalIgnoreCase));
        var isSlow = isWrite && ms > 2000 && status < 400;

        // RG5 — the status code says success, the endpoint says otherwise.
        var rejectedWorkItems = TryExtractRejectedWorkItems(ctx);
        var hasRejectedWork = rejectedWorkItems > 0;

        if (!isError && !isCritical4xx && !isSlow && !hasRejectedWork) return;

        // A refused work item inside a 2xx is NOT an api.error. It gets its own
        // type so the existing api.error consumers keep their meaning — see the
        // comment on AnalyticsEventType.SyncMutationRejected for what breaks
        // otherwise (a false founder page from mis.alert_r9_api_error_spike).
        // A genuine 5xx still wins: if the request also failed, that is the
        // more urgent fact and it is reported as such.
        var eventType = (isError || isCritical4xx)
            ? AnalyticsEventType.ApiError
            : hasRejectedWork
                ? AnalyticsEventType.SyncMutationRejected
                : AnalyticsEventType.ApiSlow;

        var farmId = TryExtractFarmId(ctx.User);
        var traceId = Activity.Current?.TraceId.ToString()
                   ?? ctx.TraceIdentifier;

        var props = System.Text.Json.JsonSerializer.Serialize(new
        {
            endpoint = $"{method} {path}",
            statusCode = status,
            latencyMs = ms,
            traceId,
            // Null on every pre-existing emit path, so existing consumers of
            // analytics.events are unaffected. Non-null means: the response
            // carried this many refused work items despite its status code.
            // Codes and counts only — never farmer content.
            rejectedWorkItems = hasRejectedWork ? rejectedWorkItems : (int?)null,
            rejectedWorkReason = hasRejectedWork
                ? ctx.Items[RequestObservabilityKeys.RejectedWorkReason] as string
                : null
        });

        // Fire-and-forget in a new scope — IAnalyticsWriter is scoped
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var analytics = scope.ServiceProvider.GetRequiredService<IAnalyticsWriter>();
                await analytics.EmitAsync(new AnalyticsEvent(
                    EventId: Guid.NewGuid(),
                    EventType: eventType,
                    OccurredAtUtc: DateTime.UtcNow,
                    ActorUserId: null,
                    FarmId: farmId.HasValue ? new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId.Value) : null,
                    OwnerAccountId: null,
                    ActorRole: "system",
                    Trigger: "middleware",
                    DeviceOccurredAtUtc: null,
                    SchemaVersion: "v1",
                    PropsJson: props));
            }
            catch (Exception ex)
            {
                // Do not rethrow — observability must never crash the app — but
                // do not hide it either. Warning is the production Serilog
                // minimum level, so this lands in /var/log/agrisync/api-*.log
                // on the box. That is the named landing place for a failed
                // emit; LogDebug (the previous level) was below the production
                // threshold and therefore went nowhere.
                logger.LogWarning(
                    ex,
                    "RequestObservabilityEmitFailed: eventType={EventType} endpoint={Endpoint} "
                    + "statusCode={StatusCode} exceptionType={ExceptionType}. "
                    + "This analytics row is lost; the metric/log signals at the emit site are not.",
                    eventType,
                    // The path comes off the request line, so it is
                    // attacker-controlled — CWE-117, CodeQL on PR #56. The
                    // method is matched by the router and eventType is one of
                    // our own constants; neither needs wrapping.
                    LogSafe.Text($"{method} {path}"),
                    status,
                    ex.GetType().Name);
            }
        });
    }

    private static Guid? TryExtractFarmId(ClaimsPrincipal? user)
    {
        if (user is null) return null;
        var raw = user.FindFirstValue("farm_id")
               ?? user.FindFirstValue("farmId");
        return raw is not null && Guid.TryParse(raw, out var id) ? id : null;
    }

    /// <summary>
    /// RG5 — reads the count of work items an otherwise-successful response
    /// refused, stamped by the endpoint via
    /// <see cref="RequestObservabilityKeys.RejectedWorkItemCount"/>. Returns 0
    /// when absent, which is every request that did not opt in.
    /// </summary>
    private static int TryExtractRejectedWorkItems(HttpContext ctx)
    {
        return ctx.Items.TryGetValue(RequestObservabilityKeys.RejectedWorkItemCount, out var raw)
            && raw is int count
            && count > 0
                ? count
                : 0;
    }
}
