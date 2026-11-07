using System.Text.Json;
using System.Text.RegularExpressions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Logs.Content;

namespace ShramSafal.Application.Services;

/// <summary>
/// lane MU-3 fix 1 (F3, founder D-66 = option 1) — DOES A RECORD MENTION MONEY? One test, used by every
/// surface that hands a record's words or voice to a reader who does not see the farm's money (the pull, the
/// command answers, the original voice, <c>/ai/jobs/{id}</c>).
///
/// <para><b>Mentions money</b> = its saved details carry an amount (any
/// <see cref="LogContentDocument.MoneyKeys"/> value, a crew's stated total or per-person wage), OR a free-text
/// field holds a money word: <c>₹</c>, <c>रुपये</c> (and its other endings, <c>रुपया</c> / <c>रुपयांचे</c>),
/// <c>रु.</c> or <c>रु</c> before a number, <c>Rs</c> / <c>INR</c> as a word, or <c>rupee</c> / <c>rupay</c>.
/// Digits after a marker may be Devanagari (<c>रु ५००</c>) or Latin.</para>
///
/// <para><b>It only ever WITHHOLDS a whole field.</b> Nothing here cuts an amount out of text: a false
/// match hides words, it never changes them (FIX-1 item 15).</para>
/// </summary>
public static partial class MoneyMention
{
    /// <summary>Does <paramref name="text"/> carry a money word?</summary>
    public static bool InText(string? text) => !string.IsNullOrEmpty(text) && MoneyWord().IsMatch(text);

    /// <summary>
    /// Does this record (its content, its task lines, its crews, its confirmations) mention money? Read off the
    /// record as stored — call it BEFORE any amount is stripped.
    /// </summary>
    public static bool InRecord(DailyLogDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        if (dto.Content is { } content && InDocument(content.Document))
        {
            return true;
        }

        if (dto.Tasks.Any(t => InText(t.Notes) || InText(t.DeviationNote)))
        {
            return true;
        }

        if (dto.Labour?.Any(l => l.WagePerPerson is not null || l.TotalCost is not null || InText(l.Notes) || InText(l.Task)) == true)
        {
            return true;
        }

        return dto.VerificationEvents.Any(v => InText(v.Reason));
    }

    /// <summary>
    /// The same test for a record read on its own (the original voice, an edit): its stored content, task lines,
    /// crews and confirmations, exactly as the pull would read them before projecting.
    /// </summary>
    public static async Task<bool> InStoredRecordAsync(
        Ports.IShramSafalRepository repository, Domain.Logs.DailyLog log, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        var content = await repository.GetCurrentDailyLogContentAsync(log.Id, ct);
        var labour = await repository.GetLabourAssignmentsForDailyLogsAsync([log.Id], ct);
        return InRecord(log.ToDto(
            labour.Where(a => a.DailyLogId == log.Id).Select(a => a.ToDto([])).ToList(),
            content?.ToDto(withWords: true)));
    }

    /// <summary>Does a content document carry an amount or a money word anywhere?</summary>
    public static bool InDocument(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (LogContentDocument.MoneyKeys.Contains(property.Name) && IsAmount(property.Value))
                    {
                        return true;
                    }

                    if (InDocument(property.Value))
                    {
                        return true;
                    }
                }

                return false;
            case JsonValueKind.Array:
                return element.EnumerateArray().Any(InDocument);
            case JsonValueKind.String:
                return InText(element.GetString());
            default:
                return false;
        }
    }

    /// <summary>
    /// spec: plr-d10 lane MU-1 fix round 1 (D-70 option 2; review MEDIUM-2) - does a VOICE PARSE (the AI job's result) mention
    /// money? <see cref="InDocument"/> knows the amount keys (<c>totalCost</c> among them) and the money words, but not a labour
    /// row's stated <c>rate</c> or <c>wagePerPerson</c> - a day wage with no rupee word ("5 workers, rate 400"). Those count
    /// here, on the parse's own <c>labour</c> rows only (a <c>rate</c> elsewhere is not a wage).
    /// </summary>
    public static bool InParse(JsonElement root) =>
        InDocument(root)
        || (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("labour", out var labour)
            && labour.ValueKind == JsonValueKind.Array
            && labour.EnumerateArray().Any(row => row.ValueKind == JsonValueKind.Object
                && ((row.TryGetProperty("rate", out var rate) && IsAmount(rate))
                    || (row.TryGetProperty("wagePerPerson", out var wage) && IsAmount(wage)))));

    /// <summary>
    /// Are the words and voice of <paramref name="original"/> withheld from this reader for money (D-66; fix 2 N4 =
    /// D-67)? Yes when he did not make the record, does not see WAGES there (see wages needs see money, so every seat
    /// without see money is caught too; no scope at all fails closed), and the record mentions money — his words may
    /// state a named worker's pay ("रवीला ५०० रु."). The primary owner always sees wages, so he is never caught.
    /// </summary>
    public static bool WithholdsWords(DailyLogDto original, FarmReadScope? scope, Guid readerUserId)
    {
        ArgumentNullException.ThrowIfNull(original);
        return !(readerUserId != Guid.Empty && original.OperatorUserId == readerUserId)
            && !HearsMoneyWords(scope)
            && InRecord(original);
    }

    /// <summary>
    /// D-67 — may this seat hear the words of a record that mentions money? Only with see wages. lane MU-1 (D-70 option 2,
    /// F124): and not on chosen plots, where no day wage may be read and a spoken one can be in the words.
    /// </summary>
    public static bool HearsMoneyWords(FarmReadScope? scope) => scope?.SeeDayWages == true;

    private static bool IsAmount(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => false,
        JsonValueKind.String => !string.IsNullOrWhiteSpace(value.GetString()),
        _ => true,
    };

    // ₹ | रुपय… | रु. / रु + number | Rs / INR as a word | rupee / rupay. \p{L} keeps "hrs", "Mrs", "yrs" out;
    // Devanagari consonants are letters and vowel signs are marks, so "रुंद" (a width) is not caught.
    [GeneratedRegex(
        @"₹|रुपय|रु\s*\.|रु\s*[0-9०-९]|(?<!\p{L})(?:rs|inr)\.?(?!\p{L})|rupee|rupay",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MoneyWord();
}
