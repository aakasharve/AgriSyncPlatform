// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-84 = 1, D-31, D-50, D-66, D-69; R15, R16).
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.Services;

/// <summary>
/// What a reminder carries for ONE reader besides the task itself (all additive on <c>PlannedWorkDto</c>): who made it (his name),
/// which of the three sources it comes from, whether he may hear its source log's voice, whether its words are withheld from him by
/// the money rule, and the two facts the card says in words (D-84 = 1).
/// </summary>
/// <param name="CreatedByName">The maker's name as the farm sees it; <c>null</c> when he has none (never invented, P4).</param>
/// <param name="Category"><see cref="ReminderCategory"/> by name.</param>
/// <param name="MayPlayVoice"><c>true</c> when the task has a source log with a recording this reader may hear (<see cref="RecordWordsGate"/>,
/// and the money rule of the original voice); <c>false</c> when the log has a recording he may NOT hear (the card says the ShramSafal rule);
/// <c>null</c> when there is no recording to speak of (no source log, or none kept: nothing to say, P4). The recording is never copied.</param>
/// <param name="WordsWithheld">The task's words mention money and this reader neither made it nor may hear money words
/// (<see cref="MoneyMention"/>): its words are not sent (R16).</param>
/// <param name="MakerAlwaysShown">The maker is on the always-show list and the reminder is not kept with a record's people: the card says
/// "by the owner's setting, everyone on this plot sees this reminder".</param>
/// <param name="FromChosenPeopleRecord">The reminder was made from a record kept for chosen people: it stays with that record's people.</param>
public sealed record ReminderLook(
    string? CreatedByName,
    string Category,
    bool? MayPlayVoice,
    bool WordsWithheld,
    bool MakerAlwaysShown,
    bool FromChosenPeopleRecord);

/// <summary>Builds each task's <see cref="ReminderLook"/> for one reader (the pull, the REST reads and the door replies ask it).</summary>
public static class ReminderLooks
{
    /// <summary>
    /// The look of every task in <paramref name="works"/> for <paramref name="readerUserId"/>. <paramref name="accesses"/>,
    /// <paramref name="visibility"/> and <paramref name="audiences"/> are the caller's own reads when it already has them (the pull);
    /// otherwise they are read here for the farms of <paramref name="works"/>.
    /// </summary>
    public static async Task<Func<PlannedWork, ReminderLook>> LoadAsync(
        IShramSafalRepository repository,
        IReadOnlyCollection<PlannedWork> works,
        Guid readerUserId,
        DateTime atUtc,
        IReadOnlyDictionary<Guid, FarmAccess?>? accesses = null,
        RecordVisibility? visibility = null,
        IReadOnlyDictionary<Guid, ReminderAudiences>? audiences = null,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(works);
        var farmIds = works.Select(w => (Guid)w.FarmId).Distinct().ToList();
        if (farmIds.Count == 0)
        {
            return _ => new ReminderLook(null, nameof(ReminderCategory.FromPlanning), null, false, false, false);
        }

        accesses ??= await repository.GetFarmAccessesForUserAsync(readerUserId, farmIds, ct);
        audiences ??= await repository.GetReminderAudiencesAsync(farmIds, ct);
        visibility ??= works.Any(w => w.SourceDailyLogId is not null)
            ? await RecordVisibility.ForFarmsAsync(repository, farmIds, readerUserId, atUtc, ct)
            : RecordVisibility.None(readerUserId);

        // The makers' names: the farm's own directory (never a guess).
        var makerIds = works.Select(w => w.CreatedByUserId).Distinct().ToList();
        var names = await repository.GetDisplayNamesAsync(makerIds, ct);

        // The source logs of these reminders, one read per farm.
        var logs = new Dictionary<Guid, Domain.Logs.DailyLog>();
        foreach (var farm in works.Where(w => w.SourceDailyLogId is not null).GroupBy(w => (Guid)w.FarmId))
        {
            var ids = farm.Select(w => w.SourceDailyLogId!.Value).Distinct().ToList();
            foreach (var log in await repository.GetDailyLogsForFarmByIdsAsync(new AgriSync.SharedKernel.Contracts.Ids.FarmId(farm.Key), ids, ct))
            {
                logs[log.Id] = log;
            }
        }

        var voice = new Dictionary<Guid, bool?>();
        foreach (var work in works.Where(w => w.SourceDailyLogId is not null))
        {
            var logId = work.SourceDailyLogId!.Value;
            if (voice.ContainsKey(logId) || !logs.TryGetValue(logId, out var log))
            {
                continue;
            }

            voice[logId] = await MayPlayAsync(repository, log, readerUserId, accesses.GetValueOrDefault((Guid)work.FarmId), atUtc, ct);
        }

        var wordsWithheldByWork = new Dictionary<Guid, bool>();
        foreach (var work in works)
        {
            var scope = FarmReadScope.Of((Guid)work.FarmId, accesses.GetValueOrDefault((Guid)work.FarmId), atUtc);
            wordsWithheldByWork[work.Id] = WithholdsWords(work, scope, readerUserId);
        }

        return work =>
        {
            var farmId = (Guid)work.FarmId;
            var set = audiences.GetValueOrDefault(farmId) ?? ReminderAudiences.Defaults(farmId);
            var restricted = work.SourceDailyLogId is { } logId ? visibility.Restricted(RecordKinds.DailyLog, logId) : null;
            var chosenPeople = restricted is { Audience: RecordAudience.Selected };
            var keptWithRecord = restricted is not null;
            return new ReminderLook(
                names.GetValueOrDefault(work.CreatedByUserId),
                ReminderCategories.Of(work).ToString(),
                work.SourceDailyLogId is { } source ? voice.GetValueOrDefault(source) : null,
                wordsWithheldByWork.GetValueOrDefault(work.Id),
                work.IsReminder && set.AlwaysShow.Contains(work.CreatedByUserId) && !keptWithRecord,
                chosenPeople);
        };
    }

    /// <summary>
    /// R16 (D-66): the words of a REMINDER that mentions money are withheld from a reader who did not make it and may not hear money
    /// words. The whole of its words: title, note, crew, quantity. Work handed to someone is not a reminder: it reads exactly as it did
    /// before this lane (D-24e1; fix round, review M3).
    /// </summary>
    public static bool WithholdsWords(PlannedWork work, FarmReadScope? scope, Guid readerUserId)
    {
        ArgumentNullException.ThrowIfNull(work);
        return work.IsReminder
            && !(readerUserId != Guid.Empty && work.CreatedByUserId == readerUserId)
            && !MoneyMention.HearsMoneyWords(scope)
            && (MoneyMention.InText(work.Title) || MoneyMention.InText(work.Note)
                || MoneyMention.InText(work.CrewText) || MoneyMention.InText(work.QuantityText));
    }

    /// <summary>
    /// R15 (D-31, D-50): the reader may play the log's voice. The log must carry a recording; the reader must be the speaker, the
    /// primary owner or hold the confirm-records grant (<see cref="RecordWordsGate"/>); and a record that mentions money is not
    /// played to someone who may not hear money words. The recording itself is never copied here; "ऐका" asks the original-voice door.
    /// </summary>
    private static async Task<bool?> MayPlayAsync(
        IShramSafalRepository repository, Domain.Logs.DailyLog log, Guid readerUserId, FarmAccess? access, DateTime atUtc, CancellationToken ct)
    {
        if (log.VoiceClipId is null)
        {
            return null;
        }

        if (access is null)
        {
            return false;
        }

        var may = await RecordWordsGate.MayHearAsync(
            readerUserId,
            log.OperatorUserId.Value,
            FarmAccessPolicy.MayRead(access) ? access.Role : null,
            () => Task.FromResult(FarmAccessPolicy.Holds(access, FarmAuthority.ConfirmRecords, atUtc)));
        if (!may)
        {
            return false;
        }

        if (readerUserId != log.OperatorUserId.Value
            && (!MoneyMention.HearsMoneyWords(FarmReadScope.Of((Guid)log.FarmId, access, atUtc))
                || await RecordMoneyAccess.MoneyHiddenFromAsync(repository, log, readerUserId, atUtc, ct))
            && await MoneyMention.InStoredRecordAsync(repository, log, ct))
        {
            return false;
        }

        return true;
    }
}
