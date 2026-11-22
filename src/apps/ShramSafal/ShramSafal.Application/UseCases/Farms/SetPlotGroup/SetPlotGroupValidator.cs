using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.SetPlotGroup;

/// <summary>
/// spec: plr-d10 lane GRP-1a - caller-shape validation for <see cref="SetPlotGroupCommand"/>, run by the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> stage before the handler body: an empty id, or a group name longer than
/// <see cref="Plot.GroupNameMaxLength"/> once trimmed, answers <see cref="ShramSafalErrors.InvalidCommand"/> (400). A null or
/// whitespace name is valid (it clears the group).
/// </summary>
public sealed class SetPlotGroupValidator : IValidator<SetPlotGroupCommand>
{
    public IEnumerable<Error> Validate(SetPlotGroupCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || (command.GroupName?.Trim().Length ?? 0) > Plot.GroupNameMaxLength)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
