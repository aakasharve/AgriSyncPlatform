// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5; fix wave S-N1, S-N2)
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
/// <see cref="PersonKept"/> for the last 30. <see cref="TestFarmIds"/> are the farms owned by test accounts
/// (<c>CompanyMis:ExcludedUserIds</c>, M9): required, so a caller cannot count test farms by forgetting them; pass an
/// empty set to leave nothing out. <see cref="HistoryStartedAtUtc"/> is the time of the first History row (null when
/// there is none), so the report can say since when it counts (fix wave S-N2).
/// </summary>
public sealed record TrustReportInput(
    DateTime NowUtc,
    IReadOnlyList<TrustReportPerson> People,
    int FounderCount,
    HistoryRead PhonesShown,
    HistoryRead DoorRefused,
    HistoryRead SignedIn,
    HistoryRead PersonKept,
    IReadOnlySet<Guid> TestFarmIds,
    DateTime? HistoryStartedAtUtc = null);

/// <summary>
/// The weekly trust report's numbers. Pure: it counts the rows it is given inside the windows and never reads anything.
/// A read that hit its limit is "not measured" with <see cref="HistoryReadLimitReason"/>, never a cut number (K15, P4).
/// In Release 1 downloads are not counted at all: all three carry <see cref="DownloadsReason"/>, never 0 (K20).
/// <para>
/// Fix wave S-N1 (FR-C1, FR-M3): a phone look is never left out because of WHO looked. Every person who can look at
/// farmers' numbers is the founder or a team member, and staff accounts are put on the test-account list for Company MIS;
/// leaving out looks by listed accounts would empty the report under normal use. Only the SUBJECT filter stays: a row
/// whose farms are all test farms is not a look (M9). The count is "times phone numbers were shown" (one row per answer
/// that carried a real phone), and the report sends the exact window it counted and how many rows it left out, so the
/// console can label it so and open exactly the History lines it counted (History's <c>countedLooksOnly</c>).
/// </para>
/// <para>
/// Fix wave S-N2 (FR-I1): "not signed in" is split in two true groups. <see cref="TrustReportDto.NotSignedIn30Days"/>:
/// people added 30 or more days ago who have signed in before but not in the last 30 days.
/// <see cref="TrustReportDto.NeverSignedIn"/>: people who have never signed in, whenever they were added (a person added
/// an hour ago is here, never under "30 days"). A person is in one group at most. A person the founder kept in the last
/// 30 days is in neither. The sign-in and kept rows are not filtered by actor.
/// </para>
/// </summary>
public static class TrustReportCalculator
{
    public const string HistoryReadLimitReason = "history_read_limit";
    public const string DownloadsReason = "downloads_start_with_field_visits";

    public const int ShortWindowDays = 7;
    public const int LongWindowDays = 30;

    /// <summary>Every read ends this long after the moment of counting (a row written in the same second is in).</summary>
    public static readonly TimeSpan ReadSlack = TimeSpan.FromMinutes(1);

    public static TrustReportDto Calculate(TrustReportInput input)
    {
        var weekAgo = input.NowUtc.AddDays(-ShortWindowDays);
        var monthAgo = input.NowUtc.AddDays(-LongWindowDays);

        var shown = Rows(input.PhonesShown, ControlRoomHistoryAction.PhonesShown, weekAgo)
            .Select(r => (Row: r, Farms: FarmIds(r.PayloadJson)))
            .ToList();
        var phones = shown.Where(r => IsCountedLook(r.Farms, input.TestFarmIds)).ToList();
        var refused = Rows(input.DoorRefused, ControlRoomHistoryAction.DoorRefused, weekAgo);

        MisValueDto looks, farms, lookers, leftOut, doorRefused;
        if (input.PhonesShown.HitLimit)
        {
            looks = farms = lookers = leftOut = NotMeasured(HistoryReadLimitReason);
        }
        else
        {
            looks = Counted(phones.Count);
            farms = Counted(phones.SelectMany(r => r.Farms).Where(f => !input.TestFarmIds.Contains(f)).Distinct().Count());
            lookers = Counted(phones.Select(r => r.Row.ActorUserId).Distinct().Count());
            leftOut = Counted(shown.Count - phones.Count);
        }

        doorRefused = input.DoorRefused.HitLimit ? NotMeasured(HistoryReadLimitReason) : Counted(refused.Count);

        var notSignedIn = new List<PersonDto>();
        var neverSignedIn = new List<PersonDto>();
        string? notSignedInReason = null;
        if (input.SignedIn.HitLimit || input.PersonKept.HitLimit)
        {
            notSignedInReason = HistoryReadLimitReason;
        }
        else
        {
            var signedInRecently = Rows(input.SignedIn, ControlRoomHistoryAction.SignedIn, monthAgo)
                .Select(r => r.ActorUserId).ToHashSet();
            var kept = Rows(input.PersonKept, ControlRoomHistoryAction.PersonKept, monthAgo)
                .Select(r => r.SubjectId).ToHashSet();
            foreach (var p in input.People.Where(p => !kept.Contains(p.Person.Id)))
            {
                var recent = (p.Person.UserId is { } user && signedInRecently.Contains(user))
                    || p.Dto.LastSignedInUtc >= monthAgo;
                var ever = recent || p.Dto.LastSignedInUtc is not null;
                if (!ever)
                {
                    neverSignedIn.Add(p.Dto);
                }
                else if (!recent && p.Person.AddedAtUtc <= monthAgo)
                {
                    notSignedIn.Add(p.Dto);
                }
            }
        }

        var byRole = new Dictionary<string, int>();
        if (input.FounderCount > 0) byRole["founder"] = input.FounderCount;
        foreach (var group in input.People.GroupBy(p => ControlRoomRoles.Key(p.Person.StartingRole)))
            byRole[group.Key] = group.Count();

        var downloads = NotMeasured(DownloadsReason);
        return new TrustReportDto(
            input.NowUtc, input.FounderCount + input.People.Count, byRole,
            looks, farms, lookers, downloads, downloads, downloads,
            notSignedIn, notSignedInReason, doorRefused,
            PhoneLooksFromUtc: weekAgo,
            PhoneLooksToUtc: input.NowUtc + ReadSlack,
            PhoneLooksLeftOutTestFarmsOnly: leftOut,
            NeverSignedIn: neverSignedIn,
            HistoryStartedAtUtc: input.HistoryStartedAtUtc);
    }

    private static MisValueDto Counted(int n) => new(n, null);

    private static MisValueDto NotMeasured(string reason) => new(null, reason);

    private static List<ControlRoomHistoryLine> Rows(HistoryRead read, string action, DateTime fromUtc) =>
        read.Lines.Where(l => l.Action == action && l.AtUtc >= fromUtc).ToList();

    /// <summary>
    /// The one rule for which <c>phones_shown</c> rows count as looks (M9, S-N1): a row naming at least one farm that is
    /// not a test farm, or naming no farm at all (the Users page, or a payload that cannot be read). Who looked never
    /// matters. Shared with History's <c>countedLooksOnly</c>, so the lines it opens are exactly the lines counted.
    /// </summary>
    internal static bool IsCountedLook(IReadOnlyList<Guid> farmIds, IReadOnlySet<Guid> testFarmIds) =>
        farmIds.Count == 0 || farmIds.Any(f => !testFarmIds.Contains(f));

    /// <summary>Every farm id named by the <c>phones_shown</c> rows of <paramref name="read"/>.</summary>
    internal static IReadOnlyCollection<Guid> FarmIdsIn(HistoryRead read) =>
        read.Lines.Where(l => l.Action == ControlRoomHistoryAction.PhonesShown)
            .SelectMany(l => FarmIds(l.PayloadJson))
            .ToHashSet();

    /// <summary>The <c>farmIds</c> of a <c>phones_shown</c> payload; none for the Users page (which carries <c>personCount</c>) or an unreadable payload.</summary>
    internal static IReadOnlyList<Guid> FarmIds(string payloadJson)
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
