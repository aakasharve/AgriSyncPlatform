using System.Text.Json;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26) — one record whose audience is NOT the normal team, as every door needs it:
/// whose it is (maker), where (farm, day, plot), when its audience last changed, the people chosen for it, and the ids
/// that hang from it (its AI parse job, a money record's bill photos). Content-free on purpose.
/// </summary>
public sealed record RestrictedRecord(
    string Kind,
    Guid Id,
    Guid FarmId,
    RecordAudience Audience,
    Guid MakerUserId,
    DateTime CreatedAtUtc,
    DateTime? AudienceChangedAtUtc,
    DateOnly Date,
    Guid? PlotId,
    Guid? SourceAiJobId,
    IReadOnlyCollection<Guid> BillPhotoIds,
    IReadOnlyCollection<Guid> SelectedUserIds)
{
    /// <summary>
    /// spec: plr-d10 lane PRV fix pass 1 (L7) — a money record whose bill-photo list cannot be read. A bill photo is linked
    /// to the FARM (<c>Bill</c> / legacy <c>Farm</c>), not to its money record, so nothing else ties it to this record:
    /// when the record is kept from a reader, every bill photo of its farm is kept from him too (fail closed).
    /// </summary>
    public bool BillPhotosUnreadable { get; init; }

    public static RestrictedRecord Of(DailyLog log, IReadOnlyCollection<Guid> selected)
    {
        ArgumentNullException.ThrowIfNull(log);
        return new RestrictedRecord(
            RecordKinds.DailyLog, log.Id, (Guid)log.FarmId, log.Audience, log.OperatorUserId.Value, log.CreatedAtUtc,
            log.AudienceChangedAtUtc, log.LogDate, log.PlotId, log.SourceAiJobId, [], selected);
    }

    public static RestrictedRecord Of(CostEntry entry, IReadOnlyCollection<Guid> selected)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return new RestrictedRecord(
            RecordKinds.CostEntry, entry.Id, (Guid)entry.FarmId, entry.Audience, entry.CreatedByUserId.Value,
            entry.CreatedAtUtc, entry.AudienceChangedAtUtc, entry.EntryDate, entry.PlotId, entry.SourceAiJobId,
            BillPhotoIdsOf(entry.ClientAttachmentIdsJson), selected)
        {
            BillPhotosUnreadable = BillPhotoIdsUnreadable(entry.ClientAttachmentIdsJson),
        };
    }

    /// <summary>
    /// Fix pass 1 (L7) — is there a stated list that is NOT a readable list of ids (broken JSON, or not a list)? Blank or
    /// JSON <c>null</c> is "names no photo", which is readable.
    /// </summary>
    public static bool BillPhotoIdsUnreadable(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind is not (JsonValueKind.Array or JsonValueKind.Null);
        }
        catch (JsonException)
        {
            // Not silent: the answer IS "unreadable" (the photo rule fails closed for the farm), the repository logs it
            // through the normal logger, and the trace carries it too.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("record_privacy.bill_photo_ids_json.fail_closed"));
            return true;
        }
    }

    /// <summary>
    /// The bill photos a money record names (its client-stated attachment ids); unreadable = none named HERE, and the
    /// record is marked <see cref="BillPhotosUnreadable"/> so the photo rule fails closed for its farm (fix pass 1, L7).
    /// </summary>
    public static IReadOnlyCollection<Guid> BillPhotoIdsOf(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind != JsonValueKind.Array
                ? []
                : document.RootElement.EnumerateArray()
                    .Select(e => e.ValueKind == JsonValueKind.String && Guid.TryParse(e.GetString(), out var id) ? id : Guid.Empty)
                    .Where(id => id != Guid.Empty)
                    .ToHashSet();
        }
        catch (JsonException ex)
        {
            // Not a list of ids: none named here; BillPhotosUnreadable makes the farm's bill photos fail closed (L7), and the
            // repository logs it through the normal logger.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "record_privacy.bill_photo_ids_json.unreadable",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    { "exception.type", ex.GetType().Name },
                }));
            return [];
        }
    }
}

/// <summary>lane PRV — the little a door needs to decide whether a change may touch one record.</summary>
public sealed record RecordAudienceHead(string Kind, Guid Id, Guid FarmId, RecordAudience Audience, Guid MakerUserId);

/// <summary>
/// spec: plr-d10 lane MU-4 (MU design §11.6, §11.7) — WHERE one work or money record sits and who made it: everything the
/// place rule needs, content-free. A work record's plots (none when it is the whole farm's), a money record's one plot
/// (none when it is shared, split or unallocated), its day, its AI parse job and — for money — the bill photos it names.
/// </summary>
public sealed record RecordPlace(
    string Kind,
    Guid Id,
    Guid FarmId,
    Guid MakerUserId,
    DateOnly Date,
    DateTime CreatedAtUtc,
    IReadOnlyCollection<Guid> PlotIds,
    Guid? SourceAiJobId,
    IReadOnlyCollection<Guid> BillPhotoIds)
{
    /// <summary>A money record whose bill-photo list cannot be read (PRV fix pass 1, L7: its farm's bills fail closed).</summary>
    public bool BillPhotosUnreadable { get; init; }

    /// <summary>The whole farm's, or a place nobody stated (no plot named).</summary>
    public bool WholeFarm => PlotIds.Count == 0;

    /// <summary>A work record's place: its plots as stored (none for the whole farm).</summary>
    public static RecordPlace OfLog(
        Guid id, Guid farmId, Guid makerUserId, DateOnly date, DateTime createdAtUtc, DailyLogScope scope, Guid? plotId,
        IReadOnlyCollection<Guid>? plotIds, Guid? sourceAiJobId) =>
        new(RecordKinds.DailyLog, id, farmId, makerUserId, date, createdAtUtc,
            scope == DailyLogScope.Farm
                ? []
                : (plotIds is { Count: > 0 } ? plotIds : plotId is { } one ? [one] : []).Where(p => p != Guid.Empty).ToHashSet(),
            sourceAiJobId, []);

    /// <summary>A money record's place: its one plot, or none (shared, split or unallocated).</summary>
    public static RecordPlace OfCost(
        Guid id, Guid farmId, Guid makerUserId, DateOnly date, DateTime createdAtUtc, Guid? plotId, Guid? sourceAiJobId,
        string? clientAttachmentIdsJson) =>
        new(RecordKinds.CostEntry, id, farmId, makerUserId, date, createdAtUtc,
            plotId is { } one && one != Guid.Empty ? [one] : [], sourceAiJobId,
            RestrictedRecord.BillPhotoIdsOf(clientAttachmentIdsJson))
        {
            BillPhotosUnreadable = RestrictedRecord.BillPhotoIdsUnreadable(clientAttachmentIdsJson),
        };

    /// <summary>The same place as a hidden-record entry (the shape every PRV door already asks).</summary>
    public RestrictedRecord AsHidden() =>
        new(Kind, Id, FarmId, RecordAudience.Team, MakerUserId, CreatedAtUtc, null, Date,
            PlotIds.Count == 1 ? PlotIds.First() : null, SourceAiJobId, BillPhotoIds, [])
        {
            BillPhotosUnreadable = BillPhotosUnreadable,
        };
}

/// <summary>
/// spec: plr-d10 lane MU-4 — THE place rule, pure, beside the audience rule: a record reaches a person only when BOTH
/// allow it (orchestrator call 6). For a seat that covers every plot and reads the farm's records it allows everything.
/// <list type="bullet">
/// <item>An own-records-only seat (the कामगार label or the स्वतःचं काम scope, §11.7) → of money, only what he made; work
/// records keep MU-3's own-records rule at each door (one rule for the label and the scope: <see cref="FarmReadScope.OwnRecordsOnly"/>).</item>
/// <item>A chosen-plots seat → a work or money record on any of his plots (one spanning plots is sent narrowed to his
/// plots); a whole-farm or unplaced one (a shared, split or unallocated cost included) only if he made it — his own
/// submission and its status always reach him (D-28); one on other plots only → no, even his own (§3 G2: "outside the
/// scope … neither sent nor accepted"; the server keeps it whole, P10). One rule for both kinds, so a record and the money
/// its own lines made always travel together (a line's money carries its record's place, RecordMoneyPlace). A split bill
/// reaches him as his share lines only (D-39, <see cref="RecordVisibility.Ledger"/>).</item>
/// </list>
/// </summary>
public static class RecordPlaceRule
{
    /// <summary>Does this seat read records by place at all (anything but every record of the farm)?</summary>
    public static bool Narrows(FarmReadScope? scope) =>
        scope is not null && !scope.IsPrimaryAccountHolder && (scope.PlotIds is not null || scope.OwnRecordsOnly);

    /// <summary>
    /// Does this seat cover CHOSEN plots? The single-record doors (a change, its voice, its parse) ask the place rule only
    /// for such a seat; an own-records-only seat keeps MU-3's own checks there (its writes stay as they were, §11.7: he may
    /// log on any plot).
    /// </summary>
    public static bool NarrowsByPlot(FarmReadScope? scope) =>
        scope is not null && !scope.IsPrimaryAccountHolder && scope.PlotIds is not null;

    public static bool MaySee(FarmReadScope? scope, Guid readerUserId, RecordPlace place)
    {
        ArgumentNullException.ThrowIfNull(place);
        if (scope is null)
        {
            return false;
        }

        if (!Narrows(scope))
        {
            return true;
        }

        var his = readerUserId != Guid.Empty && place.MakerUserId == readerUserId;
        if (scope.OwnRecordsOnly)
        {
            // Other people's MONEY never reaches him (§11.7). Other people's WORK records follow MU-3's own-records rule at
            // each door, exactly as built (the pull sends his own; the labour page keeps what MU-3 gives a seat that takes
            // हजेरी): this rule does not narrow them a second time.
            return place.Kind != RecordKinds.CostEntry || his;
        }

        // lane MU-4 fix pass 1 (M5, D-28) — his own money submission always reaches him, whatever its plot.
        if (his && place.Kind == RecordKinds.CostEntry)
        {
            return true;
        }

        return place.WholeFarm ? his : place.PlotIds.Any(scope.CoversPlot);
    }
}

/// <summary>
/// lane PRV — THE audience rule, pure. May the holder of <paramref name="scope"/> see a record with this audience?
/// <list type="bullet">
/// <item>No scope (no working standing on the farm) → no.</item>
/// <item><see cref="RecordAudience.Team"/> → yes (his normal rights still decide every part of it, as before).</item>
/// <item>The farm's registrant, the record holder → yes (D-26: "Only me" is HIS; fix pass 1, L2: never a second
/// PrimaryOwner seat).</item>
/// <item>The person who made the record → yes (the maker always stays; orchestrator call 4).</item>
/// <item><see cref="RecordAudience.Selected"/> → only a person the holder chose.</item>
/// </list>
/// It only ever narrows: a "yes" here never grants anything his rights do not (call 5).
/// </summary>
public static class RecordAudienceRule
{
    public static bool MaySee(
        FarmReadScope? scope, Guid readerUserId, RecordAudience audience, Guid makerUserId, IReadOnlyCollection<Guid> selected)
    {
        if (scope is null)
        {
            return false;
        }

        if (audience == RecordAudience.Team || scope.IsRecordHolder)
        {
            return true;
        }

        if (readerUserId != Guid.Empty && readerUserId == makerUserId)
        {
            return true;
        }

        return audience == RecordAudience.Selected && readerUserId != Guid.Empty && selected.Contains(readerUserId);
    }
}

/// <summary>
/// lane PRV — what ONE reader may see of the restricted records of the farms he reads: the pull, every REST read and
/// every total ask this, so no door answers differently (founder: "privacy must apply everywhere the information
/// travels"). Built from <see cref="IShramSafalRepository.GetRestrictedRecordsAsync"/> and the reader's
/// <see cref="FarmReadScope"/>s; a record of a farm he has no scope on is hidden.
/// </summary>
public sealed class RecordVisibility
{
    private readonly Guid readerUserId;
    private readonly IReadOnlyDictionary<Guid, FarmReadScope> scopes;
    private readonly Dictionary<Guid, RestrictedRecord> logs = [];
    private readonly Dictionary<Guid, RestrictedRecord> costs = [];

    private RecordVisibility(
        Guid readerUserId,
        IReadOnlyDictionary<Guid, FarmReadScope> scopes,
        IEnumerable<RestrictedRecord> restricted,
        IEnumerable<RecordPlace>? places = null)
    {
        this.readerUserId = readerUserId;
        this.scopes = scopes;
        foreach (var record in restricted)
        {
            (record.Kind == RecordKinds.DailyLog ? logs : costs)[record.Id] = record;
        }

        Hidden = logs.Values.Concat(costs.Values).Where(r => !MaySee(r)).ToList();
        audienceHiddenLogIds = Hidden.Where(r => r.Kind == RecordKinds.DailyLog).Select(r => r.Id).ToHashSet();
        audienceHiddenCostIds = Hidden.Where(r => r.Kind == RecordKinds.CostEntry).Select(r => r.Id).ToHashSet();

        // spec: plr-d10 lane MU-4 — the place rule (plots, own work), asked only of the farms whose seat it narrows. A record
        // out of his place is hidden from every door exactly like one out of its audience (its id, words, money, photos,
        // AI parse); it is NOT a "record not counted by rule" (W4) — his totals are his plots' / his own (§11.6).
        var placed = (places ?? [])
            .Where(p => RecordPlaceRule.Narrows(scopes.GetValueOrDefault(p.FarmId)))
            .ToList();
        OutOfPlace = placed
            .Where(p => !RecordPlaceRule.MaySee(scopes.GetValueOrDefault(p.FarmId), readerUserId, p))
            .Select(p => p.AsHidden())
            .ToList();
        placeNarrowedFarms = scopes.Values.Where(RecordPlaceRule.Narrows).Select(s => s.FarmId).ToHashSet();
        var outOfPlaceIds = OutOfPlace.Select(r => r.Id).ToHashSet();
        outOfPlaceRecordIds = outOfPlaceIds;
        billPhotosOfSeenMoney = placed
            .Where(p => p.Kind == RecordKinds.CostEntry && !outOfPlaceIds.Contains(p.Id) && !audienceHiddenCostIds.Contains(p.Id))
            .SelectMany(p => p.BillPhotoIds)
            .ToHashSet();

        var everyHidden = Hidden.Concat(OutOfPlace).ToList();
        HiddenLogIds = everyHidden.Where(r => r.Kind == RecordKinds.DailyLog).Select(r => r.Id).ToHashSet();
        HiddenCostIds = everyHidden.Where(r => r.Kind == RecordKinds.CostEntry).Select(r => r.Id).ToHashSet();
        HiddenBillPhotoIds = everyHidden.SelectMany(r => r.BillPhotoIds).ToHashSet();
        unreadableBillFarms = everyHidden.Where(r => r.BillPhotosUnreadable).Select(r => r.FarmId).ToHashSet();
        HiddenAiJobIds = everyHidden.Where(r => r.SourceAiJobId is not null).Select(r => r.SourceAiJobId!.Value).ToHashSet();
        hiddenIdText = everyHidden.Select(r => r.Id.ToString("D")).ToList();
    }

    private readonly HashSet<Guid> audienceHiddenLogIds;
    private readonly HashSet<Guid> audienceHiddenCostIds;

    /// <summary>lane MU-4 — farms whose seat reads by place (plots / own work): their bill photos follow the money he sees.</summary>
    private readonly HashSet<Guid> placeNarrowedFarms;

    /// <summary>lane MU-4 — the bill photos named by money he may see on those farms.</summary>
    private readonly HashSet<Guid> billPhotosOfSeenMoney;

    private readonly List<string> hiddenIdText;

    /// <summary>Farms with a money record kept from him whose bill-photo list cannot be read (fix pass 1, L7).</summary>
    private readonly HashSet<Guid> unreadableBillFarms;

    /// <summary>Nothing restricted, or nothing hidden from him.</summary>
    public static RecordVisibility None(Guid readerUserId) =>
        new(readerUserId, new Dictionary<Guid, FarmReadScope>(), []);

    /// <param name="readerUserId">The reader.</param>
    /// <param name="scopes">His scope on each farm.</param>
    /// <param name="restricted">The farms' records whose audience is not the normal team (PRV).</param>
    /// <param name="places">lane MU-4 — the places of the records of the farms whose seat reads by place
    /// (<see cref="FarmsReadByPlace"/>); <c>null</c> when none does.</param>
    public static RecordVisibility For(
        Guid readerUserId,
        IReadOnlyDictionary<Guid, FarmReadScope> scopes,
        IEnumerable<RestrictedRecord> restricted,
        IEnumerable<RecordPlace>? places = null) =>
        new(readerUserId, scopes, restricted, places);

    /// <summary>
    /// lane MU-4 — the farms among <paramref name="scopes"/> whose records' places must be read: a seat that covers chosen
    /// plots, or an own-records-only seat that sees money (other people's money is then kept from him by place). An
    /// own-records-only seat WITHOUT money (the common कामगार seat) is not asked: every door already reads only his own
    /// records for him (MU-3) and no money reaches him at all, so the farm's places would hide nothing more — and are not
    /// read on his every pull.
    /// </summary>
    public static IReadOnlyList<Guid> FarmsReadByPlace(IReadOnlyDictionary<Guid, FarmReadScope> scopes) =>
        scopes.Values
            .Where(s => RecordPlaceRule.Narrows(s) && (s.PlotIds is not null || s.SeeMoney))
            .Select(s => s.FarmId)
            .Distinct()
            .ToList();

    /// <summary>The reader's view of one farm (a REST door): his scope there and its restricted records.</summary>
    public static async Task<RecordVisibility> ForFarmAsync(
        IShramSafalRepository repository, Guid farmId, Guid readerUserId, DateTime atUtc, CancellationToken ct = default) =>
        await ForFarmsAsync(repository, [farmId], readerUserId, atUtc, ct);

    /// <summary>The reader's view of several farms, his standing read ONCE for all of them.</summary>
    public static async Task<RecordVisibility> ForFarmsAsync(
        IShramSafalRepository repository, IReadOnlyCollection<Guid> farmIds, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var farms = farmIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (farms.Count == 0)
        {
            return None(readerUserId);
        }

        // Nothing narrowed on these farms and no seat of his that may read by place (the common case): nothing is hidden,
        // and his standing is not read again. lane MU-4: the place pre-filter is a superset; the rule decides below.
        var restricted = await repository.GetRestrictedRecordsAsync(farms, ct);
        var maybeByPlace = readerUserId == Guid.Empty ? [] : await repository.GetFarmsMaybeReadByPlaceAsync(readerUserId, farms, ct);
        if (restricted.Count == 0 && maybeByPlace.Count == 0)
        {
            return None(readerUserId);
        }

        var accesses = readerUserId == Guid.Empty
            ? new Dictionary<Guid, FarmAccess?>()
            : await repository.GetFarmAccessesForUserAsync(readerUserId, farms, ct);
        var scopes = new Dictionary<Guid, FarmReadScope>();
        foreach (var farmId in farms)
        {
            if (FarmReadScope.Of(farmId, accesses.GetValueOrDefault(farmId), atUtc) is { } scope)
            {
                scopes[farmId] = scope;
            }
        }

        var placeFarms = FarmsReadByPlace(scopes);
        var places = placeFarms.Count == 0 ? [] : await repository.GetRecordPlacesAsync(placeFarms, ct);
        return new RecordVisibility(readerUserId, scopes, restricted, places);
    }

    /// <summary>Every restricted record hidden from this reader BY ITS AUDIENCE (PRV; the W4 "not counted" set).</summary>
    public IReadOnlyList<RestrictedRecord> Hidden { get; }

    /// <summary>
    /// lane MU-4 — every record hidden from him by the PLACE rule (outside his plots, or someone else's for an own-work
    /// seat). Hidden from every door like <see cref="Hidden"/>, but never counted as "left out by rule": his totals are his.
    /// </summary>
    public IReadOnlyList<RestrictedRecord> OutOfPlace { get; }

    /// <summary>
    /// lane MU-4 fix pass 1 — is this record kept from him by its PLACE (another plot, or not his own money), whatever its
    /// audience? Record ids are unique across both kinds (the kind is kept for the callers' readability).
    /// </summary>
    public bool IsOutOfPlace(string kind, Guid id) => outOfPlaceRecordIds.Contains(id);

    /// <summary>
    /// spec: plr-d10 lane MU-4 fix pass 1 (M2) — has this record LEFT his plots: it is out of his place now, and either he
    /// made it or it once stood on one of his plots (<paramref name="formerPlotIds"/>)? Only then is he owed a word that it
    /// left (the pull's content-free withdrawn list); a move between plots he never covered is never hinted at.
    /// </summary>
    public bool LeftHisPlaces(string kind, Guid id, Guid farmId, Guid makerUserId, IReadOnlyCollection<Guid> formerPlotIds)
    {
        ArgumentNullException.ThrowIfNull(formerPlotIds);
        var scope = scopes.GetValueOrDefault(farmId);
        return IsOutOfPlace(kind, id)
            && RecordPlaceRule.NarrowsByPlot(scope)
            && ((readerUserId != Guid.Empty && makerUserId == readerUserId) || formerPlotIds.Any(scope!.CoversPlot));
    }

    private readonly HashSet<Guid> outOfPlaceRecordIds;

    /// <summary>
    /// lane MU-4 fix pass 1 (M4) — would this day-ledger row reach him by its PLACE alone (audience aside): a seat that
    /// reads the farm's records, his own bill, his plots' share lines, or (own work) a bill of his.
    /// </summary>
    public bool LedgerInPlace(Contracts.Dtos.DayLedgerDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        var scope = scopes.GetValueOrDefault(dto.FarmId);
        if (!RecordPlaceRule.Narrows(scope) || (readerUserId != Guid.Empty && dto.CreatedByUserId == readerUserId))
        {
            return true;
        }

        return scope!.OwnRecordsOnly
            ? !IsOutOfPlace(RecordKinds.CostEntry, dto.SourceCostEntryId)
            : dto.Allocations.Any(a => scope.CoversPlot(a.PlotId));
    }

    /// <summary>lane MU-4 — is this record kept from him by its AUDIENCE (not merely by its place)?</summary>
    public bool HiddenByAudience(string kind, Guid id) =>
        kind == RecordKinds.DailyLog ? audienceHiddenLogIds.Contains(id) : audienceHiddenCostIds.Contains(id);

    /// <summary>lane MU-4 — does his seat on <paramref name="farmId"/> read records by place (plots / own work)?</summary>
    public bool ReadsByPlace(Guid farmId) => placeNarrowedFarms.Contains(farmId);

    /// <summary>
    /// lane MU-4 (§11.6, D-39) — a day-ledger row (a bill's split across plots) as he may receive it: none when its bill is
    /// kept from him by its audience; for a seat that reads by place, only the share lines on HIS plots (never the whole
    /// bill: the bill row itself is not sent when it is not on his plots), none when no share is his. His own bill comes
    /// whole. The same row otherwise.
    /// </summary>
    public Contracts.Dtos.DayLedgerDto? Ledger(Contracts.Dtos.DayLedgerDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        if (audienceHiddenCostIds.Contains(dto.SourceCostEntryId))
        {
            return null;
        }

        var scope = scopes.GetValueOrDefault(dto.FarmId);
        if (!RecordPlaceRule.Narrows(scope) || (readerUserId != Guid.Empty && dto.CreatedByUserId == readerUserId))
        {
            return dto;
        }

        if (scope!.OwnRecordsOnly)
        {
            return MaySeeCost(dto.SourceCostEntryId) ? dto : null;
        }

        var mine = dto.Allocations.Where(a => scope.CoversPlot(a.PlotId)).ToList();
        return mine.Count == 0 ? null : mine.Count == dto.Allocations.Count ? dto : dto with { Allocations = mine };
    }

    public IReadOnlySet<Guid> HiddenLogIds { get; }

    public IReadOnlySet<Guid> HiddenCostIds { get; }

    /// <summary>Bill photos a hidden money record names.</summary>
    public IReadOnlySet<Guid> HiddenBillPhotoIds { get; }

    /// <summary>AI parse jobs a hidden record was made from.</summary>
    public IReadOnlySet<Guid> HiddenAiJobIds { get; }

    /// <summary>Is anything of <paramref name="farmId"/> hidden from him (a total there is incomplete: W4)?</summary>
    public bool AnyHiddenOn(Guid farmId) => Hidden.Any(r => r.FarmId == farmId);

    public bool MaySee(RestrictedRecord record) =>
        RecordAudienceRule.MaySee(scopes.GetValueOrDefault(record.FarmId), readerUserId, record.Audience, record.MakerUserId, record.SelectedUserIds);

    public bool MaySeeLog(Guid dailyLogId) => !HiddenLogIds.Contains(dailyLogId);

    public bool MaySeeCost(Guid costEntryId) => !HiddenCostIds.Contains(costEntryId);

    /// <summary>A photo follows its parent: a hidden record's photo, or a bill photo a hidden money record names, is hidden.</summary>
    public bool MaySeeAttachment(Attachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);

        // Fix pass 2 (N2) — a bill photo HE took is never kept from him by a money record's rule (named, or the fail-closed
        // one below): he holds what it shows, and nothing on the photo names the money. At its upload and at every read.
        var tookIt = readerUserId != Guid.Empty && attachment.CreatedByUserId.Value == readerUserId;
        if (!tookIt && HiddenBillPhotoIds.Contains(attachment.Id))
        {
            return false;
        }

        // Fix pass 1 (L7) — fail closed: which bills a hidden money record named cannot be read, so no bill of its farm.
        if (!tookIt
            && attachment.LinkedEntityType is AttachmentParentRule.BillParent or AttachmentParentRule.FarmParent
            && unreadableBillFarms.Contains((Guid)attachment.FarmId))
        {
            return false;
        }

        // lane MU-4 — on a farm he reads by place, a bill photo goes only with money he may see (or he took it): a bill no
        // money of his names is another plot's or the farm's shared bill (fail closed, never guessed from a file name).
        if (!tookIt
            && attachment.LinkedEntityType is AttachmentParentRule.BillParent or AttachmentParentRule.FarmParent
            && placeNarrowedFarms.Contains((Guid)attachment.FarmId)
            && !billPhotosOfSeenMoney.Contains(attachment.Id))
        {
            return false;
        }

        return attachment.LinkedEntityType switch
        {
            AttachmentParentRule.RecordParent => MaySeeLog(attachment.LinkedEntityId),
            AttachmentParentRule.MoneyParent => MaySeeCost(attachment.LinkedEntityId),
            _ => true,
        };
    }

    /// <summary>
    /// Does this text (an audit payload, a warning's evidence) name a record hidden from him? Then it is not his to
    /// read, whatever else it says (founder: nobody outside the audience finds its id anywhere).
    /// </summary>
    public bool MentionsHidden(string? text) =>
        !string.IsNullOrEmpty(text) && hiddenIdText.Any(id => text.Contains(id, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// A job card (planned work: not narrowed in this release) that LINKS to a record kept from him loses the link — the
    /// card's own work stays, but it never names the record (founder: its id is found nowhere). Same instance when not.
    /// </summary>
    public Contracts.Dtos.JobCardDto WithoutHiddenLinks(Contracts.Dtos.JobCardDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        var hidesLog = dto.LinkedDailyLogId is { } logId && HiddenLogIds.Contains(logId);
        var hidesMoney = dto.PayoutCostEntryId is { } costId && HiddenCostIds.Contains(costId);
        return hidesLog || hidesMoney
            ? dto with
            {
                LinkedDailyLogId = hidesLog ? null : dto.LinkedDailyLogId,
                PayoutCostEntryId = hidesMoney ? null : dto.PayoutCostEntryId,
            }
            : dto;
    }

    /// <summary>The restricted record (of either kind) with this id, when there is one.</summary>
    public RestrictedRecord? Restricted(string kind, Guid id) =>
        (kind == RecordKinds.DailyLog ? logs : costs).GetValueOrDefault(id);
}

/// <summary>
/// lane PRV — the single-record question a door asks before it hands out ONE record (its voice, its trail, its parse,
/// a change to it): may this reader see it? A record of the normal team is answered without a read.
/// </summary>
public static class RecordAudienceGate
{
    public static async Task<bool> MaySeeAsync(
        IShramSafalRepository repository,
        string kind,
        Guid recordId,
        Guid farmId,
        RecordAudience audience,
        Guid makerUserId,
        Guid readerUserId,
        DateTime atUtc,
        CancellationToken ct = default,
        RecordPlace? place = null)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (audience == RecordAudience.Team
            && (place is null || readerUserId == Guid.Empty
                || (await repository.GetFarmsMaybeReadByPlaceAsync(readerUserId, [farmId], ct)).Count == 0))
        {
            return true;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, readerUserId, atUtc, ct);

        // spec: plr-d10 lane MU-4 — and its PLACE: a chosen-plots seat sees one record only on his plots (or his own).
        if (place is not null && RecordPlaceRule.NarrowsByPlot(scope) && !RecordPlaceRule.MaySee(scope, readerUserId, place))
        {
            return false;
        }

        if (audience == RecordAudience.Team)
        {
            return true;
        }

        IReadOnlyCollection<Guid> chosen = audience == RecordAudience.Selected
            ? await repository.GetRecordAudienceUserIdsAsync(kind, recordId, ct)
            : [];
        return RecordAudienceRule.MaySee(scope, readerUserId, audience, makerUserId, chosen);
    }

    public static Task<bool> MaySeeLogAsync(
        IShramSafalRepository repository, DailyLog log, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(log);
        return MaySeeAsync(repository, RecordKinds.DailyLog, log.Id, (Guid)log.FarmId, log.Audience, log.OperatorUserId.Value,
            readerUserId, atUtc, ct,
            RecordPlace.OfLog(log.Id, (Guid)log.FarmId, log.OperatorUserId.Value, log.LogDate, log.CreatedAtUtc, log.Scope,
                log.PlotId, log.PlotIds, log.SourceAiJobId));
    }

    public static Task<bool> MaySeeCostAsync(
        IShramSafalRepository repository, CostEntry entry, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return MaySeeAsync(repository, RecordKinds.CostEntry, entry.Id, (Guid)entry.FarmId, entry.Audience, entry.CreatedByUserId.Value,
            readerUserId, atUtc, ct,
            RecordPlace.OfCost(entry.Id, (Guid)entry.FarmId, entry.CreatedByUserId.Value, entry.EntryDate, entry.CreatedAtUtc,
                entry.PlotId, entry.SourceAiJobId, entry.ClientAttachmentIdsJson));
    }
}

/// <summary>
/// lane PRV (my call) — money a work record's own line made (<see cref="Domain.Finance.MoneyEntryIdentity"/>) follows the
/// record's audience: when the record is narrowed its money is too (<c>SetRecordAudienceHandler</c>), and money that
/// arrives LATER (a phone that was offline sends a record's first money after the holder narrowed the record) is born
/// with the record's audience. Only narrowed records of the same farm and day are asked (rare), never the farm.
/// </summary>
public static class RecordMoneyAudience
{
    /// <summary>
    /// Sets <paramref name="entry"/>'s audience from the narrowed record whose line made it, and returns the people chosen
    /// for that record (empty when none, or when no narrowed record made it).
    /// </summary>
    public static async Task<IReadOnlyList<Guid>> InheritAsync(
        IShramSafalRepository repository, CostEntry entry, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(entry);
        var candidates = (await repository.GetRestrictedRecordsAsync([(Guid)entry.FarmId], ct))
            .Where(r => r.Kind == RecordKinds.DailyLog && r.Date == entry.EntryDate)
            .ToList();
        foreach (var record in candidates)
        {
            if (await repository.GetDailyLogByIdAsync(record.Id, ct) is not { } log || log.FarmId != entry.FarmId)
            {
                continue;
            }

            var lines = await RecordFirstMoney.OfAsync(
                repository, log, Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance, ct);
            if (lines.Known.ContainsKey(entry.Id))
            {
                entry.SetAudience(log.Audience, atUtc);
                return log.Audience == RecordAudience.Selected ? [.. record.SelectedUserIds] : [];
            }
        }

        return [];
    }
}
