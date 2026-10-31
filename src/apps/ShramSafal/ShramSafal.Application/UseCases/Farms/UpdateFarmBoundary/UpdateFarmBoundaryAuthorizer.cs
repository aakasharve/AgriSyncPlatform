using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

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
    private readonly IClock _clock;

    public UpdateFarmBoundaryAuthorizer(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(UpdateFarmBoundaryCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        // lane 2b (D-15 via D-26) — the boundary is farm setup: the edit-farm-setup authority of
        // the caller's seat on THIS farm (the primary account holder always), never the label.
        if (!await FarmAuthorityGate.HoldsAsync(
                _repository, command.FarmId, command.ActorUserId, FarmAuthority.EditFarmSetup, _clock.UtcNow, ct))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
