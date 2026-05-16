// spec: data-principle-spine-2026-05-05/03.2
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — wraps every business
/// request in an explicit DbContext transaction so the
/// <see cref="TenantConnectionInterceptor"/>'s
/// <c>set_config(..., true)</c> GUC writes propagate across every
/// command in the request. Postgres scopes <c>SET LOCAL</c>-style GUCs
/// to the current transaction; without an explicit transaction each
/// EF Core command would run on its own auto-commit transaction and
/// the GUC would expire before the next statement.
///
/// <para>
/// <b>DbContext injected as the base <see cref="DbContext"/> type</b>
/// rather than <c>ShramSafalDbContext</c> to keep
/// <c>AgriSync.BuildingBlocks</c> within its allowed layer (root
/// <c>CLAUDE.md</c>: "BuildingBlocks may use SharedKernel only"). The
/// ShramSafal Infrastructure DI registration includes
/// <c>services.AddScoped&lt;DbContext&gt;(sp =&gt; sp.GetRequiredService&lt;ShramSafalDbContext&gt;())</c>
/// so the per-scope <see cref="DbContext"/> resolves to the same
/// <c>ShramSafalDbContext</c> instance the spec named verbatim.
/// </para>
///
/// <para>
/// <b>Skip list</b> covers infrastructure routes that must never enter
/// a per-request transaction:
/// <list type="bullet">
/// <item><c>/health</c>, <c>/version</c>, <c>/metrics</c> — observability
/// (Prometheus scrapes /metrics on a tight cadence; wrapping it in a
/// DB transaction would create needless connection pressure).</item>
/// <item><c>/swagger</c> — static UI assets.</item>
/// <item><c>/telemetry/client-error</c> — anonymous browser error
/// ingest; no tenant claim available.</item>
/// <item><c>/test</c> — Development-only test endpoints (db init, seed,
/// db connectivity) that must run with no tenant claim.</item>
/// </list>
/// </para>
/// </summary>
public sealed class TenantTransactionMiddleware
{
    private static readonly string[] SkipPathPrefixes =
    {
        "/health", "/version", "/metrics", "/swagger", "/telemetry/client-error", "/test"
    };

    private readonly RequestDelegate _next;
    public TenantTransactionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, DbContext db)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        foreach (var prefix in SkipPathPrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }
        }

        await using var tx = await db.Database.BeginTransactionAsync(context.RequestAborted);
        try
        {
            await _next(context);
            await tx.CommitAsync(context.RequestAborted);
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            throw;
        }
    }
}
