using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;

namespace Analytics.Application.UseCases.IngestEvents;

/// <summary>
/// Receives a batch of mobile-web telemetry events from
/// <c>POST /analytics/ingest</c>, validates against the frozen
/// <see cref="Domain.Vocabulary.EventVocabulary"/>, and bulk-inserts into
/// <c>analytics.events</c> via <see cref="IAnalyticsWriter.EmitManyAsync"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>No MediatR.</b> The codebase calls handlers directly from endpoint
/// delegates via <see cref="HandleAsync"/>; the plan sketch in §2.4 used
/// <c>IRequestHandler&lt;T,U&gt;</c> notation purely as a shorthand. Wiring
/// MediatR for this single use case would burn a dependency without buying
/// anything observable.
/// </para>
/// <para>
/// <b>No new IAnalyticsEventRepository port.</b> The plan envisioned one
/// for "bulk insert"; the existing <see cref="IAnalyticsWriter"/> already
/// exposes <see cref="IAnalyticsWriter.EmitManyAsync"/> which calls
/// <c>DbSet.AddRangeAsync + SaveChangesAsync</c> in one round trip — that
/// IS the bulk path for our volume budget (well under 1M events/day per
/// the ADR). Adding a second port that writes to the same table would
/// duplicate the failure-isolation contract and break the Phase B
/// AdminAuditEmitter, which deliberately uses <see cref="IAnalyticsWriter"/>
/// today.
/// </para>
/// <para>
/// <b>Failure semantics.</b> Validation failure → <see cref="Result.Failure"/>
/// with <see cref="ErrorKind.Validation"/> (endpoint maps to 400 + drops
/// every event in the batch — the bus's 400-handling rule is "vocab error,
/// no point retrying"). Persistence failure is swallowed inside
/// <see cref="AnalyticsWriter.EmitManyAsync"/> per the writer's
/// non-blocking observability contract; the handler still returns success
/// because the caller has done its job. This matches the ADR's "telemetry
/// is best-effort" stance.
/// </para>
/// </remarks>
public sealed class IngestEventsHandler(
    IAnalyticsWriter writer,
    IngestEventsValidator validator,
    IClock clock,
    ILogger<IngestEventsHandler> logger)
{
    /// <summary>
    /// Validate the batch and persist accepted events as a single bulk write.
    /// </summary>
    /// <param name="command">The decoded request body.</param>
    /// <param name="actorUserId">
    /// The authenticated user's id from <c>HttpContext.User</c>; passed
    /// explicitly so the handler stays free of HTTP dependencies. May be
    /// <see langword="null"/> only in tests; the endpoint enforces auth
    /// before calling the handler.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    public async Task<Result> HandleAsync(
        IngestEventsCommand command,
        Guid? actorUserId,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var outcome = validator.Validate(command);
        if (!outcome.IsValid)
        {
            // Rolled-up message stays under the 200-char Error.Description
            // budget — the per-event detail is in outcome.Errors which the
            // endpoint includes in the 400 body for the client to log.
            var first = outcome.Errors[0];
            logger.LogWarning(
                "Analytics ingest rejected: {ErrorCount} validation error(s); first={Code} ({EventType}) at index {Index}",
                outcome.Errors.Count,
                first.Code,
                first.EventType ?? "<null>",
                first.Index);

            return Result.Failure(Error.Validation(
                first.Code,
                $"Analytics ingest rejected: {outcome.Errors.Count} error(s); see response body for details."));
        }

        if (command.Events.Count == 0)
        {
            // Empty batch is a valid request — the caller has nothing to
            // report. Skip the write entirely so we don't churn EF tracking
            // for zero entities.
            return Result.Success();
        }

        var serverNow = clock.UtcNow;
        var rows = new List<AnalyticsEvent>(command.Events.Count);
        for (var i = 0; i < command.Events.Count; i++)
        {
            var ev = command.Events[i];
            rows.Add(MapToAnalyticsEvent(ev, actorUserId, serverNow));
        }

        await writer.EmitManyAsync(rows, ct);
        return Result.Success();
    }

    private static AnalyticsEvent MapToAnalyticsEvent(
        IngestedEvent ev,
        Guid? actorUserId,
        DateTime serverNow)
    {
        // farmId is optional at the column level (api.error fires pre-auth),
        // so probe the prop bag rather than insisting it's present.
        FarmId? farmId = null;
        if (ev.Props is not null
            && ev.Props.TryGetValue("farmId", out var farmRaw)
            && farmRaw is not null
            && Guid.TryParse(farmRaw.ToString(), out var parsed)
            && parsed != Guid.Empty)
        {
            farmId = new FarmId(parsed);
        }

        // The optional `trigger` prop, when present, lifts to the dedicated
        // column so matviews can index on it without parsing JSON.
        // AnalyticsEventConfiguration declares the column as required (max
        // length 24); an empty string keeps the contract intact when the
        // producer didn't supply one.
        var trigger = ev.Props is not null
                      && ev.Props.TryGetValue("trigger", out var triggerRaw)
                      && triggerRaw is not null
            ? triggerRaw.ToString() ?? string.Empty
            : string.Empty;

        // Cap at the column's declared HasMaxLength(24) so a misbehaving
        // producer can't pivot a JSONB free-text field into a column
        // overflow exception that the writer would silently swallow.
        if (trigger.Length > 24)
        {
            trigger = trigger[..24];
        }

        var actorRole = actorUserId.HasValue ? "user" : "anonymous";
        var actorIdValue = actorUserId.HasValue ? new UserId(actorUserId.Value) : (UserId?)null;

        var propsJson = ev.Props is null
            ? "{}"
            : JsonSerializer.Serialize(ev.Props);

        return new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: ev.EventType,
            OccurredAtUtc: serverNow,
            ActorUserId: actorIdValue,
            FarmId: farmId,
            OwnerAccountId: null,
            ActorRole: actorRole,
            Trigger: trigger,
            DeviceOccurredAtUtc: ev.DeviceOccurredAtUtc,
            SchemaVersion: "v1",
            PropsJson: propsJson);
    }
}
