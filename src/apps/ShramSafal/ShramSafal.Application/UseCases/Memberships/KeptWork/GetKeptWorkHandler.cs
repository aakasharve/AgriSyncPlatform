using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.KeptWork;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §11.2, owner's kept-work card). The farm's
/// <b>primary account holder's</b> list of work the server kept for him: work refused for want of an authority or a working
/// seat (<see cref="LateAuthorityAudit.KeptForOwner"/>, lanes 2b / MU-4), work that arrived after the authority behind it
/// ended (<see cref="LateAuthorityAudit.AcceptedAfterEnd"/>, lanes 2b / L8b-1), and the one row that says a sender's daily
/// cap was reached. Until now these reached only <c>/audit</c>, which no screen shows.
///
/// <para><b>Who may read it.</b> The primary account holder alone (<see cref="FarmAuthorityGate.IsPrimaryAccountHolderAsync"/>):
/// a kept mutation holds other people's work whole. A standing that is not his is <see cref="ShramSafalErrors.Forbidden"/>
/// (no body), exactly like a stranger (E4).</para>
///
/// <para><b>What it sends.</b> What (the kind of work, in a stable code the phone words), who (name), when, and why - never
/// the mutation body itself. Bounded: the last <see cref="WindowDays"/> days, newest first, at most <see cref="MaxRows"/>.</para>
/// </summary>
public sealed class GetKeptWorkHandler(IShramSafalRepository repository, IClock clock)
{
    /// <summary>How far back the list looks (CTO ruling, reversible).</summary>
    public const int WindowDays = 60;

    /// <summary>The most rows one read returns.</summary>
    public const int MaxRows = 100;

    public const string KindRefused = "refused";
    public const string KindArrivedLate = "arrived_late";
    public const string KindCapReached = "cap_reached";

    public async Task<Result<IReadOnlyList<KeptWorkItemDto>>> HandleAsync(Guid farmId, Guid callerUserId, CancellationToken ct = default)
    {
        if (farmId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<KeptWorkItemDto>>(ShramSafalErrors.InvalidCommand);
        }

        if (!await FarmAuthorityGate.IsPrimaryAccountHolderAsync(repository, farmId, callerUserId, ct))
        {
            return Result.Failure<IReadOnlyList<KeptWorkItemDto>>(ShramSafalErrors.Forbidden);
        }

        var rows = (await repository.GetAuditEventsForFarmByActionsAsync(
                farmId,
                [LateAuthorityAudit.KeptForOwner, LateAuthorityAudit.AcceptedAfterEnd, Sync.PushSyncBatch.PushSyncBatchHandler.KeptDailyCapReachedAction],
                clock.UtcNow.AddDays(-WindowDays),
                MaxRows,
                ct))
            .Where(r => r.FarmId == farmId)
            .OrderByDescending(r => r.OccurredAtUtc)
            .Take(MaxRows)
            .ToList();
        if (rows.Count == 0)
        {
            return Result.Success<IReadOnlyList<KeptWorkItemDto>>([]);
        }

        var actorIds = rows.Select(r => (Guid)r.ActorUserId).Distinct().ToList();
        var directory = await repository.GetOperatorsByIdsAsync(actorIds, ct);
        var names = directory
            .Where(o => !string.IsNullOrWhiteSpace(o.DisplayName))
            .ToDictionary(o => o.UserId, o => o.DisplayName);

        var items = rows
            .Select(r => Project(r, names.TryGetValue((Guid)r.ActorUserId, out var n) ? n : null))
            .ToList();
        return Result.Success<IReadOnlyList<KeptWorkItemDto>>(items);
    }

    private static KeptWorkItemDto Project(Domain.Audit.AuditEvent row, string? name)
    {
        var kind = row.Action switch
        {
            LateAuthorityAudit.KeptForOwner => KindRefused,
            LateAuthorityAudit.AcceptedAfterEnd => KindArrivedLate,
            _ => KindCapReached,
        };

        string? what = row.EntityType;
        string? why = null;
        DateTime? endedAt = null;
        try
        {
            using var document = JsonDocument.Parse(row.Payload);
            var root = document.RootElement;
            if (kind == KindRefused)
            {
                what = Text(root, "mutationType") ?? what;
                why = Text(root, "refusal");
            }
            else if (kind == KindArrivedLate)
            {
                // The authority that had ended: "TakeAttendance" / "ConfirmRecords" / "PlanWork" - the phone words it.
                why = Text(root, "authority");
                endedAt = Time(root, "authorityEndedAtUtc");
            }
        }
        catch (JsonException ex)
        {
            // Never a guessed reason: an unreadable row is still listed (what + who + when), with no reason, and the trace says so.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "kept_work.row_unreadable",
                tags: new System.Diagnostics.ActivityTagsCollection { { "exception.type", ex.GetType().Name } }));
        }

        return new KeptWorkItemDto(row.Id, kind, what, why, (Guid)row.ActorUserId, name, row.OccurredAtUtc, endedAt);
    }

    private static string? Text(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static DateTime? Time(JsonElement root, string name) =>
        Text(root, name) is { } text
        && DateTime.TryParse(text, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var at)
            ? at
            : null;
}

/// <summary>
/// One kept item on the wire. <c>Kind</c>: "refused" / "arrived_late" / "cap_reached". <c>What</c>: the mutation type
/// ("add_cost_entry", ...) or the entity type; <c>Why</c>: the refusal code, or the authority that had ended. No mutation
/// body, no ids of the work itself.
/// </summary>
public sealed record KeptWorkItemDto(
    Guid Id,
    string Kind,
    string? What,
    string? Why,
    Guid WhoUserId,
    string? WhoName,
    DateTime AtUtc,
    DateTime? AuthorityEndedAtUtc);
