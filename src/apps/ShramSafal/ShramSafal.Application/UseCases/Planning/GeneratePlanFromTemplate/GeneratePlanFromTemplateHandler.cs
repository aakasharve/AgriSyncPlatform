using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

public sealed class GeneratePlanFromTemplateHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    ScheduleTestDueDatesHandler? scheduleTestDueDatesHandler = null)
{
    public async Task<Result<PlanGenerationResultDto>> HandleAsync(
        GeneratePlanFromTemplateCommand command,
        CancellationToken ct = default)
    {
        if (command.ActorUserId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
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

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync((Guid)cropCycle.FarmId, command.ActorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<PlanGenerationResultDto>(ShramSafalErrors.Forbidden);
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
            // Capture the template-activity id so we can stamp it onto the
            // planned activity via CreateFromTemplate. Without this link the
            // planner can't tell template-driven rows apart from
            // locally-added ones.
            var templateActivityId = idGenerator.New();
            template.AddActivity(templateActivityId, activity.ActivityName, activity.OffsetDays);

            var plannedDate = command.PlanStartDate.AddDays(activity.OffsetDays);
            plannedActivities.Add(Domain.Planning.PlannedActivity.CreateFromTemplate(
                idGenerator.New(),
                command.CropCycleId,
                activity.ActivityName,
                command.Stage,
                plannedDate,
                templateActivityId,
                utcNow));
        }

        template.MarkGenerated(command.CropCycleId, utcNow);

        await repository.AddScheduleTemplateAsync(template, ct);
        await repository.AddPlannedActivitiesAsync(plannedActivities, ct);
        await repository.SaveChangesAsync(ct);

        // CEI §4.5 — materialise TestInstance rows for every protocol that
        // targets this crop type. Non-fatal: best-effort with ordinary DI.
        if (scheduleTestDueDatesHandler is not null)
        {
            var planEnd = plannedActivities.Count == 0
                ? command.PlanStartDate
                : plannedActivities.Max(p => p.PlannedDate);

            var stageInfos = new List<CropCycleStageInfo>
            {
                new(command.Stage, command.PlanStartDate, planEnd)
            };

            await scheduleTestDueDatesHandler.HandleAsync(
                new ScheduleTestDueDatesCommand(
                    CropCycleId: command.CropCycleId,
                    FarmId: cropCycle.FarmId,
                    PlotId: cropCycle.PlotId,
                    CropType: cropCycle.CropName,
                    Stages: stageInfos,
                    ActorUserId: new UserId(command.ActorUserId)),
                ct);
        }

        return Result.Success(new PlanGenerationResultDto(
            template.Id,
            command.CropCycleId,
            template.Name,
            plannedActivities.Count,
            plannedActivities.Select(p => p.ToDto()).ToList()));
    }
}
