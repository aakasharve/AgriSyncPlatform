namespace ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;

public sealed record GetRecentQuestionEventsQuery(Guid CallerUserId, Guid FarmId, int SinceDays = 14);
