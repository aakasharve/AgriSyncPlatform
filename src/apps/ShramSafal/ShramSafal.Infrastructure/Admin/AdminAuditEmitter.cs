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
/// Actor identity is sourced from <see cref="ICurrentUser"/>
/// (HttpContext-backed in production, fake in tests). The vocabulary
/// registry (<c>EventVocabulary["admin.farmer_lookup"]</c>) requires
/// <c>actorUserId</c> in the props bag; the value is also stamped on the
/// envelope's <see cref="AnalyticsEvent.ActorUserId"/> column so the
/// dedicated index <c>ix_analytics_events_actor_time</c> is hit when
/// auditors query "all lookups by user X".
/// </para>
/// </remarks>
public sealed class AdminAuditEmitter(
    IAnalyticsWriter writer,
    IClock clock,
    ICurrentUser currentUser) : IAdminAuditEmitter
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
        // Resolve the actor once. ICurrentUser.UserId is null on
        // anonymous / background paths; the vocabulary requires
        // actorUserId so we still serialize the key (with null) rather
        // than omit it — keeps the JSON shape stable and lets the
        // vocabulary validator surface the null at ingest time instead
        // of silently dropping the field.
        var actorRaw = currentUser.UserId;
        UserId? actorUserId = Guid.TryParse(actorRaw, out var actorGuid)
            ? new UserId(actorGuid)
            : null;

        var props = JsonSerializer.Serialize(new
        {
            actorUserId = actorRaw,
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
            ActorUserId: actorUserId,
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
