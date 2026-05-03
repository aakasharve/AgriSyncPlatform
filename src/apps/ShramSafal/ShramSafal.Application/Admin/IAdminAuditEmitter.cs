namespace ShramSafal.Application.Admin;

/// <summary>
/// Append-only audit emitter for admin-side reads/writes. Every Mode A
/// drilldown (<c>GET /admin/farmer-health/{farmId}</c>) and Mode B
/// cohort fetch emits one row to <c>analytics.events</c> with
/// <c>event_type = 'admin.farmer_lookup'</c> so we can review who
/// looked at which farmer.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 1 / §3.8 Step 2. The interface lives in the
/// Application layer so the handlers can depend on it; the
/// Infrastructure-side concrete implementation is wired in §3.8 (writes
/// the row through <c>IAnalyticsEventRepository</c>).
/// </para>
/// <para>
/// Implementations MUST NOT throw on emit failure — observability
/// outages must never break an admin response. Failures should be
/// logged at warning level and silently swallowed (matches the
/// behaviour of the existing <c>EntitlementResolver</c> emit path).
/// </para>
/// </remarks>
public interface IAdminAuditEmitter
{
    /// <summary>
    /// Emits an <c>admin.farmer_lookup</c> event recording that
    /// <paramref name="scope"/>'s actor viewed
    /// <paramref name="targetFarmId"/> via the given mode
    /// (<c>"ModeA_Drilldown"</c> or <c>"ModeB_Cohort"</c>).
    /// </summary>
    Task EmitFarmerLookupAsync(
        AdminScope scope,
        Guid targetFarmId,
        string modeName,
        CancellationToken ct = default);
}
