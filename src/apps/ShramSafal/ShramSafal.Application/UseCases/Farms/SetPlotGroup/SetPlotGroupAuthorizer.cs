using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.SetPlotGroup;

/// <summary>
/// spec: plr-d10 lane GRP-1a - the farm-existence and edit-farm-setup gate for <see cref="SetPlotGroupCommand"/>, run by the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> stage. It asks exactly what add-plot asks
/// (<see cref="CreatePlot.CreatePlotAuthorizer"/>): the farm exists (<see cref="ShramSafalErrors.FarmNotFound"/>), and the caller's seat on
/// THAT farm holds <see cref="FarmAuthority.EditFarmSetup"/> (<see cref="ShramSafalErrors.Forbidden"/>) - the primary account
/// holder always, or a seat he gave it to; a label such as सहमालक grants nothing. It is NOT an owner-only rule.
/// </summary>
public sealed class SetPlotGroupAuthorizer : IAuthorizationCheck<SetPlotGroupCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly IClock _clock;

    public SetPlotGroupAuthorizer(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(SetPlotGroupCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        if (!await FarmAuthorityGate.HoldsAsync(
                _repository, command.FarmId, command.ActorUserId, FarmAuthority.EditFarmSetup, _clock.UtcNow, ct))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
