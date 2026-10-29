namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

/// <param name="ScheduledWork">spec: plr-d10 (I22) — every scheduled step due today or late, one row each
/// (<see cref="ScheduledWorkItemDto"/>). Additive and optional: <c>null</c> from a caller that builds the board
/// without it; an older phone ignores the key.</param>
public sealed record AttentionBoardDto(
    DateTime AsOfUtc,
    IReadOnlyList<AttentionCardDto> Cards,
    IReadOnlyList<ScheduledWorkItemDto>? ScheduledWork = null);
