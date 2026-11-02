namespace ShramSafal.Application.UseCases.Planning.GetScheduleLineage;

/// <summary>
/// spec: plr-d10 lane F99 fix pass 1 (review F-8) — <paramref name="CallerUserId"/>: whose lineage view this is; only the
/// templates he may see are answered (Public, his own, and his team's).
/// </summary>
public sealed record GetScheduleLineageQuery(Guid RootTemplateId, Guid CallerUserId);
