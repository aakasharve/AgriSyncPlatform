using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Analytics;

/// <summary>
/// Builds the COMPLETE props bag for a row emitted by
/// <c>RequestObservabilityMiddleware</c>. Extracted from the middleware so the
/// contract can be asserted directly: the middleware writes through
/// <c>IAnalyticsWriter</c>, which bypasses <c>IngestEventsValidator</c>, so a
/// test over this method is what actually holds the vocabulary's required props.
///
/// <para>
/// It returns the WHOLE bag and the middleware merges nothing afterwards — a
/// post-hoc merge could drop or override a required key and every test would
/// stay green.
/// </para>
///
/// <para>
/// Privacy: codes and counts only, never farmer content
/// (RequestObservabilityMiddleware.cs:106). analytics.events is append-only, so
/// a mistake here is permanent. The only free text recorded is
/// <see cref="ErrorExplanations"/>' authored meaning — never a raw
/// <c>Error.Description</c> (several are interpolated, e.g.
/// Msg91SmsSender.cs:74) and never an exception message.
/// </para>
/// </summary>
public static class RequestObservabilityProps
{
    /// <summary>The farmer's work survived. Never inferred — only a handler that stored something may assert it.</summary>
    public const string Kept = "kept";

    /// <summary>Work was refused. Recorded only when the endpoint counted refused items.</summary>
    public const string Lost = "lost";

    /// <summary>We do not know. The honest default.</summary>
    public const string Unknown = "unknown";

    /// <summary>Used when a failure was not produced from a catalogued Error.</summary>
    public const string UncataloguedCode = "Uncatalogued";

    /// <summary>Prefix for a failure that came from an escaped exception rather than a catalogued Error.</summary>
    public const string ExceptionCodePrefix = "Exception:";

    public static Dictionary<string, object?> Build(
        HttpContext ctx,
        string eventType,
        int status,
        long latencyMs,
        int? rejectedWorkItems,
        string? rejectedWorkReason,
        Guid? farmId,
        string? traceId,
        string? unhandledExceptionType)
    {
        ArgumentNullException.ThrowIfNull(ctx);

        var props = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["endpoint"] = $"{ctx.Request.Method} {ctx.Request.Path}",

            // NOT "status". Three live SQL readers depend on this exact name —
            // AdminOpsRepository.cs:99, AdminOpsRepository.cs:226 and
            // AdminFarmerHealthRepository.cs:367 — and Postgres answers an
            // absent key with NULL rather than an error, so a rename would
            // degrade the admin console silently. The vocabulary's Optional
            // list said "status" for months while the emitter said
            // "statusCode"; the SQL follows the emitter. Doc fixed in Task 6.
            ["statusCode"] = status,

            ["latencyMs"] = latencyMs,
            ["traceId"] = traceId,

            // Duplicates the analytics.events.farm_id COLUMN deliberately: the
            // vocabulary lists farmId as an api.error prop, and a row read out
            // of props alone should be self-describing. The column stays
            // authoritative — AdminFarmerHealthRepository filters on farm_id.
            ["farmId"] = farmId,

            // Null on every pre-existing emit path, so existing consumers of
            // analytics.events are unaffected. Non-null means: the response
            // carried this many refused work items despite its status code.
            // Codes and counts only — never farmer content.
            ["rejectedWorkItems"] = rejectedWorkItems,
            ["rejectedWorkReason"] = rejectedWorkReason,
        };

        // api.slow is a request that SUCCEEDED and was merely slow;
        // sync.mutation_rejected is a product failure deliberately kept
        // distinct from an API failure (AnalyticsEventType.cs:58-71). Neither
        // has an error identity, and neither has a work outcome anyone
        // observed. Giving them one would be noise on the first and a
        // fabricated claim on both.
        if (!string.Equals(eventType, AnalyticsEventType.ApiError, StringComparison.Ordinal))
        {
            return props;
        }

        var errorCode =
            unhandledExceptionType is not null
                ? ExceptionCodePrefix + unhandledExceptionType
                : ctx.Items.TryGetValue(RequestObservabilityKeys.ErrorCode, out var raw)
                  && raw is string code
                  && code.Length > 0
                    ? code
                    : UncataloguedCode;

        props["errorCode"] = errorCode;

        // Stated, never guessed. "lost" requires that the endpoint counted
        // refused work; "kept" is never produced here at all. A 4xx or 5xx on a
        // write is NOT evidence of loss — ShramSafal.DuplicateLogRequest and
        // three sibling 409s fire precisely because the work was already
        // stored, and POST /sync/push answers 200 while refusing items inside
        // it. Claiming "lost" would be a fabricated fact (P4) that reads as a
        // farmer losing a day.
        props["workKept"] = rejectedWorkItems > 0 ? Lost : Unknown;

        // Authored text only. Null when the code is not catalogued, which is
        // the honest answer — AdminFarmerHealthRepository.cs:368 already reads
        // props->>'message' with a COALESCE to '', so a null simply leaves that
        // field as blank as it is today.
        props["message"] = ErrorExplanations.For(errorCode)?.Meaning;

        props["appVersion"] = SanitiseAppVersion(ctx.Request.Headers["X-App-Version"].FirstOrDefault());

        return props;
    }

    // A client can send anything in this header, and analytics.events is
    // append-only — whatever lands there cannot be edited out later. Cap the
    // length and allow only version-shaped characters. Anything else is
    // recorded as "malformed" rather than dropped, so a client sending junk
    // stays visible instead of silently becoming null.
    private static string? SanitiseAppVersion(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (raw.Length > 32) return "malformed";
        foreach (var c in raw)
        {
            if (!char.IsAsciiLetterOrDigit(c) && c != '.' && c != '-' && c != '+') return "malformed";
        }
        return raw;
    }
}
