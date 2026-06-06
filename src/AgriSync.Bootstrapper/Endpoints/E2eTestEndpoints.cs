using AgriSync.Bootstrapper.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using ShramSafal.Application.Abstractions.Sync;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// Sub-plan 05 Task 2 — backend control plane for the Playwright E2E harness.
/// All endpoints are gated on the <c>ALLOW_E2E_SEED</c> environment variable
/// being literally <c>"true"</c>. Production must never set this flag.
///
/// Endpoints:
///   POST /__e2e/reset        Delegates to <see cref="TestFixtureService.ResetFixtureAsync"/>
///                            and clears in-memory E2E harness toggles.
///   POST /__e2e/seed         Delegates to <see cref="TestFixtureService.SeedFixtureAsync"/>.
///                            Legacy fixture keys "ramu" and "admin_two_orgs" are mapped to
///                            their canonical service names ("ramu-demo", "admin-two-orgs").
///   POST /__e2e/fail-pushes  Toggles an in-memory flag observed by
///                            <see cref="E2eFailPushesToggle"/>. Wiring the
///                            sync push handler to consult the toggle is a
///                            deferred follow-up (see
///                            T-IGH-05-FAIL-PUSHES-WIRING in Pending_Tasks/).
///
/// PREP_READY status: scaffolding only. Specs that exercise these endpoints
/// land with Sub-plan 04 + Sub-plan 05 Tasks 3-7.
/// </summary>
public static class E2eTestEndpoints
{
    public const string EnvFlag = "ALLOW_E2E_SEED";

    public static bool IsEnabled() =>
        string.Equals(
            Environment.GetEnvironmentVariable(EnvFlag),
            "true",
            StringComparison.OrdinalIgnoreCase);

    public static IEndpointRouteBuilder MapE2eEndpoints(this IEndpointRouteBuilder app)
    {
        if (!IsEnabled())
        {
            return app;
        }

        var group = app.MapGroup("/__e2e")
            .WithTags("__e2e")
            .AllowAnonymous();

        group.MapPost("/reset", async (
            TestFixtureService fixtures,
            E2eFailPushesToggle failPushes,
            HttpContext ctx,
            CancellationToken ct) =>
        {
            failPushes.Reason = null;

            var fixture = (ctx.Request.Query["fixture"].ToString() is { Length: > 0 } f) ? f : "purvesh-demo";
            try
            {
                var result = await fixtures.ResetFixtureAsync(fixture, ct);
                return Results.Ok(new { reset = true, result });
            }
            catch (TestFixturesDisabledException ex)
            {
                return Results.Json(new { reset = false, error = "test_fixtures_disabled", message = ex.Message },
                    statusCode: StatusCodes.Status403Forbidden);
            }
        })
        .WithName("E2eReset");

        group.MapPost("/seed", async (
            TestFixtureService fixtures,
            HttpContext ctx,
            CancellationToken ct) =>
        {
            SeedRequest body;
            try
            {
                body = await ctx.Request.ReadFromJsonAsync<SeedRequest>(ct) ?? new SeedRequest("ramu");
            }
            catch
            {
                body = new SeedRequest("ramu");
            }

            // Map legacy harness fixture keys to canonical TestFixtureService names.
            var rawFixture = (body.Fixture ?? "ramu").Trim().ToLowerInvariant();
            var fixture = rawFixture switch
            {
                "ramu" => "ramu-demo",
                "admin_two_orgs" => "admin-two-orgs",
                _ => rawFixture,
            };

            try
            {
                var result = await fixtures.SeedFixtureAsync(fixture, ct);
                return Results.Ok(new { seeded = true, result });
            }
            catch (TestFixturesDisabledException ex)
            {
                return Results.Json(new { seeded = false, error = "test_fixtures_disabled", message = ex.Message },
                    statusCode: StatusCodes.Status403Forbidden);
            }
        })
        .WithName("E2eSeed");

        group.MapPost("/fail-pushes", async (
            HttpContext ctx,
            E2eFailPushesToggle toggle,
            CancellationToken ct) =>
        {
            FailPushesRequest body;
            try
            {
                body = await ctx.Request.ReadFromJsonAsync<FailPushesRequest>(ct) ?? new FailPushesRequest(null);
            }
            catch
            {
                body = new FailPushesRequest(null);
            }

            toggle.Reason = string.IsNullOrWhiteSpace(body.Reason) ? null : body.Reason.Trim();
            return Results.Ok(new { failingPushes = toggle.Reason is not null, reason = toggle.Reason });
        })
        .WithName("E2eFailPushes");

        group.MapGet("/status", (E2eFailPushesToggle toggle) =>
            Results.Ok(new
            {
                enabled = true,
                failPushesReason = toggle.Reason,
            }))
            .WithName("E2eStatus");

        return app;
    }

    private sealed record SeedRequest(string? Fixture);
    private sealed record FailPushesRequest(string? Reason);
}

/// <summary>
/// In-memory toggle observed by <c>PushSyncBatchHandler</c> when
/// <see cref="E2eTestEndpoints.IsEnabled"/> is true via
/// <see cref="E2eFailPushesProbeAdapter"/>. Registered as a singleton in
/// DI when the env flag is on.
/// </summary>
public sealed class E2eFailPushesToggle
{
    private string? _reason;
    public string? Reason
    {
        get => Volatile.Read(ref _reason);
        set => Volatile.Write(ref _reason, value);
    }
}

/// <summary>
/// Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING).
/// Thin adapter that bridges <see cref="E2eFailPushesToggle"/> (Bootstrapper)
/// to <see cref="IE2eFailPushesProbe"/> (Application layer).
/// Registered by <c>Program.cs</c> when <c>ALLOW_E2E_SEED=true</c>,
/// after the default <see cref="ShramSafal.Application.Abstractions.Sync.NoOpFailPushesProbe"/>
/// registration — the later registration wins in DI.
/// </summary>
internal sealed class E2eFailPushesProbeAdapter(E2eFailPushesToggle toggle) : IE2eFailPushesProbe
{
    public string? FailReason => toggle.Reason;
}
