// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One answer about the identity of one product of one saved record, as it goes on the wire: the pull's
/// <c>inputIdentityAssertions</c> and the push's answer to <c>assert_input_identity</c>.
/// <para><see cref="SpokenName"/> is the SERVER's copy of his words from the stored record. <see cref="Verdict"/> is
/// <c>confirmed</c>, <c>rejected</c> or <c>photo</c>. <see cref="IsCheck"/> is the server's statement that the sender held the
/// confirm-records authority when he answered (founder D-95); false is the speaker's own answer.</para>
/// </summary>
public sealed record InputIdentityAssertionDto(
    Guid AssertionId,
    Guid FarmId,
    Guid? PlotId,
    Guid DailyLogId,
    string InputEventId,
    int MixIndex,
    string SpokenName,
    string? CatalogProductId,
    string Verdict,
    Guid? AttachmentId,
    string CatalogVersion,
    Guid AssertedByUserId,
    DateTime AssertedAtUtc,
    bool IsCheck)
{
    public static InputIdentityAssertionDto From(InputIdentityAssertion assertion)
    {
        ArgumentNullException.ThrowIfNull(assertion);
        return new InputIdentityAssertionDto(
            assertion.Id,
            (Guid)assertion.FarmId,
            assertion.PlotId,
            assertion.DailyLogId,
            assertion.InputEventId,
            assertion.MixIndex,
            assertion.SpokenName,
            assertion.CatalogProductId,
            IdentityVerdictWire.ToWire(assertion.Verdict),
            assertion.AttachmentId,
            assertion.CatalogVersion,
            assertion.AssertedByUserId.Value,
            assertion.AssertedAtUtc,
            assertion.IsCheck);
    }
}
