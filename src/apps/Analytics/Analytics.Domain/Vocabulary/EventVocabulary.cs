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

            // api.error fires on pre-auth pipeline failures too, where the
            // farmId is not yet known; no required props per the ADR.
            ["api.error"] = new(
                RequiredProps: [],
                Optional: ["endpoint", "status", "farmId"]),

            ["client.error"] = new(
                RequiredProps: ["message"],
                Optional: ["farmId", "stack"]),

            ["worker.named"] = new(
                RequiredProps: ["farmId", "logId", "workerName", "confidence"],
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
