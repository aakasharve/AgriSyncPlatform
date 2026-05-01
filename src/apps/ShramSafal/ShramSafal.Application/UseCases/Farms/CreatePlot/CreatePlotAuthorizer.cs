using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreatePlot): farm-existence + owner-role
/// authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Like <c>CreateDailyLogAuthorizer</c>, this authorizer takes
/// <see cref="IShramSafalRepository"/> directly rather than delegating to
/// <see cref="IAuthorizationEnforcer"/>. No enforcer method matches
/// "load farm + check owner-tier role"; adding one would cascade to
/// existing test stubs and is deferred. EF's first-level cache makes
/// the body's defense-in-depth re-lookup effectively free in the
/// pipeline-consumer path.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the actor's role
/// on the farm is not PrimaryOwner or SecondaryOwner.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CreatePlotAuthorizer : IAuthorizationCheck<CreatePlotCommand>
{
    private readonly IShramSafalRepository _repository;

    public CreatePlotAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CreatePlotCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        var role = await _repository.GetUserRoleForFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (role is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
