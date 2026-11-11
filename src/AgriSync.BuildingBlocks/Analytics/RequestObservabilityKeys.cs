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

    /// <summary>
    /// <c>string</c> — the <c>Error.Code</c> of the catalogued failure that
    /// produced this response, e.g. <c>ShramSafal.CropCycleOverlap</c>. Stamped
    /// by <see cref="AgriSync.BuildingBlocks.Results.ErrorCapture"/> when the
    /// result executes; read by <c>RequestObservabilityMiddleware</c>. Its
    /// absence on a 4xx/5xx means the response was not produced from a
    /// catalogued Error, which is recorded honestly as "Uncatalogued" rather
    /// than guessed at.
    /// </summary>
    public const string ErrorCode = "observability.error_code";

    /// <summary>
    /// <c>string</c> — the runtime type NAME of an exception that escaped the
    /// endpoint, e.g. <c>NullReferenceException</c>.
    ///
    /// <para>
    /// <b>Nothing writes this key today, and that is deliberate — read this
    /// before "fixing" it.</b> When it was added (2026-08-30) the intent was
    /// that <c>RequestObservabilityMiddleware</c> would stamp it on
    /// <c>HttpContext.Items</c>. The middleware ends up both producing AND
    /// consuming the value inside a single call — it catches the exception and
    /// hands the type name straight to
    /// <c>RequestObservabilityProps.Build(..., unhandledExceptionType)</c> as a
    /// parameter — so routing it through <c>Items</c> would be a round trip
    /// through mutable shared state for no reader. The name is kept because it
    /// documents the vocabulary the props bag speaks; it is NOT a seam anyone
    /// is currently filling. If a future endpoint wants to report an exception
    /// it handled itself, this is the key to use, and the middleware would then
    /// need to read it.
    /// </para>
    ///
    /// A type name is a code, so it passes the props privacy rule. The
    /// exception MESSAGE is deliberately NOT captured and must never be added
    /// here: a Postgres error text, a serializer message or a validation
    /// message can carry the request payload, and analytics.events is
    /// append-only (DO INSTEAD NOTHING on UPDATE/DELETE), so a farmer's words
    /// written there could never be scrubbed.
    /// </summary>
    public const string UnhandledExceptionType = "observability.unhandled_exception_type";
}
