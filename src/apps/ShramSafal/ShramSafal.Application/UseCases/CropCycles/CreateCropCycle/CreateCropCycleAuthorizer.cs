using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateCropCycle): farm-existence + plot-
/// existence + farm-membership authorization moves OUT of the handler
/// body into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly because no
/// <c>IAuthorizationEnforcer</c> method matches "load farm and plot,
/// then check farm membership" — adding one would cascade to existing
/// test stubs and is deferred per the rollout's narrowness rule.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.PlotNotFound"/> when the plot id
/// resolves to nothing OR the plot belongs to a different farm.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the actor is not
/// a member of the target farm.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CreateCropCycleAuthorizer : IAuthorizationCheck<CreateCropCycleCommand>
{
    private readonly IShramSafalRepository _repository;

    public CreateCropCycleAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CreateCropCycleCommand command, CancellationToken ct)
    {
        var farmId = new FarmId(command.FarmId);

        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        var plot = await _repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.FarmId != farmId)
        {
            return Result.Failure(ShramSafalErrors.PlotNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
