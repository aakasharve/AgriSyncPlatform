using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateCropCycle): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates are extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Any of <see cref="CreateCropCycleCommand.FarmId"/>,
/// <see cref="CreateCropCycleCommand.PlotId"/>,
/// <see cref="CreateCropCycleCommand.ActorUserId"/> is empty; or
/// <see cref="CreateCropCycleCommand.CropName"/> /
/// <see cref="CreateCropCycleCommand.Stage"/> is whitespace.</item>
/// <item>An explicit <see cref="CreateCropCycleCommand.CropCycleId"/>
/// was supplied but is empty (null is fine — the handler generates
/// one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// farm lookup (FarmNotFound), plot lookup + farm cross-check
/// (PlotNotFound), farm-membership check (Forbidden — both also
/// extracted into <see cref="CreateCropCycleAuthorizer"/> for the
/// pipeline stage), entitlement gate, overlap detection, save, audit.
/// The endpoint path (POST /cropcycles) gets the canonical
/// <c>InvalidCommand → FarmNotFound → PlotNotFound → Forbidden</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class CreateCropCycleValidator : IValidator<CreateCropCycleCommand>
{
    public IEnumerable<Error> Validate(CreateCropCycleCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.CropName)
            || string.IsNullOrWhiteSpace(command.Stage))
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.CropCycleId.HasValue && command.CropCycleId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
