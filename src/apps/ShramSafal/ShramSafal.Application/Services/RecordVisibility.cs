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

    private RecordVisibility(Guid readerUserId, IReadOnlyDictionary<Guid, FarmReadScope> scopes, IEnumerable<RestrictedRecord> restricted)
    {
        this.readerUserId = readerUserId;
        this.scopes = scopes;
        foreach (var record in restricted)
        {
            (record.Kind == RecordKinds.DailyLog ? logs : costs)[record.Id] = record;
        }

        Hidden = logs.Values.Concat(costs.Values).Where(r => !MaySee(r)).ToList();
        HiddenLogIds = Hidden.Where(r => r.Kind == RecordKinds.DailyLog).Select(r => r.Id).ToHashSet();
        HiddenCostIds = Hidden.Where(r => r.Kind == RecordKinds.CostEntry).Select(r => r.Id).ToHashSet();
        HiddenBillPhotoIds = Hidden.SelectMany(r => r.BillPhotoIds).ToHashSet();
        unreadableBillFarms = Hidden.Where(r => r.BillPhotosUnreadable).Select(r => r.FarmId).ToHashSet();
        HiddenAiJobIds = Hidden.Where(r => r.SourceAiJobId is not null).Select(r => r.SourceAiJobId!.Value).ToHashSet();
        hiddenIdText = Hidden.Select(r => r.Id.ToString("D")).ToList();
    }

    private readonly List<string> hiddenIdText;

    /// <summary>Farms with a money record kept from him whose bill-photo list cannot be read (fix pass 1, L7).</summary>
    private readonly HashSet<Guid> unreadableBillFarms;

    /// <summary>Nothing restricted, or nothing hidden from him.</summary>
    public static RecordVisibility None(Guid readerUserId) =>
        new(readerUserId, new Dictionary<Guid, FarmReadScope>(), []);

    public static RecordVisibility For(
        Guid readerUserId, IReadOnlyDictionary<Guid, FarmReadScope> scopes, IEnumerable<RestrictedRecord> restricted) =>
        new(readerUserId, scopes, restricted);

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

        // Nothing narrowed on these farms (the common case): nothing is hidden, and his standing is not read again.
        var restricted = await repository.GetRestrictedRecordsAsync(farms, ct);
        if (restricted.Count == 0)
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

        return new RecordVisibility(readerUserId, scopes, restricted);
    }

    /// <summary>Every restricted record hidden from this reader.</summary>
    public IReadOnlyList<RestrictedRecord> Hidden { get; }

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
        if (HiddenBillPhotoIds.Contains(attachment.Id))
        {
            return false;
        }

        // Fix pass 1 (L7) — fail closed: which bills a hidden money record named cannot be read, so no bill of its farm.
        if (attachment.LinkedEntityType is AttachmentParentRule.BillParent or AttachmentParentRule.FarmParent
            && unreadableBillFarms.Contains((Guid)attachment.FarmId))
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
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (audience == RecordAudience.Team)
        {
            return true;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, readerUserId, atUtc, ct);
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
            readerUserId, atUtc, ct);
    }

    public static Task<bool> MaySeeCostAsync(
        IShramSafalRepository repository, CostEntry entry, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return MaySeeAsync(repository, RecordKinds.CostEntry, entry.Id, (Guid)entry.FarmId, entry.Audience, entry.CreatedByUserId.Value,
            readerUserId, atUtc, ct);
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
