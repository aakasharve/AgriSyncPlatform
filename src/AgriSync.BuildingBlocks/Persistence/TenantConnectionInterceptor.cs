// spec: data-principle-spine-2026-05-05/03.2
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
    private const string SetConfigSql =
        "SELECT set_config('agrisync.farm_id', @__tenant_farm_id, true); " +
        "SELECT set_config('agrisync.owner_account_id', @__tenant_owner_account_id, true); ";

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

        command.CommandText = SetConfigSql + command.CommandText;
    }
}
