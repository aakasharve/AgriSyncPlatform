// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 3a)
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.Services;

/// <summary>
/// The products of a record as its approval card shows them (founder D-95): one line per product, the library's match, the
/// speaker's answer and the check kept apart. Pure projection of <see cref="ProductJudgement"/>; nothing is decided here.
/// </summary>
public static class ReviewProducts
{
    public static IReadOnlyList<ReviewProductDto> Of(IReadOnlyList<ProductJudgement> judgements) =>
        judgements
            .Select(j => new ReviewProductDto(
                j.Item.InputEventId,
                j.Item.MixIndex,
                j.Item.SpokenName,
                new ReviewProductMatchDto(MatchWord(j.Match.State), j.Match.ProductId),
                Answer(j.SpeakerAnswer),
                Answer(j.Check)))
            .ToList();

    /// <summary>The products no checker has checked yet. A check of any kind (yes, no, photo) is a check; the speaker's own
    /// answer is not.</summary>
    public static int UncheckedCount(IReadOnlyList<ProductJudgement> judgements) => judgements.Count(j => j.Check is null);

    private static string MatchWord(MatchState state) => state switch
    {
        MatchState.Found => "found",
        MatchState.Ambiguous => "ambiguous",
        _ => "notFound",
    };

    private static ReviewProductAnswerDto? Answer(InputIdentityAssertion? answer) => answer is null
        ? null
        : new ReviewProductAnswerDto(
            IdentityVerdictWire.ToWire(answer.Verdict),
            answer.CatalogProductId,
            answer.AttachmentId,
            answer.AssertedByUserId.Value,
            answer.AssertedAtUtc);
}
