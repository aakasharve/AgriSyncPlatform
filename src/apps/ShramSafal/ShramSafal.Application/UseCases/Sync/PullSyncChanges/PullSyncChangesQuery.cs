namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

public sealed record PullSyncChangesQuery(DateTime SinceUtc, Guid UserId);
