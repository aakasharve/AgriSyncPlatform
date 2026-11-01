using System.Text.Json;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Logs.Content;

namespace ShramSafal.Application.Services;

/// <summary>
/// lane MU-3 fix 1 (F4, F5, F7) — ONE projection of what a reader may receive, used by the sync pull AND by
/// every answer that hands a record, money or a job card back (move, revise, verify, add a task, the job-card
/// commands and reads), so a command never returns what the pull would withhold.
///
/// <para><b>Money and wages (founder D-22 / D-26; the orchestrator's line, fix 1 F4).</b></para>
/// <list type="bullet">
/// <item><b>MONEY — needs see money:</b> crew totals and the farm's books: a crew's stated total
/// (<c>totalCost</c>), the amounts a record states (<see cref="LogContentDocument.MoneyKeys"/>), the "₹"
/// parts of a task line, cost entries, corrections, the day ledger, summaries, exports.</item>
/// <item><b>A WAGE — needs see wages (which needs see money):</b> a named worker's own pay: a crew's
/// per-person wage (<c>wagePerPerson</c>), a job card's rates and payout, a worker's earnings, the wage
/// book's per-person rows.</item>
/// </list>
/// <para>A person's OWN record (and his own job card) always comes back whole: it is his own statement.
/// No scope at all reads nothing — every amount is withheld (fail closed).</para>
/// </summary>
public static class ReadScopeProjection
{
    /// <summary>
    /// The record as <paramref name="readerUserId"/> may receive it.
    /// <para><b>Words on a record that mentions money (F3, founder D-66 = option 1).</b> A reader who did not make
    /// the record and does not see the farm's money, on a record that mentions money
    /// (<see cref="MoneyMention.InRecord"/>), gets none of its words: the content's word fields
    /// (<see cref="LogContentDocument.WordKeys"/>: the whole transcript, each item's spoken phrase and Sathi's
    /// restatement, notes, descriptions), and any task note, deviation note, crew note or crew task, or
    /// confirmation reason that itself names money — each withheld WHOLE, never cut. The work itself stays, and
    /// <see cref="DailyLogDto.WordsWithheldForMoney"/> says why the words are missing. His own records, records
    /// without money and a reader who sees money are untouched.</para>
    /// </summary>
    public static DailyLogDto Record(DailyLogDto dto, FarmReadScope? scope, Guid readerUserId)
    {
        ArgumentNullException.ThrowIfNull(dto);
        if (readerUserId != Guid.Empty && dto.OperatorUserId == readerUserId)
        {
            return dto;
        }

        var seesMoney = scope?.SeeMoney == true;
        var seesWages = scope?.SeeWages == true;
        if (seesMoney && seesWages)
        {
            return dto;
        }

        // Asked of the record as stored, BEFORE any amount below is taken out of it.
        var wordsWithheld = MoneyMention.WithholdsWords(dto, scope, readerUserId);
        var content = dto.Content;
        if (wordsWithheld && content is not null)
        {
            content = WithoutWords(content);
        }

        return dto with
        {
            Tasks = seesMoney
                ? dto.Tasks
                : dto.Tasks.Select(t => t with
                {
                    Notes = TaskNotes(t.Notes),
                    DeviationNote = Unless(t.DeviationNote),
                }).ToList(),
            Labour = dto.Labour?
                .Select(l => l with
                {
                    WagePerPerson = seesWages ? l.WagePerPerson : null,
                    TotalCost = seesMoney ? l.TotalCost : null,
                    // F10 — a stated amount withheld by rule says so; one never stated stays "not stated".
                    WageWithheld = !seesWages && l.WagePerPerson is not null ? true : l.WageWithheld,
                    TotalCostWithheld = !seesMoney && l.TotalCost is not null ? true : l.TotalCostWithheld,
                    Notes = seesMoney ? l.Notes : Unless(l.Notes),
                    Task = seesMoney ? l.Task : Unless(l.Task),
                })
                .ToList(),
            VerificationEvents = seesMoney
                ? dto.VerificationEvents
                : dto.VerificationEvents.Select(v => v with { Reason = Unless(v.Reason) }).ToList(),
            Content = seesMoney || content is null ? content : WithoutMoney(content),
            WordsWithheldForMoney = wordsWithheld ? true : dto.WordsWithheldForMoney,
        };

        // A free-text field that itself names money goes WHOLE; anything else stays exactly as written.
        static string? Unless(string? text) => MoneyMention.InText(text) ? null : text;

        // A task line's own amount labels (the app's "Cost: ₹…", "Rent: ₹…", "Fuel: ₹…") are values and are taken
        // off as before; a ₹ anywhere else is HIS words, so the whole note goes — never cut out of his text.
        static string? TaskNotes(string? notes)
        {
            var hisWordsNameMoney = notes?.Split(" • ")
                .Any(part => part.Contains('₹', StringComparison.Ordinal) && !IsAmountLabel(part.Trim())) == true;
            return hisWordsNameMoney ? null : Unless(LogTaskProjection.NotesWithoutMoney(notes));
        }

        static bool IsAmountLabel(string part) =>
            part.StartsWith("Cost: ₹", StringComparison.Ordinal)
            || part.StartsWith("Rent: ₹", StringComparison.Ordinal)
            || part.StartsWith("Fuel: ₹", StringComparison.Ordinal);
    }

    /// <summary>
    /// <see cref="Record"/> for a command answer: the reader's scope is read only when the record is not his own (his
    /// own record always comes back whole, so its maker is never asked for a standing).
    /// </summary>
    public static async Task<DailyLogDto> RecordForAsync(
        Ports.IShramSafalRepository repository, DailyLogDto dto, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return readerUserId != Guid.Empty && dto.OperatorUserId == readerUserId
            ? dto
            : Record(dto, await FarmReadGate.ScopeAsync(repository, dto.FarmId, readerUserId, atUtc, ct), readerUserId);
    }

    /// <summary>A job card as the reader may receive it: its rates and payout are a worker's pay (a wage).</summary>
    public static JobCardDto JobCard(JobCardDto dto, FarmReadScope? scope, Guid readerUserId)
    {
        ArgumentNullException.ThrowIfNull(dto);
        if (scope?.SeeWages == true || (readerUserId != Guid.Empty && dto.AssignedWorkerUserId == readerUserId))
        {
            return dto;
        }

        return dto with
        {
            EstimatedTotalAmount = null,
            LineItems = dto.LineItems.Select(i => i with { RatePerHourAmount = null }).ToList(),
        };
    }

    /// <summary>Money rows (cost entries, corrections) only for a reader who sees money; otherwise none.</summary>
    public static IReadOnlyList<T> Money<T>(IReadOnlyList<T> rows, FarmReadScope? scope) =>
        scope?.SeeMoney == true ? rows : [];

    /// <summary>The content document without his words (F3): every value stays.</summary>
    public static LogContentDto WithoutWords(LogContentDto content)
    {
        ArgumentNullException.ThrowIfNull(content);
        using var stripped = JsonDocument.Parse(LogContentDocument.StripWords(content.Document.GetRawText()));
        return content with { Document = stripped.RootElement.Clone() };
    }

    /// <summary>The content document without the amounts it states.</summary>
    public static LogContentDto WithoutMoney(LogContentDto content)
    {
        ArgumentNullException.ThrowIfNull(content);
        using var stripped = JsonDocument.Parse(LogContentDocument.StripMoney(content.Document.GetRawText()));
        return content with { Document = stripped.RootElement.Clone(), AmountsWithheld = true };
    }
}
