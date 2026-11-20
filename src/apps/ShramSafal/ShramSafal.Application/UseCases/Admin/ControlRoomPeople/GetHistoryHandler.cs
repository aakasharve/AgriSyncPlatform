// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>Days is 7 to 90; Action is one History action, or null for all.</summary>
public sealed record GetHistoryQuery(Guid ReaderUserId, int Days, string? Action);

/// <summary>
/// The History page: the control room's own trail, newest first, as lines the console shows in a sentence each.
/// <list type="bullet">
/// <item>One audited read of at most <see cref="Limit"/> rows; <c>HitLimit</c> tells the page to say "Showing the newest N".</item>
/// <item>Names are display names (a person's or an account's), never a phone number. A door line names the door as its actor.</item>
/// <item>Details per action: see <see cref="DetailsFor"/>. A payload that cannot be read gives a line with no details, never a failed page.</item>
/// <item>A <c>phones_shown</c> line names the farms from the payload's farm ids, looked up once for the whole page: the
/// first 10, ", "-joined, then " and N more".</item>
/// </list>
/// </summary>
public sealed class GetHistoryHandler(
    IControlRoomStore store, IControlRoomPhoneDirectory directory, IControlRoomHistory history,
    IAdminMisRepository misRepo, IClock clock)
{
    public const int Limit = 500;
    public const int MinDays = 7;
    public const int MaxDays = 90;
    public const int FarmNamesShown = 10;
    public const string DoorName = "The sign-in door";
    public const string UnknownName = "Someone";

    private static readonly HashSet<string> KnownActions =
    [
        ControlRoomHistoryAction.PersonAdded, ControlRoomHistoryAction.PersonChanged, ControlRoomHistoryAction.PersonRemoved,
        ControlRoomHistoryAction.PersonKept, ControlRoomHistoryAction.SeatBound, ControlRoomHistoryAction.DoorRefused,
        ControlRoomHistoryAction.CodeNotSent, ControlRoomHistoryAction.SignedIn, ControlRoomHistoryAction.PhonesShown,
        ControlRoomHistoryAction.VisitsGiven, ControlRoomHistoryAction.VisitDone, ControlRoomHistoryAction.DaySheetDownloaded,
        ControlRoomHistoryAction.DaySheetPrinted
    ];

    private static readonly HashSet<string> NamesTheSubject =
    [
        ControlRoomHistoryAction.PersonAdded, ControlRoomHistoryAction.PersonChanged, ControlRoomHistoryAction.PersonRemoved,
        ControlRoomHistoryAction.PersonKept, ControlRoomHistoryAction.SeatBound
    ];

    public async Task<Result<HistoryAnswerDto>> HandleAsync(GetHistoryQuery query, CancellationToken ct = default)
    {
        if (query.Days is < MinDays or > MaxDays)
            return Result.Failure<HistoryAnswerDto>(Error.Validation(
                ControlRoomPeopleCodes.RangeInvalid, $"Choose {MinDays} to {MaxDays} days."));

        var action = string.IsNullOrWhiteSpace(query.Action) ? null : query.Action.Trim();
        if (action is not null && !KnownActions.Contains(action))
            return Result.Failure<HistoryAnswerDto>(Error.Validation(
                ControlRoomPeopleCodes.ActionUnknown, "That kind of History line is not known."));

        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var read = await history.ReadAsync(
            query.ReaderUserId, now.AddDays(-query.Days), now.AddMinutes(1), action, Limit, ct);

        var payloads = read.Lines.Select(l => ParsePayload(l.PayloadJson)).ToList();
        var farmNames = await FarmNamesAsync(query.ReaderUserId, payloads, ct);
        var names = new NameBook(store, directory);

        var lines = new List<HistoryLineDto>(read.Lines.Count);
        for (var i = 0; i < read.Lines.Count; i++)
        {
            var line = read.Lines[i];
            var payload = payloads[i];
            var actor = await names.ActorAsync(line.ActorUserId, ct);
            string? subject = null;
            if (NamesTheSubject.Contains(line.Action))
            {
                var personId = line.Action == ControlRoomHistoryAction.SeatBound
                    ? ReadGuid(payload, "personId")
                    : line.SubjectId;
                subject = personId is { } id ? await names.PersonAsync(id, ct) : null;
            }

            lines.Add(new HistoryLineDto(line.AtUtc, line.Action, actor, subject, DetailsFor(line.Action, payload, farmNames)));
        }

        return Result.Success(new HistoryAnswerDto(lines, read.HitLimit, Limit));
    }

    /// <summary>The keys the console reads, per action (contract ruling 1). Tick lists are comma-joined keys in tick order.</summary>
    internal static IReadOnlyDictionary<string, string?> DetailsFor(
        string action, JsonElement? payload, IReadOnlyDictionary<Guid, string> farmNames)
    {
        var d = new Dictionary<string, string?>();
        if (payload is not { } p) return d;

        switch (action)
        {
            case ControlRoomHistoryAction.PersonAdded:
                d["role"] = ReadString(p, "role");
                d["ticks"] = ReadList(p, "ticks");
                break;
            case ControlRoomHistoryAction.PersonChanged:
                if (ReadString(p, "role") is { } role) d["role"] = role;
                d["added"] = ReadList(p, "added");
                d["removed"] = ReadList(p, "removed");
                break;
            case ControlRoomHistoryAction.DoorRefused:
                d["step"] = ReadString(p, "step");
                d["phoneTail"] = ReadString(p, "phoneTail");
                d["reason"] = ReadString(p, "reason");
                break;
            case ControlRoomHistoryAction.CodeNotSent:
                d["phoneTail"] = ReadString(p, "phoneTail");
                d["reason"] = ReadString(p, "reason");
                break;
            case ControlRoomHistoryAction.PhonesShown:
                if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty("farmIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
                {
                    var farmIds = ids.EnumerateArray()
                        .Where(e => e.ValueKind == JsonValueKind.String && e.TryGetGuid(out _))
                        .Select(e => e.GetGuid()).ToList();
                    d["farmCount"] = farmIds.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    d["farms"] = FarmsText(farmIds, farmNames);
                }
                else if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty("personCount", out var pc))
                {
                    d["personCount"] = pc.ValueKind == JsonValueKind.Number ? pc.GetRawText() : null;
                }

                break;
        }

        return d;
    }

    private static string? FarmsText(IReadOnlyList<Guid> farmIds, IReadOnlyDictionary<Guid, string> farmNames)
    {
        var shown = farmIds.Take(FarmNamesShown).Where(farmNames.ContainsKey).Select(id => farmNames[id]).ToList();
        if (shown.Count == 0) return null;
        var text = string.Join(", ", shown);
        return farmIds.Count > FarmNamesShown ? $"{text} and {farmIds.Count - FarmNamesShown} more" : text;
    }

    /// <summary>One lookup for every farm a line will name (the first 10 of each line).</summary>
    private async Task<IReadOnlyDictionary<Guid, string>> FarmNamesAsync(
        Guid readerUserId, IReadOnlyList<JsonElement?> payloads, CancellationToken ct)
    {
        var wanted = new HashSet<Guid>();
        foreach (var payload in payloads)
        {
            if (payload is { ValueKind: JsonValueKind.Object } p
                && p.TryGetProperty("farmIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
            {
                foreach (var e in ids.EnumerateArray().Take(FarmNamesShown))
                    if (e.ValueKind == JsonValueKind.String && e.TryGetGuid(out var id)) wanted.Add(id);
            }
        }

        if (wanted.Count == 0) return new Dictionary<Guid, string>();

        var farms = await misRepo.GetFarmContactsAsync(readerUserId, wanted, ct);
        return farms.ToDictionary(f => f.FarmId, f => f.Name);
    }

    private static JsonElement? ParsePayload(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            // Not silent: the row still counts or shows, with no details, and the trace says its payload was unreadable.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("control_room.history_payload_unreadable"));
            return null;
        }
    }

    private static string? ReadString(JsonElement p, string name) =>
        p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static string ReadList(JsonElement p, string name) =>
        p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? string.Join(",", v.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()))
            : string.Empty;

    private static Guid? ReadGuid(JsonElement? payload, string name) =>
        payload is { ValueKind: JsonValueKind.Object } p && p.TryGetProperty(name, out var v)
            && v.ValueKind == JsonValueKind.String && v.TryGetGuid(out var id)
            ? id
            : null;

    /// <summary>Display names for the ids on a page, each looked up once.</summary>
    private sealed class NameBook(IControlRoomStore store, IControlRoomPhoneDirectory directory)
    {
        private readonly Dictionary<Guid, string> _actors = [];
        private readonly Dictionary<Guid, string?> _people = [];

        /// <summary>An actor is a user id (the founder, a signed-in person) or the door.</summary>
        public async Task<string> ActorAsync(Guid userId, CancellationToken ct)
        {
            if (userId == SystemActor.ControlRoomDoor) return DoorName;
            if (_actors.TryGetValue(userId, out var known)) return known;

            var person = await store.FindActiveByUserAsync(userId, ct);
            var name = person?.DisplayName ?? (await directory.FindByUserAsync(userId, ct))?.DisplayName ?? UnknownName;
            _actors[userId] = name;
            return name;
        }

        /// <summary>A person id (removed people included); null when there is no such person.</summary>
        public async Task<string?> PersonAsync(Guid personId, CancellationToken ct)
        {
            if (_people.TryGetValue(personId, out var known)) return known;
            var name = (await store.GetAsync(personId, ct))?.DisplayName;
            _people[personId] = name;
            return name;
        }
    }
}
