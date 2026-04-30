using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

/// <summary>
/// Explicit owner action that invalidates the currently-shared QR and
/// issues a fresh one. The old <see cref="FarmInvitation"/> moves to
/// <see cref="InvitationStatus.Revoked"/> and its token's
/// <c>IsRevoked</c> flips; any QR already printed or WhatsApp-shared
/// will stop working after this call.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (RotateFarmInvite): wired through the
/// explicit <see cref="HandlerPipeline"/>. Validation lives in
/// <see cref="RotateFarmInviteValidator"/>; ownership authorization
/// lives in <see cref="RotateFarmInviteAuthorizer"/>. When this handler
/// is resolved via the pipeline (see DI registration), both layers run
/// before the body executes; when resolved directly (legacy code paths /
/// unit tests), callers are responsible for pre-checking the same
/// invariants.
/// </para>
/// </summary>
public sealed class RotateFarmInviteHandler(
    IFarmInvitationRepository invitationRepository,
    IShramSafalRepository farmRepository,
    IClock clock)
    : IHandler<RotateFarmInviteCommand, RotateFarmInviteResult>
{
    public async Task<Result<RotateFarmInviteResult>> HandleAsync(
        RotateFarmInviteCommand command,
        CancellationToken ct = default)
    {
        // Validation lives in RotateFarmInviteValidator; authorization
        // lives in RotateFarmInviteAuthorizer. Both run as pipeline
        // behaviors before this body when the handler is resolved through
        // the pipeline. Direct construction (tests, ad-hoc consumers)
        // bypasses those decorators by design.

        var farm = await farmRepository.GetFarmByIdAsync(command.FarmId.Value, ct);
        if (farm is null)
        {
            // Sub-plan 03 Task 3: business outcome -> Result.Failure, not throw.
            return Result.Failure<RotateFarmInviteResult>(ShramSafalErrors.FarmNotFound);
        }

        var utcNow = clock.UtcNow;

        var existing = await invitationRepository.GetActiveInvitationByFarmAsync(command.FarmId, ct);
        if (existing is not null)
        {
            var existingToken = await invitationRepository.GetActiveTokenByInvitationAsync(existing.Id, ct);
            existingToken?.Revoke(utcNow);
            existing.Revoke(utcNow);
        }

        var invitation = FarmInvitation.Issue(
            FarmInvitationId.New(),
            command.FarmId,
            command.CallerUserId,
            utcNow);

        var rawToken = IssueFarmInviteHandler.GenerateRawToken();
        var tokenHash = IssueFarmInviteHandler.ComputeTokenHash(rawToken);

        var token = FarmJoinToken.Issue(
            FarmJoinTokenId.New(),
            invitation.Id,
            command.FarmId,
            rawToken,
            tokenHash,
            utcNow);

        await invitationRepository.AddInvitationAsync(invitation, ct);
        await invitationRepository.AddTokenAsync(token, ct);
        await invitationRepository.SaveChangesAsync(ct);

        return Result.Success(new RotateFarmInviteResult(
            new IssueFarmInviteResult(
                InvitationId: invitation.Id,
                JoinTokenId: token.Id,
                FarmId: farm.Id,
                FarmName: farm.Name,
                FarmCode: farm.FarmCode ?? "",
                Token: rawToken,
                IssuedAtUtc: token.CreatedAtUtc)));
    }
}
