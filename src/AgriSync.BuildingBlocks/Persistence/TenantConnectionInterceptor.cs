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
    // DATA_PRINCIPLE_SPINE 03.6 — third GUC `agrisync.user_id` lands
    // alongside farm_id + owner_account_id so UserDbContext commands
    // can RLS-key on the per-request user identity (e.g. public.memberships
    // policy `user_id = current_setting('agrisync.user_id', true)::uuid`).
    // Always emitted (even when the request is anonymous) — the bound
    // value falls back to the empty string when TenantContext.UserId is
    // null, and the Postgres cast `''::uuid` would throw, so the
    // policy expression uses the `true` (missing_ok) flag pair with a
    // NULL-tolerant CAST in the policy body. See migration
    // 20260516150000_EnableUserDbRowLevelSecurity for the policy SQL.
    private const string SetConfigSql =
        "SELECT set_config('agrisync.farm_id', @__tenant_farm_id, true); " +
        "SELECT set_config('agrisync.owner_account_id', @__tenant_owner_account_id, true); " +
        "SELECT set_config('agrisync.user_id', @__tenant_user_id, true); ";

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
        if (tenantContext.FarmId is null || tenantContext.OwnerAccountId is null)
            throw new InvalidOperationException(
                "TenantConnectionInterceptor: no tenant claim set and not in admin scope.");

        var farmParam = command.CreateParameter();
        farmParam.ParameterName = "@__tenant_farm_id";
        farmParam.Value = tenantContext.FarmId.Value.ToString();
        command.Parameters.Add(farmParam);

        var ownerParam = command.CreateParameter();
        ownerParam.ParameterName = "@__tenant_owner_account_id";
        ownerParam.Value = tenantContext.OwnerAccountId.Value.ToString();
        command.Parameters.Add(ownerParam);

        // DATA_PRINCIPLE_SPINE 03.6 — bind agrisync.user_id even when
        // the request did not capture a UserId (workers, hosted tasks).
        // Empty string is the conventional "no claim" sentinel — the
        // UserDb policy uses `current_setting('agrisync.user_id', true)::uuid`
        // which would throw on an empty string, but Postgres' cast of
        // an empty text to uuid is intercepted by the `, true`
        // (missing_ok) flag combined with the policy body wrapping the
        // cast in NULLIF(...). Documented in migration
        // 20260516150000_EnableUserDbRowLevelSecurity.
        var userParam = command.CreateParameter();
        userParam.ParameterName = "@__tenant_user_id";
        userParam.Value = tenantContext.UserId is { } uid
            ? uid.ToString()
            : string.Empty;
        command.Parameters.Add(userParam);

        command.CommandText = SetConfigSql + command.CommandText;
    }
}
