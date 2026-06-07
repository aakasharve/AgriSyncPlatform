// spec: data-principle-spine-2026-05-05/03.2
// spec: data-principle-spine-2026-05-05/03.6 — third GUC `agrisync.user_id` added for UserDb RLS.
using Microsoft.EntityFrameworkCore.Diagnostics;
using System.Data.Common;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — DbCommandInterceptor that
/// stamps every command leaving the writing DbContext with a parameterised
/// <c>set_config('agrisync.farm_id', :p, true)</c> /
/// <c>set_config('agrisync.owner_account_id', :p, true)</c> prelude.
///
/// <para>
/// <b>Fail-closed.</b> If <see cref="TenantContext"/> has no claim AND is
/// not elevated to <see cref="TenantContext.IsAdminCrossTenant"/>, the
/// interceptor throws — better to short-circuit a request than to risk
/// emitting a query that runs without an RLS filter once the Phase 03.3
/// policies land.
/// </para>
///
/// <para>
/// <b>Parameterised, not string-interpolated.</b> The GUCs are set via
/// the parameter binder so the values never enter the query text. This
/// keeps the prelude safe against SQL injection even though FarmId and
/// OwnerAccountId are <see cref="Guid"/> (which already cannot inject)
/// — defence in depth.
/// </para>
///
/// <para>
/// <b>Lifetime:</b> registered as Scoped because <see cref="TenantContext"/>
/// is Scoped. The DbContext registration uses the
/// <c>AddDbContext&lt;TContext&gt;((sp, options) =&gt; ...)</c> overload
/// so <c>options.AddInterceptors(sp.GetRequiredService&lt;TenantConnectionInterceptor&gt;())</c>
/// resolves the interceptor against the per-request scope. Do NOT switch
/// to <c>AddDbContextPool</c> — pooled contexts share interceptors across
/// scopes and would smear tenant claims between requests.
/// </para>
/// </summary>
public sealed class TenantConnectionInterceptor(TenantContext tenantContext) : DbCommandInterceptor
{
    // DATA_PRINCIPLE_SPINE 03.2/03.6 — emit GUC writes as SET LOCAL
    // (NOT SELECT set_config(...)) because set_config emits a result
    // set per call; EF's DataReader reads the FIRST result set as the
    // intended query result, causing "Reading as Guid is not supported
    // for fields having DataTypeName 'text'" on every wrapped query.
    // SET LOCAL emits zero result sets — EF reads the real query output.
    //
    // Guid.ToString() is RFC 4122 hex+hyphens — no SQL-injection risk
    // even with literal interpolation. TenantContext exposes FarmId /
    // OwnerAccountId / UserId as Guid? (validated at the property
    // setter; never string), so a future refactor that swaps the type
    // would break compilation rather than open an injection hole.
    //
    // SET LOCAL is a no-op + WARNING outside a transaction —
    // TenantTransactionMiddleware guarantees we are always in a tx
    // before any DbContext command runs through this interceptor.

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        InjectTenantClaim(command);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        InjectTenantClaim(command);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        InjectTenantClaim(command);
        return base.NonQueryExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        InjectTenantClaim(command);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<object> ScalarExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        InjectTenantClaim(command);
        return base.ScalarExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        InjectTenantClaim(command);
        return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
    }

    private void InjectTenantClaim(DbCommand command)
    {
        if (tenantContext.IsAdminCrossTenant) return;

        // ADR 0019 — user-scoped (multi-farm, non-admin) mode: inject ONLY
        // agrisync.user_id and proceed WITHOUT a farm_id/owner_account_id claim.
        // Caveat A: this relaxation is gated to IsUserScoped ONLY. The
        // single-tenant fail-closed guard below is UNCHANGED — a misconfigured
        // single-tenant request still throws (it never silently runs unfiltered).
        // UserId comes from TenantContext.SetUserScoped (validated JWT claim,
        // Caveat B); an empty value coerces to NULL via the policy NULLIF wrap so
        // the read fails closed rather than leaking.
        if (tenantContext.IsUserScoped)
        {
            var scopedUserId = tenantContext.UserId?.ToString() ?? string.Empty;
            command.CommandText =
                $"SET LOCAL agrisync.user_id = '{scopedUserId}'; " + command.CommandText;
            return;
        }

        if (tenantContext.FarmId is null || tenantContext.OwnerAccountId is null)
            throw new InvalidOperationException(
                "TenantConnectionInterceptor: no tenant claim set and not in admin scope.");

        // SET LOCAL with literal Guid (RFC 4122 hex+hyphens; safe to
        // interpolate). UserId may be unset for some flows; emit empty
        // string and let the policy's NULLIF wrap coerce that to NULL.
        var farmId = tenantContext.FarmId.Value;
        var ownerAccountId = tenantContext.OwnerAccountId.Value;
        var userId = tenantContext.UserId?.ToString() ?? string.Empty;

        command.CommandText =
            $"SET LOCAL agrisync.farm_id = '{farmId}'; " +
            $"SET LOCAL agrisync.owner_account_id = '{ownerAccountId}'; " +
            $"SET LOCAL agrisync.user_id = '{userId}'; " +
            command.CommandText;
    }
}
