using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

public sealed record VerifyLogCommand(
    Guid DailyLogId,
    VerificationStatus TargetStatus,
    string? Reason,
    Guid VerifiedByUserId,
    Guid? VerificationEventId = null,
    string? ActorRole = null,
    string? ClientCommandId = null);
