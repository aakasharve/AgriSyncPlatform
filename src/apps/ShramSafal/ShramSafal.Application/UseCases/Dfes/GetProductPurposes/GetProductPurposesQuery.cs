namespace ShramSafal.Application.UseCases.Dfes.GetProductPurposes;

/// <summary>Part 03 B4 — the products of ONE saved record and what each was for. <see cref="CallerUserId"/> is the JWT subject.</summary>
public sealed record GetProductPurposesQuery(Guid CallerUserId, Guid FarmId, Guid DailyLogId);
