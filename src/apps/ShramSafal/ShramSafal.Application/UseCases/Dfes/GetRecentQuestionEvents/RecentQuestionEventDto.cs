namespace ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;

/// <summary>Cooldown/anti-repeat projection (camelCase on the wire).</summary>
public sealed record RecentQuestionEventDto(
    string questionKey, string triggerType, DateTime? shownAtUtc,
    DateTime createdAtUtc, bool? stageConfirmed, bool? skipped);
