namespace ShramSafal.Application.Contracts.Dtos;

public sealed record DailyLogDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? IdempotencyKey,
    DateTime CreatedAtUtc,
    string VerificationStatus,
    IReadOnlyList<LogTaskDto> Tasks,
    IReadOnlyList<VerificationEventDto> VerificationEvents);
