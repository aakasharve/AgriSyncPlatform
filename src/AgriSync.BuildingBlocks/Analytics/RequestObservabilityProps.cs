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
        string? unhandledExceptionType,
        Guid? personId,
        Guid? routeFarmId,
        string? routePattern,
        string? serverBuild,
        IReadOnlyList<string>? rejectedWorkCodes)
    {
        ArgumentNullException.ThrowIfNull(ctx);

        var props = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["endpoint"] = $"{ctx.Request.Method} {ctx.Request.Path}",

            // NOT "status". Three live SQL readers depend on this exact name —
            // AdminOpsRepository.GetRecentErrorsAsync, its GetErrorsPagedAsync,
            // and AdminFarmerHealthRepository — and Postgres answers an
            // absent key with NULL rather than an error, so a rename would
            // degrade the admin console silently. The vocabulary's Optional
            // list said "status" for months while the emitter said
            // "statusCode"; the SQL follows the emitter. Doc fixed in Task 6.
            ["statusCode"] = status,

            ["latencyMs"] = latencyMs,
            ["traceId"] = traceId,

            // Null on every pre-existing emit path, so existing consumers of
            // analytics.events are unaffected. Non-null means: the response
            // carried this many refused work items despite its status code.
            // Codes and counts only — never farmer content.
            ["rejectedWorkItems"] = rejectedWorkItems,
            ["rejectedWorkReason"] = rejectedWorkReason,
        };

        // ADR 0027 D3 — written ABOVE the early return, so every row type the
        // middleware emits carries them (api.error, api.slow,
        // sync.mutation_rejected, api.refused). A value that was not captured
        // is an ABSENT key, never a placeholder such as "unknown" (P4).
        // personId and routeFarmId live here and not in the actor_user_id and
        // farm_id columns, which stay exactly as they were (D4). routeFarmId is
        // the farm the request ADDRESSED, not proof the person belongs to it.
        if (personId is { } person) props["personId"] = person.ToString("D");
        if (routeFarmId is { } addressedFarm) props["routeFarmId"] = addressedFarm.ToString("D");
        if (!string.IsNullOrEmpty(routePattern)) props["route"] = $"{ctx.Request.Method} {routePattern}";
        if (!string.IsNullOrEmpty(serverBuild)) props["serverBuild"] = serverBuild;

        // On every row type since ADR 0027 D3 (it was api.error only). This
        // key is older than the ADR and keeps its own rule: present, with null
        // when the header is missing.
        props["appVersion"] = SanitiseAppVersion(ctx.Request.Headers["X-App-Version"].FirstOrDefault());

        // Names WHAT was refused inside a 2xx; rejectedWorkItems above says
        // only how many. Codes from the error catalogue only, never a
        // mutation's ErrorMessage (D7).
        if (string.Equals(eventType, AnalyticsEventType.SyncMutationRejected, StringComparison.Ordinal)
            && rejectedWorkCodes is { Count: > 0 })
        {
            props["rejectedWorkCodes"] = rejectedWorkCodes.ToArray();
        }

        // api.refused (ADR 0027 D1) names the refusal only when a mapper
        // stamped its code. With no stamp the key is absent: "Uncatalogued"
        // belongs to api.error, where errorCode is a required prop.
        if (string.Equals(eventType, AnalyticsEventType.ApiRefused, StringComparison.Ordinal)
            && ctx.Items.TryGetValue(RequestObservabilityKeys.ErrorCode, out var stamped)
            && stamped is string refusedCode
            && refusedCode.Length > 0)
        {
            props["errorCode"] = refusedCode;
        }

        // api.slow is a request that SUCCEEDED and was merely slow;
        // sync.mutation_rejected is a product failure deliberately kept
        // distinct from an API failure (AnalyticsEventType.cs:58-71);
        // api.refused is a refusal an endpoint answered outside the critical
        // paths. None of them has a work outcome anyone observed, and the
        // first two have no error identity either. Giving them one would be
        // noise on a slow row and a fabricated claim on all three.
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

        // BELOW the early return on purpose. It duplicates the
        // analytics.events.farm_id COLUMN (the CLAIM farm) deliberately,
        // because the vocabulary lists farmId as an api.error prop and a row
        // read out of props alone should be self-describing — but ONLY on
        // api.error. The 2026-08-31 ruling that api.slow and
        // sync.mutation_rejected keep exactly their earlier props shape was
        // reversed by ADR 0027 D5: those rows now gain the D3 keys written
        // above the early return. ADR 0027 did not move this key: the farm a
        // request ADDRESSED is the separate key routeFarmId. The COLUMN stays
        // authoritative for every event type — AdminFarmerHealthRepository
        // filters on farm_id, not on this key.
        props["farmId"] = farmId;

        return props;
    }

    /// <summary>What <see cref="SanitiseAppVersion"/> returns in place of a value that is not version-shaped.</summary>
    public const string MalformedAppVersion = "malformed";

    // A client can send anything in this header, and analytics.events is
    // append-only — whatever lands there cannot be edited out later. Cap the
    // length and allow only version-shaped characters. Anything else is
    // recorded as "malformed" rather than dropped, so a client sending junk
    // stays visible instead of silently becoming null.
    //
    // Public since ADR 0028: AppSeenMiddleware reads the same header through
    // this one sanitiser, so the two middlewares cannot disagree about what a
    // version is.
    public static string? SanitiseAppVersion(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (raw.Length > 32) return MalformedAppVersion;
        foreach (var c in raw)
        {
            if (!char.IsAsciiLetterOrDigit(c) && c != '.' && c != '-' && c != '+') return MalformedAppVersion;
        }
        return raw;
    }
}
