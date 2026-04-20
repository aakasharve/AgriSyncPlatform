namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed record AttentionBoardDto(
    DateTime AsOfUtc,
    IReadOnlyList<AttentionCardDto> Cards);
