using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.UseCases.Logs.ReviseLogContent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M) — what an edit answers: the record as it now stands, and
/// EXACTLY the money the server made or corrected with it, each as the pull would carry it (the corrected entries and new
/// ones, and the corrections written), plus every line whose money could NOT be brought in line and why (fix pass 3: an
/// edit reconciles ALL of the record's money, so these can be lines the edit itself did not change). The phone writes only
/// those rows into its money book, at once (no waiting for a pull), and says the reasons plainly; it never changes money
/// on its own. A repeat of the same request answers the same (the sync store keeps this answer). <c>revise_log_content</c>
/// was never released, so no installed phone reads its answer.
/// </summary>
public sealed record ReviseLogContentResultDto(
    DailyLogDto Log,
    IReadOnlyList<CostEntryDto> MoneyChanged,
    IReadOnlyList<FinanceCorrectionDto> MoneyCorrections,
    IReadOnlyList<MoneyNotFollowedDto> MoneyNotFollowed);

/// <summary>
/// One line whose money was not brought in line with its record: its kind, its line id, the id its money has (or would have), and
/// why (camelCase reason name). The phone keeps the reason per money id until an answer says that money is in step.
/// </summary>
public sealed record MoneyNotFollowedDto(string Kind, string LineId, Guid CostEntryId, string Reason);
