using AgriSync.Bootstrapper.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Abstractions.Sync;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// Sub-plan 05 Task 2 — backend control plane for the Playwright E2E harness.
/// All endpoints are gated on the <c>ALLOW_E2E_SEED</c> environment variable
/// being literally <c>"true"</c>. Production must never set this flag.
///
/// Endpoints:
///   POST /__e2e/reset        TRUNCATEs the mutable ssf tables.
///   POST /__e2e/seed         Delegates to the existing DatabaseSeeder for the
///                            "ramu" fixture; returns 501 for fixtures that are
///                            not yet implemented.
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

    private static readonly string[] TruncateTables =
    [
        "ssf.daily_logs",
        "ssf.cost_entries",
        "ssf.attachments",
        "ssf.verification_events",
        "ssf.audit_events",
        "ssf.day_ledgers",
        "ssf.log_tasks",
        "ssf.sync_mutations",
        "ssf.compliance_signals",
    ];

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
            IServiceScopeFactory scopes,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var logger = loggerFactory.CreateLogger("AgriSync.Bootstrapper.E2eTestEndpoints");
            using var scope = scopes.CreateScope();
            var ssf = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            foreach (var table in TruncateTables)
            {
                var sql = $"TRUNCATE TABLE {table} CASCADE;";
                try
                {
                    await ssf.Database.ExecuteSqlRawAsync(sql, ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "E2E reset: truncate of {Table} failed (table may not exist yet)", table);
                }
            }

            return Results.Ok(new { reset = true, tables = TruncateTables });
        })
        .WithName("E2eReset");

        group.MapPost("/seed", async (
            HttpContext ctx,
            IServiceScopeFactory scopes,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var logger = loggerFactory.CreateLogger("AgriSync.Bootstrapper.E2eTestEndpoints");
            SeedRequest body;
            try
            {
                body = await ctx.Request.ReadFromJsonAsync<SeedRequest>(ct) ?? new SeedRequest("ramu");
            }
            catch
            {
                body = new SeedRequest("ramu");
            }

            var fixture = (body.Fixture ?? "ramu").Trim().ToLowerInvariant();

            using var scope = scopes.CreateScope();

            switch (fixture)
            {
                case "ramu":
                {
                    var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();
                    var summary = await seeder.SeedDemoDataAsync();
                    var result = new
                    {
                        userId = "00000000-0000-0000-0000-000000000001",
                        phone = "9999999999",
                        password = "ramu123",
                        farmId = "",
                        fixture,
                        summary,
                    };
                    return Results.Ok(result);
                }
                case "admin_two_orgs":
                {
                    var adminSeeder = scope.ServiceProvider.GetRequiredService<E2eFixtureSeeder>();
                    var result = await adminSeeder.SeedAdminTwoOrgsAsync(ct);
                    return Results.Ok(result);
                }
                default:
                {
                    return Results.BadRequest(new { error = "unknown_fixture", fixture });
                }
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
    public string? Reason { get; set; }
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
