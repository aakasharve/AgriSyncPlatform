using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;

/// <summary>spec: plr-d10 lane SCH-OWN - caller-shape validation: ids present, a name of 1 to 120 characters, a crop of 1 to 60.</summary>
public sealed class CreateOwnScheduleValidator : IValidator<CreateOwnScheduleCommand>
{
    public IEnumerable<Error> Validate(CreateOwnScheduleCommand command)
    {
        if (command.ScheduleTemplateId == Guid.Empty
            || command.FarmId == Guid.Empty
            || command.CallerUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Name)
            || command.Name.Trim().Length > ScheduleTemplate.MaxNameLength
            || string.IsNullOrWhiteSpace(command.CropKey)
            || command.CropKey.Trim().Length > ScheduleTemplate.MaxCropKeyLength)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
