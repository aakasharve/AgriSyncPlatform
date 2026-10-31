using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.UseCases.Logs.MoveDailyLog;

/// <summary>
/// spec: plr-d10 (lane OF-S fix pass 2, N1/N3) — what a move answers: the record as it now stands, and EXACTLY the money
/// entries the server moved with it, each as the pull would carry it. The phone puts those rows in its money book at once
/// (no waiting for a pull) and moves nothing it was not told about, so the phone and the server can never disagree on
/// where a record's money is.
/// </summary>
public sealed record MoveDailyLogResultDto(DailyLogDto Log, IReadOnlyList<CostEntryDto> MoneyMoved);
