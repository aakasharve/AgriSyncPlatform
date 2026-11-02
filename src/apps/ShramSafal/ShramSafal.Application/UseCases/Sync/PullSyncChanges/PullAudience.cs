using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26; orchestrator calls 7 and 9) — the pull's half of "who may see this record".
///
/// <para><b>What is sent.</b> A work or money record whose audience leaves this reader out is not sent, and nor is
/// anything that hangs from it (its labour, words and content travel inside it; its photos, corrections and day-ledger
/// rows are filtered by the caller with <see cref="RecordVisibility"/>). An audience change moves the record past every
/// cursor (<see cref="AudienceStamp"/>), so a reader who still sees it, or who regains it, gets it again; the photos,
/// corrections and day-ledger rows of a record RE-ADMITTED since his cursor are re-sent with it
/// (<see cref="Readmitted"/>), because they did not change themselves.</para>
///
/// <para><b>The withdrawn list.</b> A record this reader may no longer see is named — kind and id, nothing else — when
/// he has not yet been told:</para>
/// <list type="bullet">
/// <item>his cursor is not the beginning (a phone pulling from the beginning holds nothing it is owed a word about; the
/// phone itself sweeps a full pull, my call — so a since=0 body names no restricted record at all);</item>
/// <item>its audience changed after his cursor, at WHOLE-SECOND grain exactly as <see cref="PullReadWindow"/> does it:
/// a change stamped at <c>c</c> is delivered by a response whose cursor is at least <see cref="PullReadWindow.DeliveredAt"/>(c).
/// A listed change raises this response's cursor to that second, so the phone's rounded-down cursor passes it and it is
/// not listed again; a change whose second is still running is not listed yet and holds this response's cursor below
/// that second — the next pull lists it. <see cref="AudienceStamp"/> never stamps a change exactly on a whole second,
/// so a cursor equal to its second always reads it.</item>
/// </list>
/// <para>Fix pass 1 (M1): it no longer asks WHEN the record was made. A phone can hold rows newer than its cursor (a
/// degraded answer delivers every row but freezes the cursor; the pending caps hold it back), and he was entitled to the
/// record while it was the team's, so a bare kind + id tells him nothing new.</para>
/// <para><b>The limit, stated honestly (as <see cref="PullReadWindow"/>'s F1 note does).</b> The jump moves the cursor to
/// the end of the change's whole second, not to the last row read: a row of another kind stamped earlier in that second
/// but committed after this pull read it is passed by the cursor and not re-sent — the same class as MU-3's reset, closed
/// only by a lock shared with every write or a trailing safety margin on every cursor. The window is one save straddling
/// one pull inside one second.</para>
/// <para>A farm the phone says it holds no data for (MU-3 N5) is never named in the list.</para>
/// </summary>
internal sealed class PullAudience(
    RecordVisibility visibility,
    PullReadWindow window,
    DateTime phoneSinceUtc,
    DateTime serverNowUtc)
{
    private readonly List<WithdrawnRecordDto> withdrawn = [];

    public RecordVisibility Visibility => visibility;

    /// <summary>The records taken back from this phone, by kind and id.</summary>
    public IReadOnlyList<WithdrawnRecordDto> Withdrawn => withdrawn;

    /// <summary>The newest withdrawal this response delivers (its whole second): the next cursor is at least this.</summary>
    public DateTime? DeliveredThroughUtc { get; private set; }

    /// <summary>A withdrawal too young to deliver (its whole second still runs): this response's cursor stays below it.</summary>
    public DateTime? PendingCapUtc { get; private set; }

    /// <summary>The records of <paramref name="logs"/> this reader may see; the rest are weighed for the withdrawn list.</summary>
    public List<DailyLog> Logs(IEnumerable<DailyLog> logs)
    {
        var kept = new List<DailyLog>();
        foreach (var log in logs)
        {
            if (visibility.MaySeeLog(log.Id))
            {
                kept.Add(log);
            }
            else if (visibility.HiddenByAudience(RecordKinds.DailyLog, log.Id))
            {
                // lane MU-4 — only a record kept by its AUDIENCE is named here; one outside his plots leaves his phone by
                // the plot scope the phone holds (accessScopes), as MU-3's purge does.
                Consider(RecordKinds.DailyLog, log.Id, (Guid)log.FarmId, log.AudienceChangedAtUtc);
            }
        }

        return kept;
    }

    /// <summary>The money records this reader may see; the rest are weighed for the withdrawn list.</summary>
    public List<CostEntry> Costs(IEnumerable<CostEntry> entries)
    {
        var kept = new List<CostEntry>();
        foreach (var entry in entries)
        {
            if (visibility.MaySeeCost(entry.Id))
            {
                kept.Add(entry);
            }
            else if (visibility.HiddenByAudience(RecordKinds.CostEntry, entry.Id))
            {
                Consider(RecordKinds.CostEntry, entry.Id, (Guid)entry.FarmId, entry.AudienceChangedAtUtc);
            }
        }

        return kept;
    }

    /// <summary>
    /// Was this record (sent now) re-admitted to him since his cursor — its audience changed after it, on a farm read
    /// from his cursor (a farm re-sent from the beginning sends every child anyway)? Then its photos, corrections and
    /// day-ledger rows are sent again with it, and — when the change's whole second is over — this response's cursor
    /// passes that second, so the record and its children come back ONCE (the withdrawal's rule, mirrored).
    /// </summary>
    public bool Readmitted(Guid farmId, DateTime? audienceChangedAtUtc)
    {
        if (audienceChangedAtUtc is not { } changed
            || phoneSinceUtc <= DateTime.UnixEpoch
            || window.ResetFarmIds.Contains(farmId))
        {
            return false;
        }

        var delivered = PullReadWindow.DeliveredAt(changed);
        if (phoneSinceUtc >= delivered)
        {
            return false;
        }

        if (delivered <= serverNowUtc)
        {
            DeliveredThroughUtc = DeliveredThroughUtc is { } through && through > delivered ? through : delivered;
        }

        return true;
    }

    /// <summary>The days of one farm whose totals leave a record out for this reader (W4), by kind.</summary>
    public IReadOnlyList<WithheldRecordDayDto> WithheldDays(FarmReadScope scope)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (scope.OwnRecordsOnly)
        {
            // He reads only what he made, and what he made is never kept from him: no total of his leaves anything out.
            return [];
        }

        return visibility.Hidden
            .Where(r => r.FarmId == scope.FarmId && (r.Kind == RecordKinds.DailyLog || scope.SeeMoney))
            .Select(r => new WithheldRecordDayDto(r.Kind == RecordKinds.DailyLog ? "work" : "money", r.Date))
            .Distinct()
            .OrderBy(d => d.Date)
            .ThenBy(d => d.Kind, StringComparer.Ordinal)
            .ToList();
    }

    private void Consider(string kind, Guid id, Guid farmId, DateTime? audienceChangedAtUtc)
    {
        if (audienceChangedAtUtc is not { } changed
            || phoneSinceUtc <= DateTime.UnixEpoch
            || window.NotHeldFarmIds.Contains(farmId))
        {
            return;
        }

        var delivered = PullReadWindow.DeliveredAt(changed);
        if (phoneSinceUtc >= delivered)
        {
            return; // told already: a pull after the change's second handed out a cursor past it.
        }

        if (delivered > serverNowUtc)
        {
            var cap = delivered.AddSeconds(-1);
            PendingCapUtc = PendingCapUtc is { } current && current < cap ? current : cap;
            return;
        }

        withdrawn.Add(new WithdrawnRecordDto(kind, id));
        DeliveredThroughUtc = DeliveredThroughUtc is { } through && through > delivered ? through : delivered;
    }
}
