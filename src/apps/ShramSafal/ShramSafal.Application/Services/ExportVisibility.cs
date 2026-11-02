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
        // spec: plr-d10 lane MU-4 (D-39) - each row as the reader may receive it (RecordVisibility.Ledger): a bill kept by
        // its audience is left out (and the W4 line says so); for a chosen-plots seat only the share lines on HIS plots,
        // never the whole bill; a row with no share of his is not his (not "left out by rule": it is another plot's).
        var shown = new List<DayLedger>();
        foreach (var ledger in all)
        {
            if (visibility.Ledger(Contracts.Dtos.DtoMappingExtensions.ToDto(ledger)) is not { } seen)
            {
                continue;
            }

            shown.Add(seen.Allocations.Count == ledger.Allocations.Count
                ? ledger
                : DayLedger.Create(
                    ledger.Id,
                    ledger.FarmId,
                    ledger.SourceCostEntryId,
                    ledger.LedgerDate,
                    ledger.AllocationBasis,
                    ledger.CreatedByUserId,
                    seen.Allocations
                        .Select(a => DayLedgerAllocation.Create(a.Id, a.PlotId, a.AllocatedAmount, a.CurrencyCode, a.AllocatedAtUtc))
                        .ToList(),
                    ledger.CreatedAtUtc));
        }

        var leftOutByRule = all.Any(l => visibility.HiddenByAudience(Domain.RecordPrivacy.RecordKinds.CostEntry, l.SourceCostEntryId));
        return new ExportLedgers(shown, leftOutByRule ? RuleNotCountedEn : null);
    }
}

/// <summary>The day-ledgers an export may carry for its reader, and the W4 line when any was left out.</summary>
public sealed record ExportLedgers(List<DayLedger> Shown, string? RuleNote);
