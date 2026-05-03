using Analytics.Domain.Vocabulary;

namespace Analytics.Application.UseCases.IngestEvents;

/// <summary>
/// Validates an inbound <see cref="IngestEventsCommand"/> against the frozen
/// <see cref="EventVocabulary"/>. Two failure classes:
/// </summary>
/// <list type="number">
/// <item><b>Unknown event type</b> — <c>EventType</c> is not one of the 13 names.</item>
/// <item><b>Missing required prop</b> — a known type is missing one or more
///   keys declared in its <see cref="EventDefinition.RequiredProps"/>.</item>
/// </list>
/// <remarks>
/// <para>
/// The validator is producer-agnostic — it only cares that the wire shape
/// matches the contract. It does NOT type-check individual prop values; that
/// would require a per-type schema (deferred — Zod handles it client-side and
/// the vocabulary parity gate keeps the two registries aligned). A null prop
/// value counts as missing, because <c>props->>'farmId'</c> would return SQL
/// NULL downstream and matviews would treat it as absent anyway.
/// </para>
/// <para>
/// Performance: the validator allocates one error list per call and is
/// otherwise pure (no I/O, no DI other than the static registry lookup), so
/// it is safe to register as a singleton.
/// </para>
/// </remarks>
public sealed class IngestEventsValidator
{
    /// <summary>
    /// Validate a batch. Returns <see cref="ValidationOutcome.Valid"/> with
    /// an empty error list when every event is acceptable; otherwise the
    /// outcome carries one or more <see cref="ValidationError"/> entries
    /// (one per offending event, possibly with multiple property names
    /// rolled up).
    /// </summary>
    public ValidationOutcome Validate(IngestEventsCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(command.Events);

        var errors = new List<ValidationError>();

        for (var i = 0; i < command.Events.Count; i++)
        {
            var ev = command.Events[i];
            if (ev is null)
            {
                errors.Add(new ValidationError(i, EventType: null, "analytics.event_null", "event entry is null"));
                continue;
            }

            if (string.IsNullOrWhiteSpace(ev.EventType))
            {
                errors.Add(new ValidationError(i, EventType: null, "analytics.event_type_missing", "event_type is required"));
                continue;
            }

            if (!EventVocabulary.Registry.TryGetValue(ev.EventType, out var def))
            {
                errors.Add(new ValidationError(
                    i,
                    EventType: ev.EventType,
                    "analytics.unknown_event_type",
                    $"event_type '{ev.EventType}' is not in the frozen vocabulary"));
                continue;
            }

            if (def.RequiredProps.Length == 0)
            {
                continue;
            }

            // Defensive: a producer MAY send a payload without `props` if every
            // prop is optional, but we still need a non-null bag to probe.
            var props = ev.Props;
            var missing = new List<string>(def.RequiredProps.Length);
            for (var p = 0; p < def.RequiredProps.Length; p++)
            {
                var key = def.RequiredProps[p];
                if (props is null || !props.TryGetValue(key, out var value) || value is null)
                {
                    missing.Add(key);
                }
            }

            if (missing.Count > 0)
            {
                errors.Add(new ValidationError(
                    i,
                    EventType: ev.EventType,
                    "analytics.missing_required_prop",
                    $"event '{ev.EventType}' is missing required prop(s): {string.Join(", ", missing)}",
                    MissingProps: missing));
            }
        }

        return new ValidationOutcome(errors.Count == 0, errors);
    }
}

/// <summary>
/// Result of a single validator pass. <see cref="IsValid"/> is true if and
/// only if <see cref="Errors"/> is empty.
/// </summary>
public sealed record ValidationOutcome(bool IsValid, IReadOnlyList<ValidationError> Errors);

/// <summary>
/// One validation failure tied to a specific batch index. <see cref="EventType"/>
/// is null when the failure is "no event_type at all"; <see cref="MissingProps"/>
/// is empty unless the failure is missing-required-prop.
/// </summary>
public sealed record ValidationError(
    int Index,
    string? EventType,
    string Code,
    string Message,
    IReadOnlyList<string>? MissingProps = null);
