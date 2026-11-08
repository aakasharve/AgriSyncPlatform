// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Inputs;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// The pull's read of his हो / नाही / फोटो answers (founders D-92 / D-95).
///
/// <para><b>Their own delta.</b> An answer is an append-only row that never moves its record's <c>ModifiedAtUtc</c> (that
/// would re-open a confirmed day), so the record's delta cannot carry it. The answers kept since the phone's cursor are read
/// through the same MU-3 window as every other kind (a farm re-sent from the beginning sends them all).</para>
///
/// <para><b>Only for a record he may see.</b> Its audience (PRV), his plots and an own-work seat's own records (MU-4) are all
/// <see cref="RecordVisibility.HiddenLogIds"/>; the product name an answer carries is a value, not his words
/// (<c>LogContentDocument.WordKeys</c>), so it travels with the record.</para>
///
/// <para><b>E4.</b> A row is trusted only when its farm IS its record's farm: a record in this response is checked against it,
/// any other against the farm's own records - never on the answer's own column alone. A row whose record is gone (a demo-farm
/// clear or a test-fixture reset deletes records and knows nothing of this table) is never sent.</para>
///
/// <para><b>A record re-admitted to him brings its answers.</b> When a record comes back to a reader (its audience changed
/// after his cursor, or it moved onto his plots) its photos are sent again with it, and so are its answers: the newest answer
/// of each item of every re-admitted record is read whatever its age, then goes through the same visibility, farm and
/// de-duplication rules as the delta. An answer that is not on a re-admitted record and is older than the cursor is not re-sent.</para>
///
/// <para><b>The newest answer of each item</b> only (per record, input event, mix slot, and speaker-or-check): the phone reads
/// latest-wins, so a row superseded inside the window need not travel.</para>
/// </summary>
internal static class PullInputIdentityAnswers
{
    public static async Task<List<InputIdentityAssertion>> ReadAsync(
        IShramSafalRepository repository,
        PullReadWindow window,
        RecordVisibility visibility,
        IReadOnlyDictionary<Guid, Guid> dailyLogFarmById,
        IReadOnlyCollection<Guid> readmittedLogIds,
        CancellationToken ct)
    {
        var rows = await window.ReadAsync(
            _ => true,
            (ids, since) => repository.GetInputIdentityAssertionsChangedSinceAsync(ids, since, ct),
            a => (Guid)a.FarmId);

        // A record re-admitted to him since his cursor: its answers go with it, however old. Only records of the response
        // (their farm is known and is one this pull reads); the farm check of the read itself (the answer's farm is its
        // record's farm) is repeated below for every row, from either source.
        var readmitted = readmittedLogIds
            .Where(id => dailyLogFarmById.TryGetValue(id, out var farm) && window.ScopeOf(farm) is not null)
            .Distinct()
            .ToList();
        if (readmitted.Count > 0)
        {
            rows.AddRange(await repository.GetLatestInputIdentityAssertionsForLogsAsync(readmitted, ct));
        }

        rows = rows.DistinctBy(a => a.Id).Where(a => window.ScopeOf((Guid)a.FarmId) is not null).ToList();

        var kept = new List<InputIdentityAssertion>();
        foreach (var farmRows in rows.Where(a => visibility.MaySeeLog(a.DailyLogId)).GroupBy(a => (Guid)a.FarmId))
        {
            var answeredLogIds = farmRows.Select(a => a.DailyLogId).Distinct().ToList();
            var logsOfThisFarm = answeredLogIds
                .Where(id => dailyLogFarmById.TryGetValue(id, out var logFarm) && logFarm == farmRows.Key)
                .ToHashSet();
            var notInThisResponse = answeredLogIds.Where(id => !dailyLogFarmById.ContainsKey(id)).ToList();
            if (notInThisResponse.Count > 0)
            {
                logsOfThisFarm.UnionWith(
                    (await repository.GetDailyLogsForFarmByIdsAsync(new FarmId(farmRows.Key), notInThisResponse, ct)).Select(l => l.Id));
            }

            kept.AddRange(farmRows.Where(a => logsOfThisFarm.Contains(a.DailyLogId)));
        }

        return Newest(kept);
    }

    /// <summary>
    /// The cursor after these answers: at least where it was, and the newest answer sent when that is later. A record's
    /// re-sent OLD answers are older than the cursor, so they never move it; the delta rows are the only ones that can.
    /// </summary>
    internal static DateTime AdvanceCursor(DateTime cursor, IReadOnlyCollection<InputIdentityAssertion> sent) =>
        sent.Count > 0 && sent.Max(a => a.AssertedAtUtc) is var newest && newest > cursor ? newest : cursor;

    /// <summary>The newest answer of each item (record, input event, mix slot, speaker-or-check), oldest first.</summary>
    internal static List<InputIdentityAssertion> Newest(IEnumerable<InputIdentityAssertion> answers) =>
        answers
            .GroupBy(a => (a.DailyLogId, a.InputEventId, a.MixIndex, a.IsCheck))
            .Select(g => g.OrderBy(a => a.AssertedAtUtc).ThenBy(a => a.Id).Last())
            .OrderBy(a => a.AssertedAtUtc)
            .ThenBy(a => a.Id)
            .ToList();
}
