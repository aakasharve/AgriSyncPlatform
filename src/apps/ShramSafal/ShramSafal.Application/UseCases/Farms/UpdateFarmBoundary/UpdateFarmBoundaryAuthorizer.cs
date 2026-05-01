using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (UpdateFarmBoundary): farm-existence +
/// owner authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly because no
/// <c>IAuthorizationEnforcer</c> method matches "load farm and check
/// IsUserOwnerOfFarm" — adding one would cascade to existing test
/// stubs and is deferred per the rollout's narrowness rule.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the actor is not
/// an owner (PrimaryOwner / SecondaryOwner) of the target farm.</item>
/// </list>
/// The handler body still re-checks <c>OwnerAccountId.IsEmpty</c> as a
/// defense-in-depth invariant (this is bound to farm I/O state, not
/// the command — can't be expressed in either validator or authorizer
/// against the command alone).
/// </para>
/// </summary>
public sealed class UpdateFarmBoundaryAuthorizer : IAuthorizationCheck<UpdateFarmBoundaryCommand>
{
    private readonly IShramSafalRepository _repository;

    public UpdateFarmBoundaryAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(UpdateFarmBoundaryCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        var isOwner = await _repository.IsUserOwnerOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!isOwner)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
