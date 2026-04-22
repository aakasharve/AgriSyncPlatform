using ShramSafal.Application.Admin.Ports;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// STUB — real implementation lands in W0-A Task 5.3 (raw-SQL writes against
/// mis.effective_org_farm_scope). All methods throw until then, so any caller
/// that tries to exercise scope projection ahead of 5.3 fails loudly rather
/// than silently no-opping.
/// </summary>
internal sealed class OrgFarmScopeProjector : IOrgFarmScopeProjector
{
    public Task UpsertExplicitAsync(Guid orgId, Guid farmId, string source, CancellationToken ct)
        => throw new NotImplementedException("OrgFarmScopeProjector is stubbed; real impl in W0-A Task 5.3.");

    public Task RemoveAsync(Guid orgId, Guid farmId, CancellationToken ct)
        => throw new NotImplementedException("OrgFarmScopeProjector is stubbed; real impl in W0-A Task 5.3.");

    public Task RefreshLineageAsync(Guid orgId, CancellationToken ct)
        => Task.CompletedTask;

    public Task<int> ReconcileAllAsync(CancellationToken ct)
        => throw new NotImplementedException("OrgFarmScopeProjector is stubbed; real impl in W0-A Task 5.3.");
}
