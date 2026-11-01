using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane PRV fix pass 2 (D-69, CTO call in PENDING-DECISIONS) — a reader who may see a work record but not
/// its money. A record states the prices of its own lines (its crews' totals and wages, its inputs', machines' and
/// expenses' amounts, and the "₹" parts of its task lines); when a money entry made from one of those lines
/// (<see cref="MoneyEntryIdentity.ForRecordLine"/>) is kept from him, THAT record is served to him exactly as to a seat
/// without "पैसे पाहणे" (D-66 / D-67, <see cref="ReadScopeProjection"/>): every amount withheld, its words, voice and
/// free-text notes withheld when it mentions money, the work itself (what, where, which day, how many people) shown, with
/// the same ShramSafal-rule wording. One rule, asked by the pull and by every read that serves a record's content.
/// </summary>
public static class RecordMoneyAccess
{
    /// <summary>The ids of the money the record's lines can have made, from what the record states now.</summary>
    public static IReadOnlySet<Guid> LineMoneyIdsOf(DailyLogDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        var ids = new HashSet<Guid>();
        foreach (var crew in dto.Labour ?? [])
        {
            ids.Add(MoneyEntryIdentity.ForRecordLine(dto.Id, MoneyEntryIdentity.Labour, crew.LabourAssignmentId.ToString("D")));
        }

        if (dto.Content is { } content)
        {
            foreach (var line in RecordMoneyLines.Of(dto.Id, content.Document))
            {
                ids.Add(MoneyEntryIdentity.ForRecordLine(dto.Id, line.Kind, line.LineId));
            }
        }

        return ids;
    }

    /// <summary>Is money made from one of this record's lines kept from the reader of <paramref name="visibility"/>?</summary>
    public static bool MoneyHidden(DailyLogDto dto, RecordVisibility visibility)
    {
        ArgumentNullException.ThrowIfNull(visibility);
        return visibility.HiddenCostIds.Count > 0 && LineMoneyIdsOf(dto).Overlaps(visibility.HiddenCostIds);
    }

    /// <summary>The scope this record is projected with: his own, or — when its money is kept from him — without money.</summary>
    public static FarmReadScope? ScopeFor(DailyLogDto dto, FarmReadScope? scope, RecordVisibility visibility) =>
        scope is { SeeMoney: true } && MoneyHidden(dto, visibility) ? WithoutMoney(scope) : scope;

    /// <summary>
    /// Fix pass 3 (item 8) — the scope for a COMMAND ANSWER (verify, add a task, move, revise): its DTO carries neither the
    /// record's crews nor its document, so the record's own money is asked of the record as stored (every version).
    /// </summary>
    public static async Task<FarmReadScope?> ScopeForStoredAsync(
        IShramSafalRepository repository, DailyLog log, FarmReadScope? scope, Guid readerUserId, DateTime atUtc, CancellationToken ct = default) =>
        scope is { SeeMoney: true } && await MoneyHiddenFromAsync(repository, log, readerUserId, atUtc, ct) ? WithoutMoney(scope) : scope;

    /// <summary>A seat without "पैसे पाहणे" (and so without wages, which need it).</summary>
    public static FarmReadScope WithoutMoney(FarmReadScope scope)
    {
        ArgumentNullException.ThrowIfNull(scope);
        return scope with { SeeMoney = false, SeeWages = false };
    }

    /// <summary>
    /// The same question for a record read on its own (its original voice, its parse, an edit): every money its lines can
    /// have made in any stored version (<see cref="RecordFirstMoney"/>). Nothing restricted on the farm: no further read.
    /// </summary>
    public static async Task<bool> MoneyHiddenFromAsync(
        IShramSafalRepository repository, DailyLog log, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        var visibility = await RecordVisibility.ForFarmAsync(repository, (Guid)log.FarmId, readerUserId, atUtc, ct);
        return await MoneyHiddenAsync(repository, log, visibility, ct);
    }

    /// <summary>Of <paramref name="logs"/> (records he may see), those whose money is kept from the reader.</summary>
    public static async Task<IReadOnlySet<Guid>> LogsWithHiddenMoneyAsync(
        IShramSafalRepository repository, IEnumerable<DailyLog> logs, RecordVisibility visibility, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(logs);
        ArgumentNullException.ThrowIfNull(visibility);
        var result = new HashSet<Guid>();
        if (visibility.HiddenCostIds.Count == 0)
        {
            return result;
        }

        // A line's money carries the record's day: only records of a day with hidden money are asked.
        var hiddenMoneyDays = visibility.Hidden.Where(r => r.Kind == RecordKinds.CostEntry).Select(r => r.Date).ToHashSet();
        foreach (var log in logs.Where(l => hiddenMoneyDays.Contains(l.LogDate)))
        {
            if (await MoneyHiddenAsync(repository, log, visibility, ct))
            {
                result.Add(log.Id);
            }
        }

        return result;
    }

    private static async Task<bool> MoneyHiddenAsync(
        IShramSafalRepository repository, DailyLog log, RecordVisibility visibility, CancellationToken ct)
    {
        if (visibility.HiddenCostIds.Count == 0)
        {
            return false;
        }

        var lines = await RecordFirstMoney.OfAsync(repository, log, NullLogger.Instance, ct);
        return lines.LookFor.Any(visibility.HiddenCostIds.Contains);
    }
}
