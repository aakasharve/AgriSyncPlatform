using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// Infrastructure-side implementation of <see cref="IAdminAuditEmitter"/>.
/// Persists one row to <c>analytics.events</c> per admin drilldown / cohort
/// fetch, tagged with <c>event_type = "admin.farmer_lookup"</c>, so audit
/// reviewers can answer "who looked at which farmer when?" via the same
/// pipeline that ingests product telemetry.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.8 Step 2. The plan sketch references
/// <c>IAnalyticsEventRepository</c>; that port is scheduled for Phase C.4
/// and does not exist yet, so this implementation routes through the
/// pre-existing <see cref="IAnalyticsWriter"/> (registered by
/// <c>AddAnalytics</c> in the Bootstrapper). Both write to the same
/// <c>analytics.events</c> table, so the swap to the dedicated repo in
/// C.4 is a one-line constructor change with no behavioural impact.
/// </para>
/// <para>
/// Per the <see cref="IAdminAuditEmitter"/> contract, this method MUST
/// NOT throw — observability outages must never break an admin response.
/// <see cref="AnalyticsWriter"/> already swallows + logs persistence
/// failures internally, so we don't need a second try/catch here; the
/// guarantee is delegated.
/// </para>
/// <para>
/// Actor (caller) identity is intentionally not embedded in
/// <c>actor_user_id</c> right now: the existing
/// <see cref="ICurrentUser"/> abstraction has no <c>HttpContextAccessor</c>
/// adapter wired, and threading the userId through every
/// <see cref="IAdminAuditEmitter.EmitFarmerLookupAsync"/> call would
/// change the port's signature (and break the W0-A
/// <c>admin-scope-guard</c> shape). The forensic signal that matters at
/// this layer is "<c>orgId X</c> queried <c>farmId Y</c>" — the actor
/// userId is recovered separately from the request log when needed.
/// Wiring an <see cref="ICurrentUser"/> adapter is tracked as a Phase C
/// follow-up.
/// </para>
/// </remarks>
public sealed class AdminAuditEmitter(
    IAnalyticsWriter writer,
    IClock clock) : IAdminAuditEmitter
{
    /// <summary>
    /// JSON event-type literal that lands in <c>analytics.events.event_type</c>.
    /// Exposed as a const so tests can assert the wire shape without taking a
    /// dependency on <see cref="AnalyticsEventType"/> directly.
    /// </summary>
    public const string EventTypeName = AnalyticsEventType.AdminFarmerLookup;

    public Task EmitFarmerLookupAsync(
        AdminScope scope,
        Guid targetFarmId,
        string modeName,
        CancellationToken ct = default)
    {
        var props = JsonSerializer.Serialize(new
        {
            scopeOrgId = scope.OrganizationId,
            scopeOrgType = scope.OrganizationType.ToString(),
            scopeOrgRole = scope.OrganizationRole.ToString(),
            targetFarmId,
            modeName
        });

        var ev = new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: EventTypeName,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: null,
            FarmId: targetFarmId == Guid.Empty ? null : new FarmId(targetFarmId),
            OwnerAccountId: null,
            ActorRole: "admin",
            Trigger: modeName,
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: props);

        return writer.EmitAsync(ev, ct);
    }
}
