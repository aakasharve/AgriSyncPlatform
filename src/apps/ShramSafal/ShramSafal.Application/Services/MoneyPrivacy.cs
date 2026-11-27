using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract §2.4; founder 27 Nov follow-ups 1 and 2) — the farm's "पैशांच्या
/// नोंदी फक्त मला दिसू दे" applied to a NEW record the moment it ARRIVES at the server, in the same save as the record (P1), never by a later change of
/// the switch (follow-up 1: old records keep the audience they had).
/// <list type="bullet">
/// <item><b>A money record</b> (a bill, a खर्च, a work record's line money, money an edit makes) is born <see cref="RecordAudience.OnlyMe"/>: the
/// registrant and its maker see it (<see cref="RecordAudienceRule"/>). Its <c>AudienceChanged</c> trail row is written as the holder's OWN choice
/// (<c>followedRecordId</c> null), so a later widening of its work record can never carry it to the team (the money trail of
/// <c>SetRecordAudienceHandler</c>). A job card's payout is not covered: it follows its job card (founder ruling Q5 = A).</item>
/// <item><b>A work record</b> keeps its work for its readers and its MONEY for the registrant and its maker (<see cref="DailyLog.MoneyAudience"/>),
/// served to everyone else exactly as to a seat without "पैसे पाहणे" (<see cref="ReadScopeProjection.Record"/>).</item>
/// </list>
/// </summary>
public static class MoneyPrivacy
{
    /// <summary>Why a money record was born private (P8): recorded on its <c>Created</c> and trail rows.</summary>
    public const string BornPrivateBy = "farm_money_private";

    /// <summary>A job card's payout follows its job card and is never narrowed here (Q5 = A).</summary>
    public static bool Covers(CostEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return entry.JobCardId is null && !string.Equals(entry.CategoryId, "labour_payout", StringComparison.Ordinal);
    }

    /// <summary>
    /// Stamps a NEW money entry OnlyMe when <paramref name="farm"/>'s switch is on (or the work record its line belongs to was made private), and
    /// stages its trail row. Returns true when it stamped. <paramref name="inheritedPeople"/>: the people an earlier rule chose for it (a narrowed
    /// record's line money follows its record) — the trail says from what it narrowed.
    /// </summary>
    public static async Task<bool> StampBornPrivateAsync(
        IShramSafalRepository repository,
        Farm farm,
        CostEntry entry,
        bool recordMoneyPrivate,
        IReadOnlyCollection<Guid> inheritedPeople,
        BornPrivateStamp stamp,
        DateTime nowUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(farm);
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(stamp);
        // Already OnlyMe because it followed a record the holder narrowed: it is stamped again as HIS own choice, so a later widening of that record
        // does not bring it back to the team either.
        if (!(farm.MoneyPrivateToHolder || recordMoneyPrivate) || !Covers(entry))
        {
            return false;
        }

        var from = entry.Audience;
        entry.SetAudience(RecordAudience.OnlyMe, nowUtc);
        await AddTrailAsync(repository, entry, from, inheritedPeople, stamp, ct);
        return true;
    }

    /// <summary>
    /// The trail row of a money entry born private (the holder's OWN choice): for a caller that sets the audience itself and may only write the row
    /// once the entry is known to be added (an edit's money, whose id may be held elsewhere).
    /// </summary>
    public static Task AddTrailAsync(
        IShramSafalRepository repository, CostEntry entry, RecordAudience from, IReadOnlyCollection<Guid> inheritedPeople, BornPrivateStamp stamp,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(stamp);
        return repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: RecordKinds.CostEntry,
                entityId: entry.Id,
                action: UseCases.RecordPrivacy.SetRecordAudience.SetRecordAudienceHandler.ChangedAction,
                actorUserId: stamp.ActorUserId,
                actorRole: string.IsNullOrWhiteSpace(stamp.ActorRole) ? "unknown" : stamp.ActorRole,
                payload: new
                {
                    recordKind = RecordKinds.CostEntry,
                    recordId = entry.Id,
                    from = from.ToString(),
                    to = nameof(RecordAudience.OnlyMe),
                    fromPeople = inheritedPeople.Order().ToList(),
                    toPeople = new List<Guid>(),
                    // The holder's OWN choice (his switch), never a follow of a record: a later widening of a record never widens it.
                    followedRecordId = (Guid?)null,
                    stampedAtUtc = entry.AudienceChangedAtUtc,
                    phoneChangedAtUtc = (DateTime?)null,
                    audienceBy = BornPrivateBy,
                },
                farmId: (Guid)entry.FarmId,
                clientCommandId: stamp.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(stamp.AppVersion) || stamp.AppVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : stamp.AppVersion,
                deviceId: string.IsNullOrWhiteSpace(stamp.DeviceId) ? "unknown" : stamp.DeviceId,
                ipHash: string.IsNullOrWhiteSpace(stamp.IpHash) ? "sha256:unknown" : stamp.IpHash),
            ct);
    }

    /// <summary>
    /// Is <paramref name="entry"/> the money of a line of a work record whose money was made private (same farm and day; E4)? Only records stamped
    /// private are asked (one indexed read of their ids): its line money stays private even when it arrives after the switch was turned off.
    /// </summary>
    public static async Task<bool> IsLineMoneyOfPrivateRecordAsync(IShramSafalRepository repository, CostEntry entry, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(entry);
        foreach (var logId in await repository.GetMoneyPrivateLogIdsForFarmDateAsync((Guid)entry.FarmId, entry.EntryDate, ct))
        {
            if (await repository.GetDailyLogByIdAsync(logId, ct) is not { } log || log.FarmId != entry.FarmId || !log.MoneyIsPrivate)
            {
                continue;
            }

            var lines = await RecordFirstMoney.OfAsync(repository, log, Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance, ct);
            if (lines.Known.ContainsKey(entry.Id))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Is a work record's MONEY kept from this reader by its own stamp? Never from its maker or the farm's registrant (the record holder); from
    /// everyone else while it is stamped OnlyMe. A reader with no scope reads no money anyway (fail closed elsewhere).
    /// </summary>
    public static bool HidesMoneyFrom(RecordAudience? moneyAudience, Guid makerUserId, FarmReadScope? scope, Guid readerUserId) =>
        moneyAudience == RecordAudience.OnlyMe
        && !(readerUserId != Guid.Empty && readerUserId == makerUserId)
        && scope?.IsRecordHolder != true;
}

/// <summary>pilot lane PERM — who stamped a born-private money record, for its trail row (the same request's identity as its Created row).</summary>
public sealed record BornPrivateStamp(
    Guid ActorUserId,
    string? ActorRole,
    string? ClientCommandId,
    string? AppVersion,
    string? DeviceId,
    string? IpHash);
