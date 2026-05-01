using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Schedules.MigrateSchedule;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (MigrateSchedule): farm + plot + cropCycle
/// existence + farm-membership authorization moves OUT of the handler
/// body into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage. Mirrors AdoptScheduleAuthorizer's pattern.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — no
/// <c>IAuthorizationEnforcer</c> method matches "load farm + plot +
/// cropCycle, validate cross-aggregate cohesion, then check farm
/// membership."
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> — farm id resolves
/// to nothing.</item>
/// <item><see cref="ShramSafalErrors.PlotNotFound"/> — plot id resolves
/// to nothing OR plot belongs to a different farm.</item>
/// <item><see cref="ShramSafalErrors.CropCycleNotFound"/> — cropCycle
/// id resolves to nothing OR cropCycle belongs to a different plot.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — actor is not a
/// member of the target farm.</item>
/// </list>
/// </para>
/// </summary>
public sealed class MigrateScheduleAuthorizer : IAuthorizationCheck<MigrateScheduleCommand>
{
    private readonly IShramSafalRepository _repository;

    public MigrateScheduleAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(MigrateScheduleCommand command, CancellationToken ct)
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
