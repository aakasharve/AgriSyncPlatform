namespace Analytics.Application.UseCases.IngestEvents;

/// <summary>
/// Inbound batch from <c>POST /analytics/ingest</c>. The endpoint binds the
/// JSON body straight to this record; the handler validates each event
/// against <see cref="Analytics.Domain.Vocabulary.EventVocabulary"/> and then
/// fans them out to the analytics writer in a single bulk insert.
/// </summary>
/// <param name="Events">
/// One batch of events. Empty batches are accepted by the validator (it has
/// nothing to reject) but the handler still emits zero rows — the choice is
/// the caller's; the bus rolls up to ~50/batch by default.
/// </param>
public sealed record IngestEventsCommand(IReadOnlyList<IngestedEvent> Events);

/// <summary>
/// Wire shape for a single inbound event. <see cref="EventType"/> must match
/// one of the 13 names in the vocabulary registry; <see cref="Props"/> must
/// contain every required prop for that type. <see cref="DeviceOccurredAtUtc"/>
/// is the device-clock instant (used to detect skew between phone and server)
/// and is optional — when absent the server clock stamps both fields.
/// </summary>
/// <param name="EventType">
/// One of the frozen vocabulary names (e.g. <c>closure.started</c>).
/// Anything else is a 400 with an <c>analytics.unknown_event_type</c> error.
/// </param>
/// <param name="Props">
/// Loose property bag that lands in <c>analytics.events.props</c> as JSONB.
/// Validation only checks that required keys are present and non-null; the
/// shape of each value is the producer's responsibility (matviews and
/// downstream consumers parse with explicit casts).
/// </param>
/// <param name="DeviceOccurredAtUtc">
/// Optional device-side timestamp. When non-null the handler stores it
/// verbatim in <c>device_occurred_at_utc</c>; <c>occurred_at_utc</c> always
/// comes from <see cref="AgriSync.BuildingBlocks.Abstractions.IClock"/>.
/// </param>
public sealed record IngestedEvent(
    string EventType,
    IReadOnlyDictionary<string, object?> Props,
    DateTime? DeviceOccurredAtUtc = null);
