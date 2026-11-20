// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>An active person with the row the page shows for them.</summary>
public sealed record TrustReportPerson(ControlRoomPerson Person, PersonDto Dto);

/// <summary>
/// What the report is counted from: the active people, the number of founders, and ONE History read per action (K15).
/// <see cref="PhonesShown"/> and <see cref="DoorRefused"/> are read for the last 7 days, <see cref="SignedIn"/> and
/// <see cref="PersonKept"/> for the last 30.
/// </summary>
public sealed record TrustReportInput(
    DateTime NowUtc,
    IReadOnlyList<TrustReportPerson> People,
    int FounderCount,
    HistoryRead PhonesShown,
    HistoryRead DoorRefused,
    HistoryRead SignedIn,
    HistoryRead PersonKept);

/// <summary>
/// The weekly trust report's numbers. Pure: it counts the rows it is given inside the windows and never reads anything.
/// A read that hit its limit is "not measured" with <see cref="HistoryReadLimitReason"/>, never a cut number (K15, P4).
/// In Release 1 downloads are not counted at all: all three carry <see cref="DownloadsReason"/>, never 0 (K20).
/// </summary>
public static class TrustReportCalculator
{
    public const string HistoryReadLimitReason = "history_read_limit";
    public const string DownloadsReason = "downloads_start_with_field_visits";

    public const int ShortWindowDays = 7;
    public const int LongWindowDays = 30;

    public static TrustReportDto Calculate(TrustReportInput input)
    {
        var weekAgo = input.NowUtc.AddDays(-ShortWindowDays);
        var monthAgo = input.NowUtc.AddDays(-LongWindowDays);

        var phones = Rows(input.PhonesShown, ControlRoomHistoryAction.PhonesShown, weekAgo);
        var refused = Rows(input.DoorRefused, ControlRoomHistoryAction.DoorRefused, weekAgo);

        MisValueDto looks, farms, lookers, doorRefused;
        if (input.PhonesShown.HitLimit)
        {
            looks = farms = lookers = NotMeasured(HistoryReadLimitReason);
        }
        else
        {
            looks = Counted(phones.Count);
            farms = Counted(phones.SelectMany(r => FarmIds(r.PayloadJson)).Distinct().Count());
            lookers = Counted(phones.Select(r => r.ActorUserId).Distinct().Count());
        }

        doorRefused = input.DoorRefused.HitLimit ? NotMeasured(HistoryReadLimitReason) : Counted(refused.Count);

        IReadOnlyList<PersonDto> notSignedIn = [];
        string? notSignedInReason = null;
        if (input.SignedIn.HitLimit || input.PersonKept.HitLimit)
        {
            notSignedInReason = HistoryReadLimitReason;
        }
        else
        {
            var signedIn = Rows(input.SignedIn, ControlRoomHistoryAction.SignedIn, monthAgo)
                .Select(r => r.ActorUserId).ToHashSet();
            var kept = Rows(input.PersonKept, ControlRoomHistoryAction.PersonKept, monthAgo)
                .Select(r => r.SubjectId).ToHashSet();
            notSignedIn = input.People
                .Where(p => !(p.Person.UserId is { } user && signedIn.Contains(user)) && !kept.Contains(p.Person.Id))
                .Select(p => p.Dto)
                .ToList();
        }

        var byRole = new Dictionary<string, int>();
        if (input.FounderCount > 0) byRole["founder"] = input.FounderCount;
        foreach (var group in input.People.GroupBy(p => ControlRoomRoles.Key(p.Person.StartingRole)))
            byRole[group.Key] = group.Count();

        var downloads = NotMeasured(DownloadsReason);
        return new TrustReportDto(
            input.NowUtc, input.FounderCount + input.People.Count, byRole,
            looks, farms, lookers, downloads, downloads, downloads,
            notSignedIn, notSignedInReason, doorRefused);
    }

    private static MisValueDto Counted(int n) => new(n, null);

    private static MisValueDto NotMeasured(string reason) => new(null, reason);

    private static List<ControlRoomHistoryLine> Rows(HistoryRead read, string action, DateTime fromUtc) =>
        read.Lines.Where(l => l.Action == action && l.AtUtc >= fromUtc).ToList();

    /// <summary>The <c>farmIds</c> of a <c>phones_shown</c> payload; none for the Users page (which carries <c>personCount</c>) or an unreadable payload.</summary>
    private static IEnumerable<Guid> FarmIds(string payloadJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("farmIds", out var ids)
                || ids.ValueKind != JsonValueKind.Array)
                return [];
            return ids.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.String && e.TryGetGuid(out _))
                .Select(e => e.GetGuid())
                .ToList();
        }
        catch (JsonException)
        {
            // Not silent: the row still counts or shows, with no details, and the trace says its payload was unreadable.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("control_room.history_payload_unreadable"));
            return [];
        }
    }
}
