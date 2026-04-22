namespace ShramSafal.Application.Admin.Ports;

/// <summary>
/// Maintains mis.effective_org_farm_scope — the materialized JOIN target that
/// every admin MIS query uses to filter rows by the caller's org scope.
///
/// Writing this projection is centralised here so callers (grant handler,
/// revoke handler, lineage projector, nightly job) cannot fall out of sync.
/// </summary>
public interface IOrgFarmScopeProjector
{
    /// <summary>
    /// Upserts one Explicit/Invited row (idempotent). Called inline from
    /// GrantFarmScopeHandler / AcceptFarmScopeInvitationHandler within the
    /// same transaction as the ssf.organization_farm_scopes write.
    /// </summary>
    Task UpsertExplicitAsync(Guid orgId, Guid farmId, string source, CancellationToken ct);

    /// <summary>
    /// Removes one row (grant revoked / member removed). Idempotent.
    /// </summary>
    Task RemoveAsync(Guid orgId, Guid farmId, CancellationToken ct);

    /// <summary>
    /// Rebuilds TemplateLineage-source rows for a single org. Called on
    /// ScheduleTemplatePublishedEvent (future W1+) and nightly by the hosted
    /// service. W0-A ships a stub; the real lineage computation lands
    /// alongside W1 CEI-01 admin surfaces.
    /// </summary>
    Task RefreshLineageAsync(Guid orgId, CancellationToken ct);

    /// <summary>
    /// Reconciliation sweep — compares mis.effective_org_farm_scope against
    /// ssf.organization_farm_scopes for active non-Platform orgs. Emits
    /// admin.scope.drift-detected when a mismatch is found. Returns mismatch
    /// count. Runs nightly.
    /// </summary>
    Task<int> ReconcileAllAsync(CancellationToken ct);
}
