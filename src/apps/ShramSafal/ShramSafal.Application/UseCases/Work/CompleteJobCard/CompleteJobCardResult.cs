namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

public sealed record CompleteJobCardResult(Guid JobCardId, Guid LinkedDailyLogId, DateTime CompletedAtUtc);
