using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Schedules.CompleteSchedule;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CompleteSchedule): farm + plot + cropCycle
/// existence + farm-membership authorization moves OUT of the handler
/// body into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage. Mirrors AdoptScheduleAuthorizer's pattern.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — same shape as
/// the other rolled-out schedule-lifecycle authorizers.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/></item>
/// <item><see cref="ShramSafalErrors.PlotNotFound"/></item>
/// <item><see cref="ShramSafalErrors.CropCycleNotFound"/></item>
/// <item><see cref="ShramSafalErrors.Forbidden"/></item>
/// </list>
/// </para>
/// </summary>
public sealed class CompleteScheduleAuthorizer : IAuthorizationCheck<CompleteScheduleCommand>
{
    private readonly IShramSafalRepository _repository;

    public CompleteScheduleAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CompleteScheduleCommand command, CancellationToken ct)
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

        var cropCycle = await _repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null || cropCycle.PlotId != command.PlotId)
        {
            return Result.Failure(ShramSafalErrors.CropCycleNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
