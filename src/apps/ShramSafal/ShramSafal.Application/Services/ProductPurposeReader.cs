// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// The ONE place the application reads what is known of what each product of a saved record was FOR: the products of the
/// record's LATEST stored content, the purpose that content states, and his stored answers to Sathi's product-purpose question.
/// Never the parse job (P4). Read for the day's score (the roster's PURPOSE part), the per-plot read and the phone's product
/// rows, so they cannot disagree.
///
/// <para><b>E4.</b> A content row or an answer counts only when its farm IS its record's farm, whatever the database returned.</para>
/// </summary>
public static class ProductPurposeReader
{
    /// <summary>The judged products of each record, by record id. A record with no stored content, or none naming a product, maps
    /// to an empty list. The answers are read only when some record names a product.</summary>
    public static async Task<IReadOnlyDictionary<Guid, IReadOnlyList<ProductPurposeJudgement>>> JudgeAsync(
        IShramSafalRepository repository,
        IReadOnlyCollection<DailyLog> logs,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(logs);

        var result = new Dictionary<Guid, IReadOnlyList<ProductPurposeJudgement>>();
        if (logs.Count == 0)
        {
            return result;
        }

        var logIds = logs.Select(l => l.Id).Distinct().ToList();
        var contents = await repository.GetCurrentDailyLogContentsAsync(logIds, ct);

        var itemsByLog = new Dictionary<Guid, IReadOnlyList<ProductPurposeItem>>();
        foreach (var log in logs)
        {
            if (itemsByLog.ContainsKey(log.Id))
            {
                continue;
            }

            var content = contents.FirstOrDefault(c => c.DailyLogId == log.Id && c.FarmId == log.FarmId); // E4
            itemsByLog[log.Id] = content is null ? [] : ProductPurpose.ItemsOf(content.DocumentJson);
        }

        var named = itemsByLog.Where(kv => kv.Value.Count > 0).Select(kv => kv.Key).ToList();
        List<ProductPurposeAnswer> answers = named.Count == 0
            ? []
            : ToAnswers(await repository.GetProductPurposeAnswersForLogsAsync(named, ct));

        foreach (var log in logs)
        {
            if (result.ContainsKey(log.Id))
            {
                continue;
            }

            var farm = (Guid)log.FarmId;
            var logAnswers = answers.Where(a => a.DailyLogId == log.Id && a.FarmId == farm).ToList(); // E4
            result[log.Id] = itemsByLog[log.Id].Select(item => ProductPurpose.Judge(item, logAnswers)).ToList();
        }

        return result;
    }

    /// <summary>The stored rows of the question as answers; a row whose key names no product slot, or with no record, is not one.</summary>
    internal static List<ProductPurposeAnswer> ToAnswers(IEnumerable<Domain.Dfes.QuestionEvent> rows) =>
        rows
            .Where(r => r.DailyLogId is not null && r.Skipped != true)
            .Select(r => ProductPurpose.TryParseKey(r.QuestionKey, out var eventId, out var slot)
                ? new ProductPurposeAnswer(
                    r.Id, r.FarmId, r.DailyLogId!.Value, eventId, slot, r.ProductName, r.Response, r.AnswerMode, r.AnswerCode,
                    r.AskedUserId, r.CreatedAtUtc)
                : null)
            .OfType<ProductPurposeAnswer>()
            .ToList();
}
