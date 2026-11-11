namespace Analytics.Domain.Vocabulary;

/// <summary>
/// Frozen registry of the 13 closure-loop event names that may appear in
/// <c>analytics.events.event_type</c>. Mirrors the Zod registry on
/// <c>mobile-web/src/core/telemetry/eventSchema.ts</c>; both producers and
/// consumers MUST read the same name set, enforced at CI time by the
/// <c>event-vocabulary-parity</c> gate (DWC v2 §2.7).
/// </summary>
/// <remarks>
/// <para>
/// Source of truth: <c>ADR-2026-05-02_event-vocabulary.md</c>. Adding a
/// 14th event requires a new ADR — do not extend this dictionary
/// silently. The parity gate fails the build the moment the C# and
/// TypeScript registries drift.
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
    /// The 13 frozen event names mapped to their property contracts.
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
            ["api.error"] = new(
                RequiredProps: ["endpoint", "statusCode", "errorCode", "workKept"],
                Optional: ["farmId", "message", "appVersion",
                           "latencyMs", "traceId",
                           "rejectedWorkItems", "rejectedWorkReason"]),

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
}

/// <summary>
/// Property contract for a single vocabulary entry. <see cref="RequiredProps"/>
/// MUST appear in every inbound payload; <see cref="Optional"/> are
/// documented for clarity and may be absent without rejection.
/// </summary>
public sealed record EventDefinition(string[] RequiredProps, string[] Optional);
