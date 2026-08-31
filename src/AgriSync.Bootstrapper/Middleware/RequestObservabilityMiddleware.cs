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
///   an exception that escaped the endpoint → api.error (G1, see below)
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
/// <b>G1 (spec 2026-08-30-error-capture-engine), fixed 2026-08-31.</b> Until
/// this change, an unhandled exception produced <b>no row at all</b> — not a
/// vague one, none. <c>InvokeAsync</c> had no <c>try</c>, and
/// <c>app.UseExceptionHandler()</c> is registered 39 lines <i>before</i> this
/// middleware (<c>Program.cs:542</c> vs <c>:581</c>), i.e. further out in the
/// pipeline, so an escaping exception unwound straight past the status read and
/// the emit and was caught upstream by <c>GlobalExceptionHandler</c>, which
/// wrote the 500. The single worst class of failure — the crash — was the one
/// this middleware could not see. The emit now runs from a <c>finally</c>, and
/// the exception is rethrown so the upstream handler still produces the 500.
/// Only the exception <i>type name</i> is recorded; see the note on
/// <see cref="RequestObservabilityKeys.UnhandledExceptionType"/> for why the
/// message must never be.
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
        Exception? unhandled = null;

        try
        {
            await next(ctx);
        }
        catch (Exception ex)
        {
            // Before 2026-08-31 there was no try here, and UseExceptionHandler
            // is registered OUTSIDE this middleware (Program.cs:542 vs :581),
            // so an escaping exception unwound straight past every line below
            // and the single most useful class of 500 — null reference,
            // timeout, DbUpdateException — produced no row at all.
            //
            // The rethrow is not optional: GlobalExceptionHandler upstream is
            // what actually writes the 500. Recording a failure must never
            // swallow it.
            unhandled = ex;
            throw;
        }
        finally
        {
            sw.Stop();
            // Must never throw: this runs while an exception may be
            // propagating, and a throw from a finally would REPLACE the real
            // failure with an observability bug.
            try
            {
                Observe(ctx, sw.ElapsedMilliseconds, unhandled);
            }
            catch (Exception observeEx)
            {
                logger.LogWarning(
                    observeEx,
                    "RequestObservabilityBuildFailed: endpoint={Endpoint}. No analytics row "
                    + "for this request; the request itself is unaffected.",
                    LogSafe.Text($"{ctx.Request.Method} {ctx.Request.Path}"));
            }
        }
    }

    /// <summary>
    /// Decides whether this request is worth a row and, if so, builds and emits
    /// it. Called from a <c>finally</c>, so it runs on the success path AND on
    /// the unhandled-exception path.
    /// </summary>
    /// <param name="ms">
    /// Elapsed milliseconds, kept as the <c>long</c> that
    /// <see cref="Stopwatch.ElapsedMilliseconds"/> actually returns. This used
    /// to be narrowed with an <c>(int)</c> cast for an anonymous props object
    /// that no longer exists; <see cref="RequestObservabilityProps.Build"/>
    /// takes a <c>long</c>. The JSON is byte-identical either way, so the cast
    /// bought nothing and could only ever lose information. Dropped
    /// deliberately, not by drift.
    /// </param>
    private void Observe(HttpContext ctx, long ms, Exception? unhandled)
    {
        // A farmer closing the tab mid-request is not a server failure.
        // GlobalExceptionHandler makes the same call (returns false for a
        // cancelled request rather than writing a 500).
        if (unhandled is OperationCanceledException && ctx.RequestAborted.IsCancellationRequested)
        {
            return;
        }

        var method = ctx.Request.Method;
        var path = ctx.Request.Path.Value ?? string.Empty;
        var isWrite = method is "POST" or "PUT" or "PATCH" or "DELETE";

        // On the exception path the response has NOT been written yet — the
        // handler upstream writes the 500 after we unwind — so ctx.Response
        // still reads 200. Assert the status from the exception rather than
        // reading a value that has not happened.
        var status = unhandled is not null
            ? StatusCodes.Status500InternalServerError
            : ctx.Response.StatusCode;

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

        // The whole bag comes from one place and is serialized as-is. Nothing
        // is merged in afterwards: a post-hoc merge could drop or override a
        // required prop and the parity test would never see it.
        var props = System.Text.Json.JsonSerializer.Serialize(
            RequestObservabilityProps.Build(
                ctx,
                eventType,
                status,
                ms,
                hasRejectedWork ? rejectedWorkItems : null,
                hasRejectedWork
                    ? ctx.Items[RequestObservabilityKeys.RejectedWorkReason] as string
                    : null,
                farmId,
                traceId,
                // Type name only. The MESSAGE is deliberately not captured: a
                // Postgres, serializer or validation message can carry the
                // request payload — a farmer's own words — and
                // analytics.events is append-only (DO INSTEAD NOTHING on
                // UPDATE/DELETE), so anything written there could never be
                // scrubbed.
                unhandled?.GetType().Name));

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
