using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): authorization moves
/// OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// This authorizer is more restrictive than
/// <c>CompleteJobCardAuthorizer</c> / <c>CancelJobCardAuthorizer</c> —
/// settlement is owner-tier only (PrimaryOwner or SecondaryOwner). The
/// role-tier rule extracted here matches the handler's
/// <c>IsEligibleToSettle</c> private helper verbatim.
/// </para>
///
/// <para>
/// Error contract preserves the body's ordering:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the
/// job-card id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller has
/// no membership on the job card's farm.</item>
/// <item><see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when
/// the caller is a member but their role is not PrimaryOwner /
/// SecondaryOwner.</item>
/// </list>
/// The handler body still owns the JobCardInvalidState gate (status !=
/// VerifiedForPayout) because that's an aggregate-state invariant, not
/// a caller-identity invariant.
/// </para>
/// </summary>
public sealed class SettleJobCardPayoutAuthorizer : IAuthorizationCheck<SettleJobCardPayoutCommand>
{
    private readonly IShramSafalRepository _repository;

    public SettleJobCardPayoutAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(SettleJobCardPayoutCommand command, CancellationToken ct)
    {
        var jobCard = await _repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
        {
            return Result.Failure(ShramSafalErrors.JobCardNotFound);
        }

        var role = await _repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);
        if (role is null)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        if (role.Value is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        return Result.Success();
    }
}
