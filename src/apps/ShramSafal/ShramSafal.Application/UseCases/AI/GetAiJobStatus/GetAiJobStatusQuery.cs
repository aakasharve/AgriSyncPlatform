namespace ShramSafal.Application.UseCases.AI.GetAiJobStatus;

public sealed record GetAiJobStatusQuery(
    Guid JobId,
    Guid ActorUserId,
    bool IsAdmin);
