using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane PRV fix pass 1 (M5) — an export is never refused because a record of its period is kept from
/// the reader. It is built from what he may see: a day-ledger whose money record is kept from him is left out, and
/// the document then carries the W4 line in its own language (the PDFs are English today). A period that leaves
/// nothing out carries no line (never a false "incomplete").
/// </summary>
public static class ExportVisibility
{
    /// <summary>W4 in English, the PDFs' language — the phone's own English words for the same rule.</summary>
    public const string RuleNotCountedEn = "By ShramSafal's rules, some records are not counted here.";

    public static ExportLedgers Of(IEnumerable<DayLedger> ledgers, RecordVisibility visibility)
    {
        ArgumentNullException.ThrowIfNull(ledgers);
        ArgumentNullException.ThrowIfNull(visibility);
        var all = ledgers.ToList();
        var shown = all.Where(l => visibility.MaySeeCost(l.SourceCostEntryId)).ToList();
        return new ExportLedgers(shown, shown.Count < all.Count ? RuleNotCountedEn : null);
    }
}

/// <summary>The day-ledgers an export may carry for its reader, and the W4 line when any was left out.</summary>
public sealed record ExportLedgers(List<DayLedger> Shown, string? RuleNote);
