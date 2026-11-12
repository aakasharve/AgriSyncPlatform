namespace Analytics.Domain.Vocabulary;

/// <summary>
/// Frozen registry of the event names (a unit test pins the count) that may appear in
/// <c>analytics.events.event_type</c>. Mirrors the Zod registry on
/// <c>mobile-web/src/core/telemetry/eventSchema.ts</c>; both producers and
/// consumers MUST read the same name set, enforced at CI time by the
/// <c>event-vocabulary-parity</c> gate (DWC v2 §2.7).
/// </summary>
/// <remarks>
/// <para>
/// Source of truth: <c>ADR-2026-05-02_event-vocabulary.md</c>, extended by
/// ADR 0027 (2026-11-11), which added <c>api.refused</c> and
/// <c>sync.push_outcome</c>, and by ADR 0028 (2026-11-12), which added
/// <c>app.seen</c>. Adding an event requires a new ADR — do not
/// extend this dictionary silently. The parity gate fails the build the
/// moment the C# and TypeScript registries drift.
/// </para>
/// <para>
/// Each entry declares its <see cref="EventDefinition.RequiredProps"/>
/// (must be present in the inbound <c>props</c> bag) and
/// <see cref="EventDefinition.Optional"/> (may be absent; documented for
/// readability — the validator does not check the optional list).
/// </para>
/// <para>
/// Layout intentionally matches the Markdown table in the ADR row-for-row
/// so a reviewer can diff the two without translating between formats.
/// </para>
/// </remarks>
public static class EventVocabulary
{
    /// <summary>
    /// The frozen event names mapped to their property contracts. The count
    /// is pinned in <c>EventVocabularyTests</c>, not here.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, EventDefinition> Registry =
        new Dictionary<string, EventDefinition>(StringComparer.Ordinal)
        {
            ["closure.started"] = new(
                RequiredProps: ["farmId", "method", "ts"],
                Optional: []),

            ["closure.submitted"] = new(
                RequiredProps: ["farmId", "logId", "method", "durationMs", "fields_used"],
                Optional: []),

            ["closure.abandoned"] = new(
                RequiredProps: ["farmId", "method", "durationMs", "lastStep"],
                Optional: []),

            ["proof.attached"] = new(
                RequiredProps: ["farmId", "logId", "type"],
                Optional: ["sizeBytes"]),

            ["closure_summary.viewed"] = new(
                RequiredProps: ["farmId", "dateKey", "logsCount", "source"],
                Optional: []),

            ["closure.verified"] = new(
                RequiredProps: ["farmId", "logId", "verifierId", "status"],
                Optional: []),

            ["next_action.created"] = new(
                RequiredProps: ["farmId", "taskId"],
                Optional: ["parentLogId"]),

            ["log.created"] = new(
                RequiredProps: ["farmId"],
                Optional: ["trigger", "complianceOutcome"]),

            ["ai.invocation"] = new(
                RequiredProps: ["farmId", "outcome"],
                Optional: ["cost_usd", "model"]),

            // 2026-08-30 (founder decision, spec error-capture-engine):
            // an api.error MUST name itself and MUST state whether the farmer's
            // work survived. Before this the row kept only endpoint/status/farmId
            // — so `ShramSafal.CropCycleOverlap` travelled correctly all the way
            // to the client and the record we kept said `500`.
            //
            // `workKept` is three-state: "kept" | "lost" | "unknown". Required
            // means it must be STATED, never that it must be known — claiming
            // "kept", or reading "lost" off a status code, violates P4.
            //
            // farmId stays OPTIONAL: the 2026-05-02 rationale holds for it
            // specifically, because pre-auth failures fire before the user is
            // known. It does not hold for the other four — a pre-auth failure
            // still knows its endpoint, its status and whether it refused work,
            // and names itself "Uncatalogued" when no catalogued Error produced it.
            //
            // The key is `statusCode`, NOT `status`. This entry listed `status`
            // from the day it was written and nothing ever emitted or read it;
            // the emitter has always written `statusCode`
            // (RequestObservabilityProps.Build) and three live queries read
            // props->>'statusCode' (AdminOpsRepository.GetRecentErrorsAsync,
            // its GetErrorsPagedAsync, and AdminFarmerHealthRepository).
            // The doc was wrong, not the code.
            // 2026-11-11 (ADR 0027): `personId`, `routeFarmId`, `route` and
            // `serverBuild` are optional keys on every row the request
            // middleware writes. The person and the addressed farm live in
            // props, NOT in the actor_user_id / farm_id columns: the
            // weekly-active and retention views count those columns, and a
            // person who only hit an error must not count as active.
            ["api.error"] = new(
                RequiredProps: ["endpoint", "statusCode", "errorCode", "workKept"],
                Optional: ["farmId", "message", "appVersion",
                           "latencyMs", "traceId",
                           "rejectedWorkItems", "rejectedWorkReason",
                           "personId", "routeFarmId", "route", "serverBuild"]),

            // 2026-11-11 (ADR 0027): a write that an endpoint itself refused
            // (4xx, never 401) on a route outside the critical list, from a
            // signed-in person. Server-only. Deliberately NOT `api.error`:
            // mis.alert_r9_api_error_spike counts `api.error` rows, and a
            // farmer retrying a form must not trip it. The key is
            // `statusCode`, as on `api.error`.
            ["api.refused"] = new(
                RequiredProps: ["endpoint", "statusCode"],
                Optional: ["errorCode", "route", "appVersion", "serverBuild",
                           "personId", "routeFarmId", "latencyMs", "traceId"]),

            // 2026-11-12 (ADR 0028): a signed-in person used the app on this
            // version. Server-only, written at most once per person, version
            // and UTC day. The person is in props and the actor_user_id and
            // farm_id columns stay empty, so merely opening the app never
            // moves the weekly-active or retention numbers. No device
            // identifier (ADR 0027 D7).
            ["app.seen"] = new(
                RequiredProps: ["appVersion", "personId"],
                Optional: ["platform"]),

            ["client.error"] = new(
                RequiredProps: ["message"],
                Optional: ["farmId", "stack"]),

            // 2026-07-19 correction (founder Decision 5, spec
            // 2026-07-13-labour-attendance-approval-design): this entry
            // documented "logId"/"workerName", which never matched what
            // WorkerNameProjector actually emits ("dailyLogId", no raw name
            // field). The name field was removed entirely — analytics.events
            // is append-only (DO INSTEAD NOTHING on UPDATE/DELETE), so a raw
            // worker name written there could never be scrubbed. Restated to
            // match WorkerNameProjector.cs's real PropsJson shape.
            ["worker.named"] = new(
                RequiredProps: ["farmId", "dailyLogId", "workerId", "confidence"],
                Optional: []),

            ["admin.farmer_lookup"] = new(
                RequiredProps: ["actorUserId", "targetFarmId", "modeName"],
                Optional: ["scope"]),
        };

    /// <summary>
    /// Convenience predicate for endpoints / handlers that need to short-circuit
    /// on unknown event types before paying the dictionary-lookup cost twice.
    /// </summary>
    public static bool IsKnown(string eventType) => Registry.ContainsKey(eventType);

    /// <summary>
    /// Event types that only the server itself may write. A client must never
    /// be able to place one of these rows: readers trust them (the control
    /// room's app-versions page trusts <c>app.seen</c>; an alert counts
    /// <c>api.error</c>). <c>POST /analytics/ingest</c> refuses them through
    /// <c>IngestEventsValidator.ValidateFromClient</c>.
    /// </summary>
    /// <remarks>
    /// Must stay equal to <c>SERVER_ONLY</c> in
    /// <c>.github/scripts/check-event-vocabulary-parity.mjs</c>; a unit test
    /// pins the seven names. Review round 2 of lane CR-1c (2026-11-12) found
    /// that "server-only" was a convention the server did not enforce.
    /// </remarks>
    public static readonly IReadOnlySet<string> ServerOnly = new HashSet<string>(StringComparer.Ordinal)
    {
        "log.created",
        "ai.invocation",
        "api.error",
        "api.refused",
        "app.seen",
        "worker.named",
        "admin.farmer_lookup",
    };

    /// <summary>True when only the server may write this event type.</summary>
    public static bool IsServerOnly(string eventType) => ServerOnly.Contains(eventType);
}

/// <summary>
/// Property contract for a single vocabulary entry. <see cref="RequiredProps"/>
/// MUST appear in every inbound payload; <see cref="Optional"/> are
/// documented for clarity and may be absent without rejection.
/// </summary>
public sealed record EventDefinition(string[] RequiredProps, string[] Optional);
