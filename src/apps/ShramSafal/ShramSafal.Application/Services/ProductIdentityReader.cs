// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Tasks 1, 3a and 3)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// The ONE place the application reads what the app understood of the products in saved records: the LATEST stored content of
/// each record, the library's match, the newest answers, and the attachment rows that exist now. Never the parse job (doctrine
/// P4). Read for the day's score (the roster's PRODUCT_ID part), the per-plot read, the approval card's products and the day's
/// points, so they cannot disagree.
///
/// <para>Every row is checked against its record's farm (E4): a content row, an answer or a packet photo that belongs to
/// another farm than the record never counts, whatever the database returned.</para>
/// </summary>
public static class ProductIdentityReader
{
    /// <summary>The judged products of each record, by record id. A record with no stored content, or none naming a product,
    /// maps to an empty list.</summary>
    public static async Task<IReadOnlyDictionary<Guid, IReadOnlyList<ProductJudgement>>> JudgeAsync(
        IShramSafalRepository repository,
        IReadOnlyCollection<DailyLog> logs,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(logs);

        var result = new Dictionary<Guid, IReadOnlyList<ProductJudgement>>();
        if (logs.Count == 0)
        {
            return result;
        }

        var logIds = logs.Select(l => l.Id).Distinct().ToList();
        var contents = await repository.GetCurrentDailyLogContentsAsync(logIds, ct);
        // The FULL history, not the newest per stored is_check flag: who answered (the record's author or not) decides the kind, so an
        // author who also holds the authority cannot displace a checker's earlier check (lane IT3 fix pass 1, F1).
        var answers = await repository.GetInputIdentityAssertionsForLogsAsync(logIds, ct);
        var photoFarm = await PhotoFarmsAsync(repository, answers, ct);

        foreach (var log in logs)
        {
            if (result.ContainsKey(log.Id))
            {
                continue;
            }

            var content = contents.FirstOrDefault(c => c.DailyLogId == log.Id && c.FarmId == log.FarmId); // E4
            var items = content is null ? [] : ProductIdentity.ItemsOf(content.DocumentJson);
            var logAnswers = answers.Where(a => a.DailyLogId == log.Id && a.FarmId == log.FarmId).ToList(); // E4
            var farm = (Guid)log.FarmId;
            result[log.Id] = items
                .Select(item => ProductIdentity.Judge(
                    item,
                    logAnswers,
                    log.OperatorUserId.Value,
                    attachmentId => photoFarm.TryGetValue(attachmentId, out var photoFarmId) && photoFarmId == farm))
                .ToList();
        }

        return result;
    }

    /// <summary>
    /// The product-answer points the farm-local day <paramref name="day"/> earned (founder D-94): the answers this farm took
    /// on that day, each product counted once on the day of its first answer that could count. The records may be of any
    /// work day. <see cref="IdentityPoints.None"/> when no answer was taken that day.
    /// </summary>
    public static async Task<IdentityPoints> PointsAsync(
        IShramSafalRepository repository, Guid farmId, DateOnly day, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        var (fromUtc, toUtc) = FarmLocalDay.UtcWindow(day);
        var given = await repository.GetInputIdentityAssertionsGivenBetweenAsync(farmId, fromUtc, toUtc, ct);
        if (given.Count == 0)
        {
            return IdentityPoints.None;
        }

        var logIds = given.Select(a => a.DailyLogId).Distinct().ToList();
        var history = await repository.GetInputIdentityAssertionsForLogsAsync(logIds, ct);
        var contents = await repository.GetCurrentDailyLogContentsAsync(logIds, ct);
        var photoFarm = await PhotoFarmsAsync(repository, history, ct);

        var records = new List<ProductRecord>();
        foreach (var logId in logIds)
        {
            var log = await repository.GetDailyLogByIdAsync(logId, ct);
            if (log is null || (Guid)log.FarmId != farmId) // E4
            {
                continue;
            }

            var content = contents.FirstOrDefault(c => c.DailyLogId == log.Id && c.FarmId == log.FarmId);
            if (content is null)
            {
                continue;
            }

            records.Add(new ProductRecord(log.Id, farmId, log.LogDate, ProductIdentity.ItemsOf(content.DocumentJson)));
        }

        return ProductIdentityPoints.For(
            day,
            records,
            history,
            attachmentId => photoFarm.TryGetValue(attachmentId, out var photoFarmId) && photoFarmId == farmId);
    }

    // The attachment rows that exist for the photo answers, by id -> the farm they belong to. An id with no row is a pointer, not
    // a photo (D-93); a row of another farm is checked against the record's farm by the caller.
    private static async Task<Dictionary<Guid, Guid>> PhotoFarmsAsync(
        IShramSafalRepository repository, IReadOnlyCollection<InputIdentityAssertion> answers, CancellationToken ct)
    {
        var photoIds = answers
            .Where(a => a.Verdict == IdentityVerdict.Photo && a.AttachmentId is { } id && id != Guid.Empty)
            .Select(a => a.AttachmentId!.Value)
            .Distinct()
            .ToList();
        if (photoIds.Count == 0)
        {
            return [];
        }

        var rows = await repository.GetAttachmentsByIdsAsync(photoIds, ct);
        var farms = new Dictionary<Guid, Guid>();
        foreach (var row in rows)
        {
            farms[row.Id] = (Guid)row.FarmId;
        }

        return farms;
    }
}
