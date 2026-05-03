using System.Security.Claims;
using Analytics.Application.UseCases.IngestEvents;
using AgriSync.BuildingBlocks.Results;

namespace AgriSync.Bootstrapper;

/// <summary>
/// DWC v2 §2.4 — analytics ingest endpoint. Receives a batch of
/// closure-loop telemetry events from the mobile-web
/// <c>AnalyticsEventBus</c> and persists them after vocabulary
/// validation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Auth:</b> requires an authenticated user (any role). The bus
/// only flushes when there's an active session, so anonymous traffic
/// here would either be a misconfigured client or a probe and is
/// rejected with 401. The actor's userId is read from the standard
/// <c>sub</c> / <c>NameIdentifier</c> claim and stamped on each row
/// so audit reviewers can tie events back to the user that emitted
/// them.
/// </para>
/// <para>
/// <b>Anti-forgery:</b> disabled. The mobile-web client posts JSON
/// with a Bearer token, not a browser form, so the anti-forgery
/// pipeline would just reject every request without adding security.
/// Same posture as the existing <c>/sync/push</c> and
/// <c>/telemetry/client-error</c> endpoints.
/// </para>
/// <para>
/// <b>Status codes:</b>
/// </para>
/// <list type="bullet">
/// <item><c>202 Accepted</c> — batch validated and handed to the writer.
///   The writer is failure-isolated, so a downstream persistence error
///   does NOT cascade to the caller (matches the ADR's "telemetry is
///   best-effort" stance).</item>
/// <item><c>400 BadRequest</c> — at least one event failed vocabulary
///   validation. Body includes the per-event error list so the bus can
///   log it before dropping the batch (its 400 rule is "vocab error,
///   no point retrying").</item>
/// <item><c>401 Unauthorized</c> — no authenticated user. The
///   <c>RequireAuthorization()</c> chain emits this before the
///   delegate runs.</item>
/// </list>
/// </remarks>
public static class AnalyticsIngestEndpoints
{
    public static IEndpointRouteBuilder MapAnalyticsIngest(this IEndpointRouteBuilder app)
    {
        app.MapPost("/analytics/ingest", async (
            IngestEventsCommand command,
            HttpContext http,
            IngestEventsHandler handler,
            CancellationToken ct) =>
        {
            // Belt-and-braces: the RequireAuthorization() metadata below
            // already short-circuits unauthenticated requests at the auth
            // middleware. This explicit guard makes the contract obvious
            // to readers and keeps the test suite from needing to assert
            // middleware behavior to verify the 401 path.
            var actorUserId = TryGetUserId(http.User);
            if (actorUserId is null)
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(command, actorUserId, ct);
            if (result.IsSuccess)
            {
                return Results.Accepted();
            }

            return result.Error.Kind == ErrorKind.Validation
                ? Results.BadRequest(new
                {
                    error = result.Error.Code,
                    message = result.Error.Description
                })
                : Results.Problem(
                    title: result.Error.Code,
                    detail: result.Error.Description,
                    statusCode: StatusCodes.Status500InternalServerError);
        })
        .WithName("PostAnalyticsIngest")
        .WithTags("analytics")
        .RequireAuthorization()
        .DisableAntiforgery();

        return app;
    }

    private static Guid? TryGetUserId(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        // Match the claim resolution used by every other authenticated
        // endpoint in the Bootstrapper (see ResolveAiRateLimitPartitionKey
        // in Program.cs and FirstFarmBootstrapEndpoints.TryGetUserId).
        var subject =
            user.FindFirst("sub")?.Value ??
            user.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return Guid.TryParse(subject, out var userId) ? userId : null;
    }
}
