using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

public sealed record VerifyLogCommand(
    Guid DailyLogId,
    VerificationStatus Status,
    string? Reason,
    Guid VerifiedByUserId,
    Guid? VerificationEventId = null);
