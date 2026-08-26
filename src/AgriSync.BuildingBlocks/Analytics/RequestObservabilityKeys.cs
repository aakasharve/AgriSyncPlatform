namespace AgriSync.BuildingBlocks.Analytics;

/// <summary>
/// <c>HttpContext.Items</c> keys that let an endpoint tell
/// <c>RequestObservabilityMiddleware</c> something the status code cannot say.
///
/// <para>
/// RG5 (Rulebook §4.1 — Observability). The middleware decides what to emit from
/// the response status code alone, which makes one whole class of failure
/// structurally invisible: a batch endpoint that answers <c>200</c> while
/// refusing some of the work inside it. <c>POST /sync/push</c> is exactly that
/// shape, and its 200-with-rejections contract is frozen for old-client
/// compatibility (<c>P11</c>), so the status code cannot be changed to expose
/// it. An endpoint stamps the count here instead.
/// </para>
///
/// <para>
/// Constants rather than inline literals on both sides on purpose: a typo in
/// either the producer or the consumer would silently restore the exact
/// blindness this fixes, and nothing would fail.
/// </para>
///
/// <para>
/// Key naming follows the existing <c>HttpContext.Items</c> convention in this
/// assembly (<c>audit.device_id</c>, <c>audit.ip_hash</c> in
/// <c>AuditContextMiddleware</c>).
/// </para>
/// </summary>
public static class RequestObservabilityKeys
{
    /// <summary>
    /// <c>int</c> — how many units of work inside an otherwise-successful
    /// response were refused. Set only when greater than zero. Read by
    /// <c>RequestObservabilityMiddleware</c>, which emits an
    /// <c>AnalyticsEventType.ApiError</c> row for the request.
    /// </summary>
    public const string RejectedWorkItemCount = "observability.rejected_work_items";

    /// <summary>
    /// <c>string</c> — short, low-cardinality reason token identifying which
    /// endpoint semantics produced the rejection (for example
    /// <c>sync.mutation_rejected</c>). Codes only; never farmer content.
    /// </summary>
    public const string RejectedWorkReason = "observability.rejected_work_reason";
}
