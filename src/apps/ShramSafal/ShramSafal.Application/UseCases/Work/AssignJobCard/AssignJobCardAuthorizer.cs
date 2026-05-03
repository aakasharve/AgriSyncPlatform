using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.AssignJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): job-card-existence +
/// caller-role-tier authorization moves OUT of the handler body into
/// the <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline
/// stage.
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c> / <c>CompleteJobCardAuthorizer</c>,
/// this authorizer takes <see cref="IShramSafalRepository"/> directly.
/// No <c>IAuthorizationEnforcer</c> method matches "load job card → check
/// caller role tier"; adding one would cascade across multiple test
/// stubs. The body still owns the worker-membership check
/// (<see cref="ShramSafalErrors.JobCardWorkerNotMember"/>) because that's
/// a separate I/O lookup against the worker, not the caller, and the
/// domain state-machine gate.
/// </para>
///
/// <para>
/// Error contract preserves the body's ordering exactly:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the job-card
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller has
/// no membership on the job card's farm.</item>
/// <item><see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the
/// caller is a member but the role is not Mukadam / PrimaryOwner /
/// SecondaryOwner.</item>
/// </list>
/// Combined with <see cref="AssignJobCardValidator"/> the canonical
/// pipeline ordering is
/// <c>InvalidCommand → JobCardNotFound → Forbidden →
/// JobCardRoleNotAllowed → (body checks: JobCardWorkerNotMember →
/// JobCardInvalidState)</c>.
/// </para>
/// </summary>
public sealed class AssignJobCardAuthorizer : IAuthorizationCheck<AssignJobCardCommand>
{
    private readonly IShramSafalRepository _repository;

    public AssignJobCardAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(AssignJobCardCommand command, CancellationToken ct)
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

        if (!IsEligibleToAssign(role.Value))
        {
            return Result.Failure(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        return Result.Success();
    }

    private static bool IsEligibleToAssign(AppRole role) =>
        role is AppRole.Mukadam or AppRole.PrimaryOwner or AppRole.SecondaryOwner;
}
