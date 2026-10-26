// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.JoinByCode;

/// <summary>
/// Caller-shape validation for <see cref="JoinByCodeHandler"/>, run as a pipeline stage. Same
/// two identity gates as <c>ClaimJoinValidator</c>, in the same order (only the most significant
/// fires): an authenticated caller, whose phone was verified by OTP — the owner who later sees
/// the request must be looking at a real phone number.
///
/// <para><b>The code itself is NOT checked here.</b> A blank, malformed, wrong or unknown code
/// must all get the one identical answer (<c>join.code_unknown</c>, 404) from the handler. A
/// separate 400 for "malformed" would be a second, distinguishable answer for no benefit.</para>
/// </summary>
public sealed class JoinByCodeValidator : IValidator<JoinByCodeCommand>
{
    public IEnumerable<Error> Validate(JoinByCodeCommand command)
    {
        if (command.CallerUserId.IsEmpty)
        {
            yield return ShramSafalErrors.JoinUnauthenticated;
            yield break;
        }

        if (!command.PhoneVerified)
        {
            yield return ShramSafalErrors.JoinPhoneNotVerified;
        }
    }
}
