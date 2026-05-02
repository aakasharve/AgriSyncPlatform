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
///
/// What is NOT emitted (to avoid noise):
///   2xx/3xx success responses
///   4xx on read/reference-data endpoints
///   GET requests slower than 2s (expected for large pulls)
///
/// The emit itself is fire-and-forget wrapped in try/catch — observability
/// must NEVER break a request that would otherwise succeed.
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

        if (!isError && !isCritical4xx && !isSlow) return;

        var eventType = (isError || isCritical4xx)
            ? AnalyticsEventType.ApiError
            : AnalyticsEventType.ApiSlow;

        var farmId = TryExtractFarmId(ctx.User);
        var traceId = Activity.Current?.TraceId.ToString()
                   ?? ctx.TraceIdentifier;

        var props = System.Text.Json.JsonSerializer.Serialize(new
        {
            endpoint = $"{method} {path}",
            statusCode = status,
            latencyMs = ms,
            traceId
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
                // Swallow — observability must never crash the app
                logger.LogDebug(ex, "RequestObservabilityMiddleware swallowed emit failure.");
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
}
