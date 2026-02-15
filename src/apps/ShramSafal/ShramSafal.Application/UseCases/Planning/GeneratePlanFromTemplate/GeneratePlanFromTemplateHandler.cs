using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

public sealed class GeneratePlanFromTemplateHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<PlanGenerationResultDto>> HandleAsync(
        GeneratePlanFromTemplateCommand command,
        CancellationToken ct = default)
    {
        if (command.CropCycleId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.TemplateName) ||
            string.IsNullOrWhiteSpace(command.Stage) ||
            command.Activities.Count == 0)
        {
            return Result.Failure<PlanGenerationResultDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.Activities.Any(a => string.IsNullOrWhiteSpace(a.ActivityName)))
        {
            return Result.Failure<PlanGenerationResultDto>(ShramSafalErrors.InvalidCommand);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<PlanGenerationResultDto>(ShramSafalErrors.CropCycleNotFound);
        }

        var utcNow = clock.UtcNow;
        var template = Domain.Planning.ScheduleTemplate.Create(
            idGenerator.New(),
            command.TemplateName,
            command.Stage,
            utcNow);

        var plannedActivities = new List<Domain.Planning.PlannedActivity>(command.Activities.Count);

        foreach (var activity in command.Activities)
        {
            template.AddActivity(idGenerator.New(), activity.ActivityName, activity.OffsetDays);

            var plannedDate = command.PlanStartDate.AddDays(activity.OffsetDays);
            plannedActivities.Add(Domain.Planning.PlannedActivity.Create(
                idGenerator.New(),
                command.CropCycleId,
                activity.ActivityName,
                command.Stage,
                plannedDate,
                utcNow));
        }

        template.MarkGenerated(command.CropCycleId, utcNow);

        await repository.AddScheduleTemplateAsync(template, ct);
        await repository.AddPlannedActivitiesAsync(plannedActivities, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new PlanGenerationResultDto(
            template.Id,
            command.CropCycleId,
            template.Name,
            plannedActivities.Count,
            plannedActivities.Select(p => p.ToDto()).ToList()));
    }
}

