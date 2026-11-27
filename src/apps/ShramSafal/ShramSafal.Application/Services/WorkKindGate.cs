using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract §2.6; founder 27 Nov "kinds of work he may record"; CTO rulings Q2, Q3 = A,
/// late arrival S1.7) — the ONE write-side question "may this person record these kinds of work on this farm?", asked INSIDE every door that records
/// work (create_daily_log, revise_log_content, add_log_task, add_cost_entry; REST and sync alike), shaped like <see cref="PlotScopeGate"/>.
/// <list type="bullet">
/// <item><b>Cheap for every seat today:</b> a seat with no limit (<c>FarmAccess.WorkKinds</c> null), the farm's registrant and the primary owner's
/// label are answered at once; nothing else is read.</item>
/// <item><b>The refusal</b> is <see cref="ShramSafalErrors.WorkKindForbidden"/> — its code ends in ".Forbidden", so every phone (the released one too)
/// parks it visibly, the sync layer keeps the work whole for the owner, and a REST door answers 403 with its words. Asked before anything is staged
/// (P1). The record is refused whole, never trimmed: the new phone takes the closed parts out itself before it sends (Q3 = A, a later phone slice).</item>
/// <item><b>Work done offline before the owner narrowed his kinds</b> (follow-up 1: it is an old record) is ACCEPTED and flagged for the owner
/// (<see cref="LateAuthorityAudit.AcceptedAfterEnd"/>, authority <see cref="LateAuthority"/>) when every refused kind was allowed by the set before the
/// newest change, the work's own time (the phone's <c>capturedAtUtc</c>) lies before that change and at most
/// <see cref="LateArrivalWindow.DoneWithinDaysBeforeEnd"/> days before it, and it reaches the server at most
/// <see cref="LateArrivalWindow.ReceivedWithinDaysAfterEnd"/> days after it. With no readable time there is no window.</item>
/// <item>Observations and reminders are never limited (<see cref="WorkKinds.AlwaysOpen"/>).</item>
/// </list>
/// </summary>
public static class WorkKindGate
{
    /// <summary>The audit action of a real change of a seat's kinds (<c>ManageMembershipHandler</c>).</summary>
    public const string ChangedAction = "MemberWorkKindsChanged";

    /// <summary>The "authority" a late-arrival flag names (the phone words it on the owner's kept-work card).</summary>
    public const string LateAuthority = "WorkKinds";

    /// <summary>The standing of a LIMITED seat on this farm; <c>null</c> when he may record every kind (the cheap answer for every seat today).</summary>
    public static async Task<FarmAccess?> LimitedAccessAsync(IShramSafalRepository repository, Guid farmId, Guid userId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        // The cheap pre-filter first (one bounded read; a test double answers "no limit"): only a seat that carries a limit has its standing read.
        if (farmId == Guid.Empty || userId == Guid.Empty || !await repository.HasWorkKindLimitAsync(farmId, userId, ct))
        {
            return null;
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        return access is { IsRegistrant: false, WorkKinds: not null } && access.Role != AppRole.PrimaryOwner ? access : null;
    }

    /// <summary>The whole decision for <paramref name="kinds"/>. <paramref name="happenedAtUtc"/>: when the phone says the work was done (null = no late window).</summary>
    public static async Task<WorkKindDecision> DecideAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        IReadOnlyCollection<string> kinds,
        DateTime nowUtc,
        DateTime? happenedAtUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(kinds);
        var access = await LimitedAccessAsync(repository, farmId, userId, ct);
        return access is null
            ? WorkKindDecision.Allowed
            : await DecideForAsync(repository, farmId, userId, access, kinds, nowUtc, happenedAtUtc, ct);
    }

    /// <summary>The decision for a seat already known to be limited (<see cref="LimitedAccessAsync"/>).</summary>
    public static async Task<WorkKindDecision> DecideForAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        FarmAccess access,
        IReadOnlyCollection<string> kinds,
        DateTime nowUtc,
        DateTime? happenedAtUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(access);
        ArgumentNullException.ThrowIfNull(kinds);
        var closedNow = WorkKinds.Closed(access.WorkKinds, WorkKinds.All).ToHashSet(StringComparer.Ordinal);
        var refused = WorkKinds.Closed(access.WorkKinds, kinds);
        if (refused.Count == 0)
        {
            return new WorkKindDecision(null, closedNow, false, null, null, []);
        }

        if (happenedAtUtc is { } stated && access.WorkKindsChangedAtUtc is { } changedAt)
        {
            // The phone's statement is trusted only up to the server's own now.
            var happened = ToUtc(stated) > nowUtc ? nowUtc : ToUtc(stated);
            var changed = ToUtc(changedAt);
            var inWindow = happened < changed
                && happened >= changed.AddDays(-LateArrivalWindow.DoneWithinDaysBeforeEnd)
                && nowUtc <= changed.AddDays(LateArrivalWindow.ReceivedWithinDaysAfterEnd);
            if (inWindow && await SetBeforeNewestChangeAsync(repository, farmId, userId, ct) is { Known: true } before
                && WorkKinds.Closed(before.Kinds, kinds).Count == 0)
            {
                var closedThen = WorkKinds.Closed(before.Kinds, WorkKinds.All).ToHashSet(StringComparer.Ordinal);
                return new WorkKindDecision(null, closedThen, true, changed, happened, refused);
            }
        }

        return new WorkKindDecision(ShramSafalErrors.WorkKindForbidden, closedNow, false, null, null, refused);
    }

    /// <summary>
    /// The kinds a create carries: each non-empty bucket of its content, its structured labour, each non-empty bucket of an older phone's manual draft;
    /// with neither content nor draft (an older phone's voice confirm) the non-empty buckets of the linked parse. The हजेरी door records labour only
    /// (B002), so it carries labour. An unreadable document carries nothing here (its own check refused it already).
    /// </summary>
    public static IReadOnlySet<string> KindsOfCreate(CreateDailyLogCommand command, string? sourceJobNormalizedJson)
    {
        ArgumentNullException.ThrowIfNull(command);
        var kinds = new HashSet<string>(StringComparer.Ordinal);
        if (command.CaptureScope == DailyLogCaptureScope.Labour)
        {
            kinds.Add(WorkKinds.Labour);
            return kinds;
        }

        if (command.Labour is { Count: > 0 })
        {
            kinds.Add(WorkKinds.Labour);
        }

        var stated = false;
        if (!string.IsNullOrWhiteSpace(command.ContentJson))
        {
            stated = true;
            AddNonEmptyBuckets(command.ContentJson, kinds);
        }

        if (command.ManualDraft is { } draft)
        {
            stated = true;
            AddIf(kinds, WorkKinds.Labour, draft.Labour);
            AddIf(kinds, WorkKinds.CropActivities, draft.CropActivities);
            AddIf(kinds, WorkKinds.Irrigation, draft.Irrigation);
            AddIf(kinds, WorkKinds.Inputs, draft.Inputs);
            AddIf(kinds, WorkKinds.Machinery, draft.Machinery);
            AddIf(kinds, WorkKinds.ActivityExpenses, draft.ActivityExpenses);
        }

        if (!stated && !string.IsNullOrWhiteSpace(sourceJobNormalizedJson))
        {
            AddNonEmptyBuckets(sourceJobNormalizedJson, kinds);
        }

        return kinds;
    }

    /// <summary>
    /// The kinds a revision ADDS: a bucket with an item whose id the stored current version does not hold in that bucket. Editing or removing an
    /// item an old record already holds stays allowed (follow-up 1: old records keep what they hold).
    /// </summary>
    public static IReadOnlySet<string> NewItemKinds(string? currentDocumentJson, string incomingDocumentJson)
    {
        var kinds = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(incomingDocumentJson))
        {
            return kinds;
        }

        try
        {
            using var incoming = JsonDocument.Parse(incomingDocumentJson);
            using var current = string.IsNullOrWhiteSpace(currentDocumentJson) ? null : JsonDocument.Parse(currentDocumentJson);
            foreach (var kind in WorkKinds.All)
            {
                if (incoming.RootElement.ValueKind != JsonValueKind.Object
                    || !incoming.RootElement.TryGetProperty(kind, out var items) || items.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var held = ItemIds(current?.RootElement, kind);
                if (items.EnumerateArray().Any(item => ItemId(item) is not { } id || !held.Contains(id)))
                {
                    kinds.Add(kind);
                }
            }
        }
        catch (JsonException)
        {
            // An unreadable document is refused by its own check before it is stored; it states no kind here (the trace says so).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("work_kinds.revision_unreadable"));
        }

        return kinds;
    }

    /// <summary>
    /// The kind of an older phone's task line (<c>add_log_task</c>), read from its words by <see cref="WorkRecogniser"/>: पाणी → irrigation, फवारणी /
    /// खत → inputs, any other work or words not recognised → crop work. An observation or a reminder is always open (no kind).
    /// </summary>
    public static IReadOnlySet<string> KindsOfTaskLine(string? activityType)
    {
        var words = activityType?.Trim();
        if (string.IsNullOrEmpty(words)
            || words.Equals("observation", StringComparison.OrdinalIgnoreCase)
            || words.Equals("reminder", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<string>();
        }

        var part = WorkRecogniser.Recognise(words)?.Part;
        return new HashSet<string>(StringComparer.Ordinal)
        {
            part switch
            {
                WorkPart.Irrigation => WorkKinds.Irrigation,
                WorkPart.Spray or WorkPart.Nutrition => WorkKinds.Inputs,
                _ => WorkKinds.CropActivities,
            },
        };
    }

    /// <summary>
    /// The kind of one money entry: the kind of the record line that made it (a money id of one of the SENDER's own records of that farm and day,
    /// <see cref="RecordFirstMoney"/>), otherwise a खर्च (a bill or a purchase).
    /// </summary>
    public static async Task<string> KindOfMoneyAsync(
        IShramSafalRepository repository, Guid farmId, Guid senderUserId, Guid? costEntryId, DateOnly entryDate, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (costEntryId is { } id && id != Guid.Empty)
        {
            foreach (var log in (await repository.GetDailyLogsForFarmDateAsync(farmId, entryDate, ct))
                         .Where(l => (Guid)l.FarmId == farmId && l.OperatorUserId.Value == senderUserId))
            {
                var lines = await RecordFirstMoney.OfAsync(repository, log, NullLogger.Instance, ct);
                if (lines.Known.TryGetValue(id, out var line))
                {
                    return line.Kind switch
                    {
                        MoneyEntryIdentity.Labour => WorkKinds.Labour,
                        MoneyEntryIdentity.Input => WorkKinds.Inputs,
                        MoneyEntryIdentity.Machinery => WorkKinds.Machinery,
                        _ => WorkKinds.ActivityExpenses,
                    };
                }
            }
        }

        return WorkKinds.ActivityExpenses;
    }

    /// <summary>
    /// The owner's flag for work accepted after his narrowing (one audit row on the record it wrote). Nothing for an ordinary decision. It is listed on
    /// the owner's kept-work card (kind <c>arrived_late</c>, why <see cref="LateAuthority"/>).
    /// </summary>
    public static async Task FlagIfLateAsync(
        IShramSafalRepository repository,
        WorkKindDecision decision,
        string entityType,
        Guid entityId,
        Guid farmId,
        Guid actorUserId,
        string? actorRole,
        DateTime receivedAtUtc,
        string? clientCommandId,
        string? appVersion,
        string? deviceId,
        string? ipHash,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(decision);
        if (!decision.AcceptedLate)
        {
            return;
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: entityType,
                entityId: entityId,
                action: LateAuthorityAudit.AcceptedAfterEnd,
                actorUserId: actorUserId,
                actorRole: string.IsNullOrWhiteSpace(actorRole) ? "unknown" : actorRole,
                payload: new
                {
                    recordId = entityId,
                    authority = LateAuthority,
                    kinds = decision.RefusedKinds,
                    happenedAtUtc = decision.HappenedAtUtc,
                    authorityEndedAtUtc = decision.ChangedAtUtc,
                    receivedAtUtc,
                },
                farmId: farmId,
                clientCommandId: clientCommandId,
                appVersion: string.IsNullOrWhiteSpace(appVersion) || appVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : appVersion,
                deviceId: string.IsNullOrWhiteSpace(deviceId) ? "unknown" : deviceId,
                ipHash: string.IsNullOrWhiteSpace(ipHash) ? "sha256:unknown" : ipHash,
                sourceAiJobId: null),
            ct);
    }

    /// <summary>The set before the newest change of this person's kinds (the newest <see cref="ChangedAction"/> row's "from"); not known without one.</summary>
    private static async Task<(bool Known, IReadOnlyCollection<string>? Kinds)> SetBeforeNewestChangeAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, CancellationToken ct)
    {
        var seat = (await repository.GetFarmMembershipHistoryAsync(farmId, userId, ct))
            .LastOrDefault(m => (Guid)m.FarmId == farmId && !m.IsTerminal);
        if (seat is null)
        {
            return (false, null);
        }

        var newest = (await repository.GetAuditEventsForEntityAsync(seat.Id, "FarmMembership", ct))
            .Where(a => a.Action == ChangedAction && a.FarmId == farmId)
            .OrderByDescending(a => a.OccurredAtUtc)
            .FirstOrDefault();
        if (newest is null)
        {
            return (false, null);
        }

        try
        {
            using var payload = JsonDocument.Parse(newest.Payload);
            if (!payload.RootElement.TryGetProperty("workKindsBefore", out var before))
            {
                return (false, null);
            }

            return before.ValueKind switch
            {
                JsonValueKind.Null => (true, null),
                JsonValueKind.Array => (true, before.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).ToList()),
                _ => (false, null),
            };
        }
        catch (JsonException)
        {
            // An unreadable history row gives no window (refused and kept, never guessed open).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("work_kinds.history_unreadable"));
            return (false, null);
        }
    }

    private static void AddIf(HashSet<string> kinds, string kind, IReadOnlyList<object>? rows)
    {
        if (rows is { Count: > 0 })
        {
            kinds.Add(kind);
        }
    }

    private static void AddNonEmptyBuckets(string json, HashSet<string> kinds)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            foreach (var kind in WorkKinds.All)
            {
                if (document.RootElement.TryGetProperty(kind, out var items)
                    && items.ValueKind == JsonValueKind.Array && items.GetArrayLength() > 0)
                {
                    kinds.Add(kind);
                }
            }
        }
        catch (JsonException)
        {
            // A parse that is not JSON states no kind (the content check refuses a bad document before this; a bad stored parse derives nothing).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("work_kinds.document_unreadable"));
        }
    }

    private static HashSet<string> ItemIds(JsonElement? document, string bucket)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        if (document is { ValueKind: JsonValueKind.Object } root
            && root.TryGetProperty(bucket, out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                if (ItemId(item) is { } id)
                {
                    ids.Add(id);
                }
            }
        }

        return ids;
    }

    private static string? ItemId(JsonElement item) =>
        item.ValueKind == JsonValueKind.Object && item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
            ? id.GetString()
            : null;

    private static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}

/// <summary>
/// pilot lane PERM — what <see cref="WorkKindGate"/> answered. <see cref="Refusal"/>: null = allowed. <see cref="ClosedKinds"/>: the kinds this seat may
/// not record (empty for every unlimited seat) — the side-car derivation of a voice parse leaves them underived, so a part the phone took out of his
/// record never comes back through the parse. <see cref="AcceptedLate"/>: accepted inside the late window, to be flagged for the owner.
/// </summary>
public sealed record WorkKindDecision(
    Error? Refusal,
    IReadOnlySet<string> ClosedKinds,
    bool AcceptedLate,
    DateTime? ChangedAtUtc,
    DateTime? HappenedAtUtc,
    IReadOnlyList<string> RefusedKinds)
{
    public static readonly WorkKindDecision Allowed = new(null, new HashSet<string>(), false, null, null, []);
}
