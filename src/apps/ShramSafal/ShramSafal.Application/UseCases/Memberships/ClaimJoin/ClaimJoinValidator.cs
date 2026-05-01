using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.ClaimJoin;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (ClaimJoin): caller-shape validation moves
/// OUT of the handler body and into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three guards are extracted, in order:
/// <list type="number">
/// <item><see cref="ShramSafalErrors.JoinUnauthenticated"/> when
/// <see cref="ClaimJoinCommand.CallerUserId"/> is empty.</item>
/// <item><see cref="ShramSafalErrors.JoinPhoneNotVerified"/> when the
/// JWT did not carry <c>phone_verified=true</c>.</item>
/// <item><see cref="ShramSafalErrors.JoinInvalidPayload"/> when the QR
/// scanner sent a missing or whitespace-only Token / FarmCode.</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns the deeper invariants: token-hash lookup,
/// revoked-token handling (<c>join.token_invalid</c>), farm-missing
/// (<c>join.farm_missing</c>), tampered-QR farm-code mismatch
/// (<c>join.farm_code_mismatch</c>), idempotency for repeat scans,
/// audit, save, and analytics. Those are not "caller validation" in the
/// pipeline sense — they require I/O.
/// </para>
/// </summary>
public sealed class ClaimJoinValidator : IValidator<ClaimJoinCommand>
{
    public IEnumerable<Error> Validate(ClaimJoinCommand command)
    {
        if (command.CallerUserId.IsEmpty)
        {
            yield return ShramSafalErrors.JoinUnauthenticated;
            // Only the most-significant gate fires per call — without this
            // early break, an unauthenticated caller with a missing token
            // would surface BOTH errors and the endpoint's code-switch
            // would pick the wrong status.
            yield break;
        }

        if (!command.PhoneVerified)
        {
            yield return ShramSafalErrors.JoinPhoneNotVerified;
            yield break;
        }

        if (string.IsNullOrWhiteSpace(command.Token) || string.IsNullOrWhiteSpace(command.FarmCode))
        {
            yield return ShramSafalErrors.JoinInvalidPayload;
        }
    }
}
