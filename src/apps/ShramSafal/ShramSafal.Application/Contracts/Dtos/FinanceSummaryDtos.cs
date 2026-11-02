namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FinanceSummaryItemDto(
    string GroupKey,
    decimal TotalAmount,
    int EntriesCount,
    int CorrectionsCount);

public sealed record FinanceSummaryDto(
    string GroupBy,
    DateOnly? FromDate,
    DateOnly? ToDate,
    string CurrencyCode,
    decimal GrandTotal,
    IReadOnlyList<FinanceSummaryItemDto> Items,
    // lane MU-3 fix 1 (F11) — how many of the caller's farms this summary does NOT count because their money
    // is not shown to him (0 = every farm he works on is counted). Additive: absent on an older server.
    int FarmsNotCounted = 0,
    // spec: plr-d10 lane PRV (founder D-26) — how many money records in this period this total does NOT count because
    // their audience leaves the caller out (0 = every one is counted). The phone shows W4 when it is above 0. Additive.
    int RecordsNotCounted = 0,
    // spec: plr-d10 lane MU-4 (§11.6) — true when this total counts only the plots the caller covers (a chosen-plots
    // seat): the phone labels it "तुमच्या प्लॉटचे" (PROPOSED). Additive: absent / false = the whole farm's.
    bool ScopedToPlots = false);

