// spec: data-principle-spine-2026-05-05/03.2
// spec: data-principle-spine-2026-05-05/03.6 — middleware now opens a
// transaction on EVERY writing DbContext registered in
// ITenantScopedDbContextRegistry so the third GUC `agrisync.user_id`
// (added to TenantConnectionInterceptor in 03.6) propagates across
// UserDbContext commands too. Single-context behaviour (just
// ShramSafalDbContext) silently failed-closed under UserDb RLS because
// auto-commit transactions expire the `set_config(..., true)` GUC
// before the policy sees it.
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phases 03.2 + 03.6 — wraps every
/// business request in explicit DbContext transactions (one per
/// writing context registered) so the
/// <see cref="TenantConnectionInterceptor"/>'s
/// <c>set_config(..., true)</c> GUC writes propagate across every
/// command in the request. Postgres scopes <c>SET LOCAL</c>-style GUCs
/// to the current transaction; without an explicit transaction each
/// EF Core command would run on its own auto-commit transaction and
/// the GUC would expire before the next statement.
///
/// <para>
/// <b>03.6 critical change.</b> The original 03.2 middleware took a
/// single <see cref="DbContext"/> dependency that resolved (via DI
/// alias) to <c>ShramSafalDbContext</c>. When UserDbContext gained the
/// interceptor in 03.6, its commands continued to run on auto-commit
/// transactions; <c>set_config(..., true)</c> no-opped and the User
/// RLS policy saw NULL → returned 0 rows silently. The fix: resolve a
/// registry of every tenant-scoped DbContext type and open a tx on
/// each before the pipeline runs. Commit all on success, rollback all
/// on failure.
/// </para>
///
/// <para>
/// <b>Layering.</b> The middleware lives in
/// <c>AgriSync.BuildingBlocks</c>, which "may use SharedKernel only"
/// (root <c>CLAUDE.md</c>). It therefore CANNOT name
/// <c>ShramSafalDbContext</c> or <c>UserDbContext</c> directly. The
/// app composition root (<c>AddShramSafalInfrastructure</c>,
/// <c>AddUserInfrastructure</c>) registers each tenant-scoped context
/// into <see cref="ITenantScopedDbContextRegistry"/>; the middleware
/// asks the registry for the per-scope instances and opens a tx on
/// each.
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
        "/health", "/version", "/metrics", "/swagger", "/telemetry/client-error", "/test",
        // Anonymous auth surface — login/register/refresh/OTP hit UserDb
        // without a tenant claim by definition (the user has not yet
        // authenticated). Without admin elevation the interceptor's
        // fail-closed throw blocks the login query and breaks e2e.
        "/user/auth", "/auth",
        // E2E test harness endpoints are dev-only and bypass tenancy.
        "/__e2e",
    };

    private readonly RequestDelegate _next;
    public TenantTransactionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context,
        ITenantScopedDbContextRegistry registry,
        TenantContext tenantContext)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        foreach (var prefix in SkipPathPrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                // Skip-listed paths don't have a tenant claim by design
                // (health checks, /metrics scrape, anonymous auth, e2e
                // test harness). Elevate to admin so the interceptor's
                // fail-closed guard on any DbCommand in this scope
                // doesn't 500 the request. ElevateToAdminCrossTenant is
                // idempotent when FarmId is unset; handlers that already
                // elevate explicitly (e.g. /health/ready, /__e2e/seed)
                // remain correct because the second call is a no-op.
                tenantContext.ElevateToAdminCrossTenant();
                await _next(context);
                return;
            }
        }

        // Open one transaction PER writing context so each commands
        // chain sees its own `set_config(..., true)` GUC. Postgres
        // scopes those GUCs to the connection's current transaction.
        //
        // EnableRetryOnFailure was removed from the ShramSafalDbContext
        // registration (DependencyInjection.cs spec 03.2/03.6) because
        // user-initiated transactions are incompatible with EF Core's
        // retry strategy — and an arbitrary HTTP pipeline cannot be
        // safely retried anyway. With retry disabled, raw
        // BeginTransactionAsync is the correct call here.
        var contexts = registry.GetWritingContexts(context.RequestServices);
        var transactions = new List<IDbContextTransaction>(contexts.Count);
        try
        {
            foreach (var db in contexts)
            {
                var tx = await db.Database.BeginTransactionAsync(context.RequestAborted);
                transactions.Add(tx);
            }

            await _next(context);

            foreach (var tx in transactions)
            {
                await tx.CommitAsync(context.RequestAborted);
            }
        }
        catch
        {
            // Rollback every opened tx in reverse order; swallow per-tx
            // failures so the original exception surfaces unchanged.
            for (var i = transactions.Count - 1; i >= 0; i--)
            {
                try
                {
                    await transactions[i].RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // Suppress secondary failures — the original
                    // exception is what callers need to see.
                }
            }
            throw;
        }
        finally
        {
            foreach (var tx in transactions)
            {
                await tx.DisposeAsync();
            }
        }
    }
}
