namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed record GetAttentionBoardQuery(Guid CallerUserId, DateTime? AsOfUtc = null);
