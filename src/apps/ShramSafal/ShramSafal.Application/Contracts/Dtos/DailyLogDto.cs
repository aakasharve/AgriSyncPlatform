namespace ShramSafal.Application.Contracts.Dtos;

/// <remarks>
/// LABOUR_PHASE2 P2.1 — <see cref="PlotId"/> and <see cref="CropCycleId"/> are
/// nullable because <c>DailyLog</c> is. This is the compile-closure minimum, and
/// it is deliberate rather than incidental: the alternative,
/// <c>log.PlotId ?? Guid.Empty</c>, would put a fabricated plot reference on the
/// wire and from there into canonical client state — a direct P4 violation that
/// every existing test would pass.
///
/// No non-<c>Plot</c> log can exist at this commit (the write path stays
/// plot-only until P2.2), so nothing on the wire changes today. Adding
/// <c>scope</c> / <c>plotIds</c> to this DTO and to the client's
/// <c>dtos.ts</c> twin is P2.3's task.
/// </remarks>
public sealed record DailyLogDto(
    Guid Id,
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? IdempotencyKey,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    LocationDto? Location,
    string? LastVerificationStatus,
    IReadOnlyList<LogTaskDto> Tasks,
    IReadOnlyList<VerificationEventDto> VerificationEvents);
