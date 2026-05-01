using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreatePlot): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates are extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Any of <see cref="CreatePlotCommand.FarmId"/>,
/// <see cref="CreatePlotCommand.ActorUserId"/> is empty;
/// <see cref="CreatePlotCommand.Name"/> is whitespace; or
/// <see cref="CreatePlotCommand.AreaInAcres"/> is non-positive.</item>
/// <item>An explicit <see cref="CreatePlotCommand.PlotId"/> was supplied
/// but is empty (null is fine — the handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns: farm-existence (FarmNotFound), role
/// resolution + tier check (Forbidden — both extracted into
/// <see cref="CreatePlotAuthorizer"/> for the pipeline stage), the
/// entitlement gate (PaidFeature.CreatePlot), aggregate creation,
/// audit, save, analytics. The endpoint path (POST /farms/{id}/plots)
/// gets the canonical <c>InvalidCommand → FarmNotFound → Forbidden</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class CreatePlotValidator : IValidator<CreatePlotCommand>
{
    public IEnumerable<Error> Validate(CreatePlotCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Name)
            || command.AreaInAcres <= 0)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
