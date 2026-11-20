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
/// <see cref="PersonKept"/> for the last 30. <see cref="TestAccountUserIds"/> are the test accounts
/// (<c>CompanyMis:ExcludedUserIds</c>) and <see cref="TestFarmIds"/> the farms they own (M9): both are required, so a
/// caller cannot count test accounts by forgetting them; pass empty sets to leave nothing out.
/// </summary>
public sealed record TrustReportInput(
    DateTime NowUtc,
    IReadOnlyList<TrustReportPerson> People,
    int FounderCount,
    HistoryRead PhonesShown,
    HistoryRead DoorRefused,
    HistoryRead SignedIn,
    HistoryRead PersonKept,
    IReadOnlySet<Guid> TestAccountUserIds,
    IReadOnlySet<Guid> TestFarmIds);

/// <summary>
/// The weekly trust report's numbers. Pure: it counts the rows it is given inside the windows and never reads anything.
/// A read that hit its limit is "not measured" with <see cref="HistoryReadLimitReason"/>, never a cut number (K15, P4).
/// In Release 1 downloads are not counted at all: all three carry <see cref="DownloadsReason"/>, never 0 (K20).
/// <para>
/// G1 fix round 1 (M9; global rule: test accounts stay out of every count). The three phone-look counts leave out every
/// <c>phones_shown</c> row whose actor is a test account, and every test farm from the farm sets. A row whose farms are
/// all test farms is not a look, so it adds to no count. A Users-page row (it carries <c>personCount</c>, no farms) and a
/// row whose payload cannot be read are left out only when the actor is a test account. The sign-in and kept rows are
/// NOT filtered by actor: they decide which named people are listed as unused, and the founder (a test account) is the
/// actor of every <c>person_kept</c> row, so dropping them would list kept or signed-in people as unused, which is untrue.
/// </para>
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

        var phones = Looks(input, weekAgo);
        var refused = Rows(input.DoorRefused, ControlRoomHistoryAction.DoorRefused, weekAgo);

        MisValueDto looks, farms, lookers, doorRefused;
        if (input.PhonesShown.HitLimit)
        {
            looks = farms = lookers = NotMeasured(HistoryReadLimitReason);
        }
        else
        {
            looks = Counted(phones.Count);
            farms = Counted(phones.SelectMany(r => r.Farms).Where(f => !input.TestFarmIds.Contains(f)).Distinct().Count());
            lookers = Counted(phones.Select(r => r.Row.ActorUserId).Distinct().Count());
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

    /// <summary>
    /// The <c>phones_shown</c> rows of the window that count as looks, each with its farm ids (M9): not by a test account,
    /// and not naming test farms only. A row with no farm ids (the Users page, or a payload that cannot be read) counts.
    /// </summary>
    private static List<(ControlRoomHistoryLine Row, IReadOnlyList<Guid> Farms)> Looks(TrustReportInput input, DateTime fromUtc) =>
        Rows(input.PhonesShown, ControlRoomHistoryAction.PhonesShown, fromUtc)
            .Where(r => !input.TestAccountUserIds.Contains(r.ActorUserId))
            .Select(r => (Row: r, Farms: FarmIds(r.PayloadJson)))
            .Where(r => r.Farms.Count == 0 || r.Farms.Any(f => !input.TestFarmIds.Contains(f)))
            .ToList();

    /// <summary>Every farm id named by the <c>phones_shown</c> rows of <paramref name="read"/>.</summary>
    internal static IReadOnlyCollection<Guid> FarmIdsIn(HistoryRead read) =>
        read.Lines.Where(l => l.Action == ControlRoomHistoryAction.PhonesShown)
            .SelectMany(l => FarmIds(l.PayloadJson))
            .ToHashSet();

    /// <summary>The <c>farmIds</c> of a <c>phones_shown</c> payload; none for the Users page (which carries <c>personCount</c>) or an unreadable payload.</summary>
    private static IReadOnlyList<Guid> FarmIds(string payloadJson)
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
